import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as readline from 'readline';
import { Logger } from '../utils/logger';
import { HttpService } from '../utils/http';

export interface McpServerConfig {
    type?: string;          // 'http' | 'sse'
    command?: string;
    url?: string;
    serverUrl?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
}

export interface McpConfigFile {
    mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

export interface McpServerStatus {
    status: 'connected' | 'error';
    error?: string;
    toolCount?: number;
}

export interface McpTestResult {
    ok: boolean;
    error?: string;
    serverStatuses: Record<string, McpServerStatus>;
}

const DEFAULT_MCP_CONFIG: McpConfigFile = {
    mcpServers: {
        'n8n-mcp': {
            type: 'http',
            url: 'http://localhost:5678/mcp-server/http',
            headers: {
                Authorization: 'Bearer YOUR_ACCESS_TOKEN_HERE'
            }
        }
    }
};

class StdioMcpClient {
    private process: child_process.ChildProcess;
    private rl: readline.Interface;
    private pendingRequests = new Map<number, { resolve: (res: any) => void, reject: (err: Error) => void }>();
    private requestCounter = 1;

    constructor(command: string, args: string[], env?: Record<string, string>) {
        const mergedEnv = { ...process.env };
        if (env) {
            Object.assign(mergedEnv, env);
        }
        this.process = child_process.spawn(command, args, { env: mergedEnv });
        
        if (!this.process.stdout) {
            throw new Error('Failed to capture stdout of the MCP server.');
        }

        this.rl = readline.createInterface({ input: this.process.stdout });
        
        this.rl.on('line', (line) => {
            try {
                const data = JSON.parse(line);
                if (data.id !== undefined && this.pendingRequests.has(data.id)) {
                    this.pendingRequests.get(data.id)!.resolve(data);
                    this.pendingRequests.delete(data.id);
                }
            } catch (e) {
                // Ignore parsing errors for general stdout logs
            }
        });

        this.process.on('error', (err) => {
            Logger.error('STDIO MCP Process Error:', err);
        });
    }

    public async request(method: string, params?: any, timeout = 15000): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = this.requestCounter++;
            this.pendingRequests.set(id, { resolve, reject });
            
            const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
            if (this.process.stdin) {
                this.process.stdin.write(payload);
            } else {
                reject(new Error('Process stdin is not available'));
            }
            
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Timeout waiting for stdio response for method ${method}`));
                }
            }, timeout);
        });
    }

    public kill() {
        this.process.kill();
    }
}

export class McpService {
    private static context: vscode.ExtensionContext;
    private static cachedTools: McpToolDefinition[] | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 60000; // 1 minute
    private static stdioClients = new Map<string, StdioMcpClient>();

    public static initialize(context: vscode.ExtensionContext) {
        this.context = context;
        this.ensureConfigFileExists();

        // Listen for external file saves so mcp_config.json changes reload immediately
        vscode.workspace.onDidSaveTextDocument((doc) => {
            const configPath = this.getConfigFilePath();
            if (path.normalize(doc.uri.fsPath) === path.normalize(configPath)) {
                Logger.log('mcp_config.json saved, invalidating MCP tool cache.');
                this.invalidateCache();
            }
        });
    }

    public static getConfigFilePath(): string {
        // First check if workspace has .vscode/mcp_config.json or mcp_config.json
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const wsRoot = workspaceFolders[0].uri.fsPath;
            const wsConfig = path.join(wsRoot, '.vscode', 'mcp_config.json');
            if (fs.existsSync(wsConfig)) {
                return wsConfig;
            }
            const rootConfig = path.join(wsRoot, 'mcp_config.json');
            if (fs.existsSync(rootConfig)) {
                return rootConfig;
            }
        }

        // Default to global storage
        const storageDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        return path.join(storageDir, 'mcp_config.json');
    }

    public static getConfigFileUri(): vscode.Uri {
        this.ensureConfigFileExists();
        return vscode.Uri.file(this.getConfigFilePath());
    }

    public static ensureConfigFileExists(): string {
        const filePath = this.getConfigFilePath();
        if (!fs.existsSync(filePath)) {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(DEFAULT_MCP_CONFIG, null, 2), 'utf8');
        }
        return filePath;
    }

    public static getRawConfig(): string {
        try {
            const filePath = this.ensureConfigFileExists();
            return fs.readFileSync(filePath, 'utf8');
        } catch (err: any) {
            Logger.error('Failed to read mcp_config.json', err);
            return JSON.stringify(DEFAULT_MCP_CONFIG, null, 2);
        }
    }

    public static async saveRawConfig(rawConfig: string, enabled?: boolean): Promise<{ ok: boolean; error?: string }> {
        try {
            // Validate JSON format
            const parsed = JSON.parse(rawConfig);
            if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) {
                return { ok: false, error: 'JSON must contain a "mcpServers" object.' };
            }

            const filePath = this.ensureConfigFileExists();
            fs.writeFileSync(filePath, rawConfig, 'utf8');
            this.invalidateCache();

            if (enabled !== undefined) {
                await this.setEnabled(enabled);
            }

            return { ok: true };
        } catch (err: any) {
            return { ok: false, error: 'Invalid JSON: ' + err.message };
        }
    }

    public static isEnabled(): boolean {
        // mcp.enabled is no longer declared in contributes.configuration, so
        // vscode.workspace.getConfiguration().get() always returns undefined.
        // Use globalState as the single source of truth, defaulting to true.
        return this.context?.globalState.get<boolean>('spinYourAi.mcp.enabled', true) ?? true;
    }

    public static async setEnabled(enabled: boolean): Promise<void> {
        await this.context?.globalState.update('spinYourAi.mcp.enabled', enabled);
        this.invalidateCache();
    }

    public static invalidateCache() {
        this.cachedTools = null;
        this.cacheTimestamp = 0;
        
        // Kill existing STDIO clients so they restart on next request
        for (const [key, client] of this.stdioClients.entries()) {
            try {
                client.kill();
            } catch (e) {
                // Ignore
            }
        }
        this.stdioClients.clear();
    }
    
    private static getStdioClient(serverKey: string, config: McpServerConfig): StdioMcpClient {
        if (this.stdioClients.has(serverKey)) {
            return this.stdioClients.get(serverKey)!;
        }
        if (!config.command) {
            throw new Error(`Missing command for STDIO server ${serverKey}`);
        }
        const args = (config as any).args || [];
        const client = new StdioMcpClient(config.command, args, config.env);
        this.stdioClients.set(serverKey, client);
        return client;
    }

    public static async testConnection(rawConfig?: string): Promise<McpTestResult> {
        try {
            const jsonText = rawConfig !== undefined ? rawConfig : this.getRawConfig();
            if (!jsonText || !jsonText.trim()) {
                return { ok: false, error: 'Config is empty', serverStatuses: {} };
            }

            const parsed = JSON.parse(jsonText);
            if (!parsed || !parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
                return { ok: false, error: 'Missing mcpServers object in JSON', serverStatuses: {} };
            }

            const servers = Object.entries(parsed.mcpServers as Record<string, McpServerConfig>);
            if (servers.length === 0) {
                return { ok: false, error: 'No MCP servers defined in mcpServers', serverStatuses: {} };
            }

            const serverStatuses: Record<string, McpServerStatus> = {};
            let successCount = 0;

            for (const [key, s] of servers) {
                const url = s.url || s.serverUrl;
                const isStdio = s.command && s.command !== 'http' && s.type !== 'http';

                if (!isStdio && !url) {
                    serverStatuses[key] = { status: 'error', error: 'Missing "url" property for HTTP server' };
                    continue;
                }

                try {
                    let data: any;

                    if (isStdio) {
                        const client = this.getStdioClient(key, s);
                        data = await client.request('tools/list');
                    } else {
                        const headers: Record<string, string> = {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/event-stream'
                        };
                        if (s.env) { Object.assign(headers, s.env); }
                        if (s.headers) { Object.assign(headers, s.headers); }

                        const res = await HttpService.fetch(url!, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
                            timeout: 10000
                        });

                        if (!res.ok) {
                            const errText = await res.text();
                            serverStatuses[key] = { status: 'error', error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
                            continue;
                        }

                        const contentType = res.headers.get('content-type') || '';
                        if (contentType.includes('text/event-stream')) {
                            const text = await res.text();
                            const match = text.match(/data:\s*({[\s\S]*})/);
                            if (match && match[1]) {
                                data = JSON.parse(match[1]);
                            } else {
                                serverStatuses[key] = { status: 'error', error: 'Invalid SSE response from MCP server' };
                                continue;
                            }
                        } else {
                            data = await res.json();
                        }
                    }

                    if (data.error) {
                        serverStatuses[key] = { status: 'error', error: data.error.message || 'MCP Error' };
                    } else {
                        const toolCount = data.result?.tools?.length || 0;
                        serverStatuses[key] = { status: 'connected', toolCount };
                        successCount++;
                    }
                } catch (e: any) {
                    serverStatuses[key] = { status: 'error', error: e.message || 'Connection failed' };
                }
            }

            const ok = successCount > 0;
            return {
                ok,
                error: ok ? undefined : 'Failed to connect to any MCP servers',
                serverStatuses
            };
        } catch (err: any) {
            return { ok: false, error: 'Invalid JSON configuration: ' + err.message, serverStatuses: {} };
        }
    }

    public static async getActiveTools(): Promise<McpToolDefinition[]> {
        if (!this.isEnabled()) {
            return [];
        }

        const now = Date.now();
        if (this.cachedTools && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
            return this.cachedTools;
        }

        const tools: McpToolDefinition[] = [];

        try {
            const raw = this.getRawConfig();
            const config: McpConfigFile = JSON.parse(raw);
            if (!config || !config.mcpServers) {
                return [];
            }

            for (const [serverKey, s] of Object.entries(config.mcpServers)) {
                const url = s.url || s.serverUrl;
                const isStdio = s.command && s.command !== 'http' && s.type !== 'http';
                
                if (!isStdio && !url) { continue; }

                try {
                    let data: any;
                    if (isStdio) {
                        const client = this.getStdioClient(serverKey, s);
                        data = await client.request('tools/list');
                    } else {
                        const headers: Record<string, string> = {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/event-stream'
                        };
                        if (s.env) { Object.assign(headers, s.env); }
                        if (s.headers) { Object.assign(headers, s.headers); }

                        const res = await HttpService.fetch(url!, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
                            timeout: 8000
                        });

                        if (res.ok) {
                            const contentType = res.headers.get('content-type') || '';
                            if (contentType.includes('text/event-stream')) {
                                const text = await res.text();
                                const match = text.match(/data:\s*({[\s\S]*})/);
                                if (match && match[1]) {
                                    data = JSON.parse(match[1]);
                                }
                            } else {
                                data = await res.json();
                            }
                        }
                    }

                    if (data && data.result && Array.isArray(data.result.tools)) {
                        for (const t of data.result.tools) {
                            tools.push({
                                type: 'function',
                                function: {
                                    name: `mcp_${serverKey}__${t.name}`,
                                    description: t.description || `Tool provided by MCP server ${serverKey}`,
                                    parameters: t.inputSchema || { type: 'object', properties: {} }
                                }
                            });
                        }
                    }
                } catch (err: any) {
                    Logger.warn(`Could not connect to MCP server "${serverKey}": ${err.message}`);
                }
            }
        } catch (err: any) {
            Logger.error('Failed to parse mcp_config.json for active tools', err);
        }

        this.cachedTools = tools;
        this.cacheTimestamp = now;
        return tools;
    }

    /**
     * Returns a human-readable summary of all active MCP tools for injection
     * into a system prompt. This lets the model answer "list your tools" from
     * context even when no function call is triggered.
     */
    public static async getMcpToolsSummary(): Promise<string> {
        const tools = await this.getActiveTools();
        if (tools.length === 0) {
            return '';
        }
        const lines = tools.map(t =>
            `- **${t.function.name}**: ${t.function.description}`
        );
        return `You have access to the following MCP tools:\n${lines.join('\n')}`;
    }

    public static async executeTool(toolName: string, args: any): Promise<any> {
        if (!toolName.startsWith('mcp_')) {
            throw new Error(`Invalid tool name "${toolName}": Not an MCP tool.`);
        }

        const parts = toolName.split('__');
        const serverKey = parts[0].replace('mcp_', '');
        const originalToolName = parts.slice(1).join('__');

        const raw = this.getRawConfig();
        const config: McpConfigFile = JSON.parse(raw);
        const serverConf = config.mcpServers?.[serverKey];

        if (!serverConf) {
            throw new Error(`MCP server "${serverKey}" not found in mcp_config.json.`);
        }

        const url = serverConf.url || serverConf.serverUrl;
        const isStdio = serverConf.command && serverConf.command !== 'http' && serverConf.type !== 'http';
        
        if (!isStdio && !url) {
            throw new Error(`MCP server "${serverKey}" has no URL configured and is not an STDIO server.`);
        }

        let data: any;

        if (isStdio) {
            const client = this.getStdioClient(serverKey, serverConf);
            data = await client.request('tools/call', {
                name: originalToolName,
                arguments: args
            }, 60000);
        } else {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            };
            if (serverConf.env) { Object.assign(headers, serverConf.env); }
            if (serverConf.headers) { Object.assign(headers, serverConf.headers); }

            const res = await HttpService.fetch(url!, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: {
                        name: originalToolName,
                        arguments: args
                    }
                }),
                timeout: 60000
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status} from MCP Server: ${errText}`);
            }

            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('text/event-stream')) {
                const text = await res.text();
                const match = text.match(/data:\s*({[\s\S]*})/);
                if (match && match[1]) {
                    data = JSON.parse(match[1]);
                } else {
                    throw new Error('Invalid SSE response from MCP server.');
                }
            } else {
                data = await res.json();
            }
        }

        if (data.error) {
            throw new Error(data.error.message || 'MCP Error');
        }

        return data.result || data;
    }
}
