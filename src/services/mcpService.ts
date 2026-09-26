import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

export class McpService {
    private static context: vscode.ExtensionContext;
    private static cachedTools: McpToolDefinition[] | null = null;
    private static cacheTimestamp = 0;
    private static readonly CACHE_TTL_MS = 60000; // 1 minute

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
        const config = vscode.workspace.getConfiguration('spinYourAi');
        const enabled = config.get<boolean>('mcp.enabled');
        if (enabled !== undefined) {
            return enabled;
        }
        return this.context?.globalState.get<boolean>('spinYourAi.mcp.enabled', true) ?? true;
    }

    public static async setEnabled(enabled: boolean): Promise<void> {
        await vscode.workspace.getConfiguration('spinYourAi').update('mcp.enabled', enabled, vscode.ConfigurationTarget.Global);
        await this.context?.globalState.update('spinYourAi.mcp.enabled', enabled);
        this.invalidateCache();
    }

    public static invalidateCache() {
        this.cachedTools = null;
        this.cacheTimestamp = 0;
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
                if (!url) {
                    serverStatuses[key] = { status: 'error', error: 'Missing "url" property' };
                    continue;
                }

                if (s.command && s.command !== 'http' && s.type !== 'http') {
                    serverStatuses[key] = { status: 'error', error: 'Only HTTP/SSE MCP endpoints are supported' };
                    continue;
                }

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                };
                if (s.env) {
                    Object.assign(headers, s.env);
                }
                if (s.headers) {
                    Object.assign(headers, s.headers);
                }

                try {
                    const res = await HttpService.fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
                        timeout: 10000
                    });

                    if (res.ok) {
                        const contentType = res.headers.get('content-type') || '';
                        let data: any;

                        if (contentType.includes('text/event-stream')) {
                            const text = await res.text();
                            const match = text.match(/data:\s*({.*})/);
                            if (match && match[1]) {
                                data = JSON.parse(match[1]);
                            } else {
                                serverStatuses[key] = { status: 'error', error: 'Invalid SSE response from MCP server' };
                                continue;
                            }
                        } else {
                            data = await res.json();
                        }

                        if (data.error) {
                            serverStatuses[key] = { status: 'error', error: data.error.message || 'MCP Error' };
                        } else {
                            const toolCount = data.result?.tools?.length || 0;
                            serverStatuses[key] = { status: 'connected', toolCount };
                            successCount++;
                        }
                    } else {
                        const errText = await res.text();
                        serverStatuses[key] = { status: 'error', error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
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
                if (!url) { continue; }
                if (s.command && s.command !== 'http' && s.type !== 'http') { continue; }

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream'
                };
                if (s.env) { Object.assign(headers, s.env); }
                if (s.headers) { Object.assign(headers, s.headers); }

                try {
                    const res = await HttpService.fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
                        timeout: 8000
                    });

                    if (res.ok) {
                        const contentType = res.headers.get('content-type') || '';
                        let data: any;

                        if (contentType.includes('text/event-stream')) {
                            const text = await res.text();
                            const match = text.match(/data:\s*({.*})/);
                            if (match && match[1]) {
                                data = JSON.parse(match[1]);
                            }
                        } else {
                            data = await res.json();
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
        if (!url) {
            throw new Error(`MCP server "${serverKey}" has no URL configured.`);
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        };
        if (serverConf.env) { Object.assign(headers, serverConf.env); }
        if (serverConf.headers) { Object.assign(headers, serverConf.headers); }

        const res = await HttpService.fetch(url, {
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
        let data: any;

        if (contentType.includes('text/event-stream')) {
            const text = await res.text();
            const match = text.match(/data:\s*({.*})/);
            if (match && match[1]) {
                data = JSON.parse(match[1]);
            } else {
                throw new Error('Invalid SSE response from MCP server.');
            }
        } else {
            data = await res.json();
        }

        if (data.error) {
            throw new Error(data.error.message || 'MCP Error');
        }

        return data.result || data;
    }
}
