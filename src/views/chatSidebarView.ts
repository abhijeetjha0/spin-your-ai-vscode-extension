import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/providerRegistry';
import { Logger } from '../utils/logger';
import { HelpPanel } from './helpPanel';
import { Message } from '../types';
import { ConfigService } from '../services/configService';
import { McpService } from '../services/mcpService';
import { WorkspaceService } from '../services/workspaceService';
import { AgentToolService } from '../services/agentToolService';
import { ContextCompactor } from '../services/contextCompactor';
import { SubagentService } from '../services/subagentService';
import { SlashCommandService } from '../services/slashCommandService';

interface ChatHistoryItem {
    role: 'user' | 'assistant' | 'system';
    text: string;
    attachments?: Array<{ name: string; type: string; data: string }>;
}

interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    history: ChatHistoryItem[];
    compactedSummary?: string;
    compactedCount?: number;
    savedTokens?: number;
}

export class ChatSidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'spin-your-ai.chatView';
    private _view?: vscode.WebviewView;
    private _sessions: ChatSession[] = [];
    private _currentSessionId: string | null = null;
    private _currentAbortController?: AbortController;
    private _currentStreamingText: string = '';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context?: vscode.ExtensionContext
    ) {
        if (this._context) {
            this._sessions = this._context.workspaceState.get<ChatSession[]>('spinYourAi.chatSessions') || [];
            this._currentSessionId = this._context.workspaceState.get<string>('spinYourAi.currentSessionId') || null;
            
            if (this._sessions.length === 0) {
                const oldHistory = this._context.workspaceState.get<ChatHistoryItem[]>('spinYourAi.chatHistory');
                if (oldHistory && oldHistory.length > 0) {
                    const id = Date.now().toString();
                    this._sessions.push({
                        id,
                        title: 'Previous Chat',
                        createdAt: Date.now(),
                        history: oldHistory
                    });
                    this._currentSessionId = id;
                    this.saveHistory();
                }
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.sendModels();
                if (this._currentAbortController) {
                    this.syncActiveStreamToWebview();
                } else {
                    this.restoreHistory();
                }
            }
        });

        // Initialize state for webview
        this.sendModels();
        if (this._currentAbortController) {
            this.syncActiveStreamToWebview();
        } else {
            this.restoreHistory();
        }

        // Connect built-in agent tool permission requests to this webview
        AgentToolService.setPermissionHandler(async (req) => {
            this.sendMessageToWebview({
                type: 'toolPermissionRequest',
                request: req
            });
            return true;
        });

        // Broadcast sub-agent updates to webview
        SubagentService.onStatusChange((payload) => {
            this.sendMessageToWebview({
                type: 'subagentStatus',
                activeCount: payload.activeCount,
                subagents: payload.subagents
            });
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'toolPermissionResponse':
                    AgentToolService.resolvePermission(data.requestId, !!data.approved);
                    break;
                case 'sendMessage':
                    await this.handleSendMessage(
                        data.text,
                        data.providerId,
                        data.modelId,
                        data.includeContext,
                        data.attachments
                    );
                    break;
                case 'getModels':
                    await this.sendModels();
                    break;
                case 'getHistory':
                    if (this._currentAbortController) {
                        this.syncActiveStreamToWebview();
                    } else {
                        this.restoreHistory();
                    }
                    break;
                case 'clearHistory':
                    this.clearHistory();
                    break;
                case 'setActiveModel':
                    await this.handleSetActiveModel(data.providerId, data.modelId);
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('spin-your-ai.openSettings');
                    break;
                case 'openHelp':
                    HelpPanel.createOrShow(this._extensionUri);
                    break;
                case 'stopGeneration':
                    if (this._currentAbortController) {
                        this._currentAbortController.abort();
                        this._currentAbortController = undefined;
                    }
                    this._currentStreamingText = '';
                    SubagentService.terminateAllActive();
                    break;
                case 'compactContext':
                    await this.handleCompactContext(data.providerId, data.modelId);
                    break;
                case 'exportChat':
                    await this.exportChat();
                    break;
                case 'switchSession':
                    this.switchSession(data.sessionId);
                    break;
                case 'deleteSession':
                    await this.deleteSession(data.sessionId);
                    break;
                case 'getSubagents':
                    this.sendMessageToWebview({
                        type: 'subagentStatus',
                        activeCount: SubagentService.getActiveCount(),
                        subagents: SubagentService.getSubagents()
                    });
                    break;
                case 'terminateSubagent':
                    SubagentService.terminateSubagent(data.subagentId);
                    break;
                case 'clearSubagents':
                    SubagentService.clearSubagents();
                    break;
                case 'getSlashCommands': {
                    const commands = await SlashCommandService.filterCommands(data.query || '', !!data.forceRefresh);
                    this.sendMessageToWebview({
                        type: 'slashCommandsResult',
                        commands,
                        requestId: data.requestId
                    });
                    break;
                }
                case 'executeSlashAction': {
                    switch (data.actionId) {
                        case 'compact':
                            await this.handleCompactContext(data.providerId, data.modelId);
                            break;
                        case 'history':
                            this.sendMessageToWebview({ type: 'openHistoryModal' });
                            break;
                        case 'refresh':
                            await this.sendModels();
                            await SlashCommandService.discoverSkills(true);
                            this.sendMessageToWebview({ type: 'toast', message: 'Refreshed models and workspace skills' });
                            break;
                        case 'clear':
                            this.clearHistory();
                            break;
                        case 'help':
                            HelpPanel.createOrShow(this._extensionUri);
                            break;
                    }
                    break;
                }
                case 'setAgentPermissionMode': {
                    const mode = data.mode as string;
                    if (data.remember && this._context) {
                        await this._context.workspaceState.update('spinYourAi.agentPermissionMode', mode);
                    }
                    AgentToolService.setPermissionMode(mode as any);
                    break;
                }
                case 'getAgentPermissionMode': {
                    const savedMode = this._context?.workspaceState.get<string>('spinYourAi.agentPermissionMode') || 'prompt';
                    AgentToolService.setPermissionMode(savedMode as any);
                    this.sendMessageToWebview({ type: 'agentPermissionMode', mode: savedMode });
                    break;
                }
            }
        });
    }

    public sendMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public sendExternalPrompt(prompt: string, autoSend: boolean = false) {
        this.sendMessageToWebview({
            type: 'populateInput',
            text: prompt,
            autoSend
        });
    }

    private get currentHistory(): ChatHistoryItem[] {
        if (!this._currentSessionId) return [];
        const session = this._sessions.find(s => s.id === this._currentSessionId);
        return session ? session.history : [];
    }

    private restoreHistory() {
        if (!this._view) { return; }
        const currentSession = this._sessions.find(s => s.id === this._currentSessionId);
        this.sendMessageToWebview({
            type: 'restoreHistory',
            history: this.currentHistory,
            sessions: this._sessions,
            currentSessionId: this._currentSessionId,
            compactedSummary: currentSession?.compactedSummary,
            compactedCount: currentSession?.compactedCount,
            savedTokens: currentSession?.savedTokens,
            isGenerating: !!this._currentAbortController
        });
    }

    private syncActiveStreamToWebview() {
        if (!this._view) { return; }
        this.sendMessageToWebview({
            type: 'syncActiveStream',
            text: this._currentStreamingText,
            activeCount: SubagentService.getActiveCount(),
            subagents: SubagentService.getSubagents(),
            isGenerating: !!this._currentAbortController,
            history: this.currentHistory
        });
    }

    private async handleCompactContext(providerId?: string, modelId?: string) {
        if (!this._currentSessionId) {
            this.sendMessageToWebview({ type: 'toast', message: 'No active session to compact.' });
            return;
        }

        const session = this._sessions.find(s => s.id === this._currentSessionId);
        if (!session || session.history.length <= ContextCompactor.PRESERVED_RECENT_TURNS) {
            this.sendMessageToWebview({
                type: 'toast',
                message: `Need at least ${ContextCompactor.PRESERVED_RECENT_TURNS + 1} messages to compact context.`
            });
            return;
        }

        const provider = providerId ? ProviderRegistry.getProvider(providerId) : undefined;
        const result = await ContextCompactor.compactHistory(session.history, provider, modelId);

        if (result.compactedCount > 0) {
            session.compactedSummary = result.summary;
            session.compactedCount = result.compactedCount;
            session.savedTokens = result.savedTokens;
            await this.saveHistory();

            this.sendMessageToWebview({
                type: 'contextCompacted',
                compactedCount: result.compactedCount,
                savedTokens: result.savedTokens,
                summary: result.summary
            });
        }
    }

    private clearHistory() {
        this._currentSessionId = null;
        if (this._currentAbortController) {
            this._currentAbortController.abort();
            this._currentAbortController = undefined;
        }
        this._currentStreamingText = '';
        SubagentService.clearSubagents();
        this.saveHistory();
        this.restoreHistory();
    }

    private switchSession(sessionId: string) {
        if (this._sessions.find(s => s.id === sessionId)) {
            this._currentSessionId = sessionId;
            this.saveHistory();
            this.restoreHistory();
        }
    }

    private async deleteSession(sessionId: string) {
        this._sessions = this._sessions.filter(s => s.id !== sessionId);
        if (this._currentSessionId === sessionId) {
            this._currentSessionId = this._sessions.length > 0 ? this._sessions[0].id : null;
        }
        await this.saveHistory();
        this.restoreHistory();
    }

    private async saveHistory() {
        if (this._context) {
            await this._context.workspaceState.update('spinYourAi.chatSessions', this._sessions);
            await this._context.workspaceState.update('spinYourAi.currentSessionId', this._currentSessionId);
        }
    }

    private async sendModels() {
        if (!this._view) { return; }
        McpService.invalidateCache();
        const providers = ProviderRegistry.getAllProviders();
        const providersMap: Record<string, { name: string; models: any[] }> = {};

        // Probe all providers in parallel - only those that successfully return models are shown
        await Promise.all(providers.map(async (p) => {
            const isEnabled = ConfigService.get<boolean>(`${p.id}.enabled`) ?? true;
            if (!isEnabled) { return; }
            
            const provider = ProviderRegistry.getProvider(p.id);
            if (!provider) { return; }
            try {
                const models = await provider.listModels();
                if (models && models.length > 0) {
                    providersMap[p.id] = {
                        name: p.name,
                        models
                    };
                }
            } catch (err) {
                Logger.error(`Failed to list models for ${p.id}`, err);
            }
        }));

        let activeModel = this._context?.globalState.get<{ providerId: string; modelId: string }>('spinYourAi.activeModel');
        
        // If the saved active model is no longer available in probed providers, find the first available model
        const availableValues = Object.entries(providersMap).flatMap(([pId, data]) => 
            data.models.map((m: any) => ({ providerId: pId, modelId: m.id }))
        );

        if (availableValues.length > 0) {
            const isMatch = activeModel && availableValues.some(v => v.providerId === activeModel!.providerId && v.modelId === activeModel!.modelId);
            if (!isMatch) {
                activeModel = availableValues[0];
            }
        } else {
            activeModel = undefined;
        }

        this.sendMessageToWebview({
            type: 'setModels',
            providers: providersMap,
            activeModel
        });
    }

    private async handleSetActiveModel(providerId: string, modelId: string) {
        if (this._context) {
            await this._context.globalState.update('spinYourAi.activeModel', { providerId, modelId });
        }
    }

    private async handleSendMessage(
        text: string,
        providerId: string,
        modelId: string,
        includeContext?: boolean,
        attachments?: Array<{ name: string; type: string; data: string }>
    ) {
        if (!this._view) { return; }

        SubagentService.resetTurnSubagentCount();

        let processedText = text;
        let extractedContext = '';

        // Context inclusion: grab active editor content if requested or @file tag
        if (includeContext || processedText.includes('@file')) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const selection = editor.selection;
                const selectedText = selection && !selection.isEmpty ? document.getText(selection) : '';
                const codeContent = selectedText || document.getText();
                const fileContext = `\n\n--- Active File: ${document.fileName} ---\n\`\`\`\n${codeContent}\n\`\`\`\n--- End File ---`;
                processedText = processedText.replace('@file', '') + fileContext;
                extractedContext += fileContext;
            }
        }
        
        if (processedText.includes('@workspace')) {
            const workspaceContext = await WorkspaceService.getWorkspaceContext();
            const wsBlock = `\n\n--- Workspace Context ---\n${workspaceContext}\n--- End Workspace Context ---`;
            processedText = processedText.replace('@workspace', '') + wsBlock;
            extractedContext += wsBlock;
        }

        // Attachments text extraction for non-images
        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                if (att.type.startsWith('text/') || att.name.match(/\.(ts|js|json|py|md|html|css|txt|sh|c|cpp|go|rs|rb|java)$/i)) {
                    try {
                        const decoded = Buffer.from(att.data, 'base64').toString('utf8');
                        processedText += `\n\n--- Attached File: ${att.name} ---\n\`\`\`\n${decoded}\n\`\`\`\n`;
                    } catch {
                        // ignore decode errors
                    }
                }
            }
        }

        const provider = ProviderRegistry.getProvider(providerId);
        if (!provider) {
            this.sendMessageToWebview({ type: 'error', message: 'Provider not found or not configured.' });
            return;
        }

        SubagentService.setActiveTurnContext({
            provider,
            modelId,
            attachments: attachments || [],
            defaultContext: extractedContext.trim() || undefined
        });

        if (!this._currentSessionId) {
            this._currentSessionId = Date.now().toString();
            const title = text.trim();
            this._sessions.push({
                id: this._currentSessionId,
                title: title.length > 25 ? title.substring(0, 25) + '...' : title,
                createdAt: Date.now(),
                history: []
            });
            this.sendMessageToWebview({
                type: 'updateSessions',
                sessions: this._sessions,
                currentSessionId: this._currentSessionId
            });
        }

        const history = this.currentHistory;
        
        // Save user message to persistent history
        history.push({
            role: 'user',
            text: text,
            attachments: attachments
        });
        await this.saveHistory();

        this._currentAbortController = new AbortController();
        let fullResponseText = '';
        this._currentStreamingText = '';

        try {
            const messagesPayload: Message[] = [];
            const userSystemMessage = ConfigService.get<string>('systemMessage') || '';
            const subagentDirective = 'When using the spin_subagent tool, only spin the exact number of sub-agents requested by the user. Sub-agents are autonomous leaf workers. Once all requested sub-agents complete, synthesize their results and directly answer the user without spinning further sub-agents. When multiple files or searches are needed, invoke tools in parallel in a single turn or use workspace_read_files to minimize round-trip turns.';
            const systemMessage = userSystemMessage ? `${userSystemMessage}\n\n${subagentDirective}` : subagentDirective;
            messagesPayload.push({ role: 'system', content: systemMessage });

            const session = this._sessions.find(s => s.id === this._currentSessionId);
            const priorHistory = history.slice(0, history.length - 1);

            // Context Compaction: Check if history is compacted or exceeds auto-compact threshold
            if (session?.compactedSummary && session.compactedCount) {
                messagesPayload.push({ role: 'system', content: session.compactedSummary });
                for (let i = session.compactedCount; i < priorHistory.length; i++) {
                    messagesPayload.push({ role: priorHistory[i].role, content: priorHistory[i].text });
                }
            } else if (
                priorHistory.length >= ContextCompactor.AUTO_COMPACT_MIN_TURNS ||
                ContextCompactor.estimateHistoryTokens(priorHistory) >= ContextCompactor.AUTO_COMPACT_TOKEN_THRESHOLD
            ) {
                const compaction = await ContextCompactor.compactHistory(priorHistory);
                if (compaction.compactedCount > 0) {
                    if (session) {
                        session.compactedSummary = compaction.summary;
                        session.compactedCount = compaction.compactedCount;
                        session.savedTokens = compaction.savedTokens;
                        await this.saveHistory();
                    }

                    messagesPayload.push({ role: 'system', content: compaction.summary });
                    for (let i = compaction.compactedCount; i < priorHistory.length; i++) {
                        messagesPayload.push({ role: priorHistory[i].role, content: priorHistory[i].text });
                    }

                    this.sendMessageToWebview({
                        type: 'contextCompacted',
                        compactedCount: compaction.compactedCount,
                        savedTokens: compaction.savedTokens,
                        summary: compaction.summary
                    });
                } else {
                    for (let i = 0; i < priorHistory.length; i++) {
                        messagesPayload.push({ role: priorHistory[i].role, content: priorHistory[i].text });
                    }
                }
            } else {
                for (let i = 0; i < priorHistory.length; i++) {
                    messagesPayload.push({ role: priorHistory[i].role, content: priorHistory[i].text });
                }
            }

            // Append the current message with fully processed text (includes context and attachments)
            messagesPayload.push({ role: 'user', content: processedText });

            const stream = provider.streamChat(
                messagesPayload,
                modelId,
                this._currentAbortController.signal
            );
            
            for await (const chunk of stream) {
                fullResponseText += chunk.text;
                this._currentStreamingText = fullResponseText;
                this.sendMessageToWebview({ 
                    type: 'streamChunk', 
                    text: chunk.text, 
                    done: chunk.done 
                });
            }

            // Save assistant message to persistent history
            if (fullResponseText) {
                const session = this._sessions.find(s => s.id === this._currentSessionId);
                if (session) {
                    session.history.push({
                        role: 'assistant',
                        text: fullResponseText
                    });
                    await this.saveHistory();
                }
            }
        } catch (error: any) {
            if (!this._currentAbortController?.signal.aborted) {
                Logger.error('Chat error', error);
                this.sendMessageToWebview({ type: 'error', message: error.message });
            }
        } finally {
            if (this._currentAbortController?.signal.aborted) {
                this.sendMessageToWebview({ type: 'streamChunk', text: '\n\n**[Aborted by user]**', done: true });
            } else {
                this.sendMessageToWebview({ type: 'streamChunk', text: '', done: true });
            }
            this._currentStreamingText = '';
            this._currentAbortController = undefined;
        }
    }

    private async exportChat() {
        const history = this.currentHistory;
        if (history.length === 0) {
            vscode.window.showWarningMessage('No chat history to export.');
            return;
        }

        const messages = history.map(item => ({
            role: item.role,
            content: item.text
        }));

        const exportData = {
            metadata: {
                format: 'openai_messages',
                version: '1.0',
                exported_at: new Date().toISOString(),
                source: 'spin-your-ai-vscode',
                message_count: messages.length
            },
            messages
        };

        const json = JSON.stringify(exportData, null, 2);

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`chat_export_${Date.now()}.json`),
            filters: { 'JSON': ['json'] },
            title: 'Export Chat as AI Memory'
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
            vscode.window.showInformationMessage(`Chat exported to ${uri.fsPath}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat', 'style.css'));
        
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: https:;">
                <link href="${styleUri}" rel="stylesheet">
                <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
                <title>Spin Your AI</title>
            </head>
            <body>
                <div class="app-container">
                    <header class="header glassmorphism">
                        <div class="header-left" style="margin-right: 12px; display: flex; align-items: center;">
                            <button id="sessions-btn" class="icon-btn" title="Chat History" data-tooltip="Chat History"><span class="material-symbols-outlined">history</span></button>
                        </div>
                        <div class="model-combobox" id="model-combobox">
                            <div class="model-combobox-trigger" id="model-trigger">
                                <span class="material-symbols-outlined combobox-icon">smart_toy</span>
                                <span id="model-display-name">Select Model...</span>
                                <span class="material-symbols-outlined combobox-chevron">expand_more</span>
                            </div>
                            <div class="model-combobox-dropdown hidden" id="model-dropdown">
                                <div class="model-search-wrapper">
                                    <span class="material-symbols-outlined">search</span>
                                    <input type="text" id="model-search" placeholder="Search models..." autocomplete="off">
                                </div>
                                <div id="model-list" class="model-list"></div>
                            </div>
                        </div>
                        <div class="header-actions">
                            <button id="agent-permission-btn" class="icon-btn" title="Agent Permission Mode" data-tooltip="Agent Permission Mode"><span class="material-symbols-outlined">security</span></button>
                            <button id="new-chat-btn" class="icon-btn" title="New Chat" data-tooltip="New Chat"><span class="material-symbols-outlined">add</span></button>
                            <button id="options-btn" class="icon-btn" title="Settings" data-tooltip="Settings"><span class="material-symbols-outlined">settings</span></button>
                            <div class="kebab-wrapper">
                                <button id="more-btn" class="icon-btn" title="More Options" data-tooltip="More Options"><span class="material-symbols-outlined">more_vert</span></button>
                                <div id="kebab-menu" class="kebab-menu hidden">
                                    <div class="kebab-menu-title">MORE OPTIONS</div>
                                    <button id="compact-btn" class="kebab-item" title="Compact Context (Save Tokens)">
                                        <span class="material-symbols-outlined">compress</span><span>Compact Context</span>
                                    </button>
                                    <button id="reload-models-btn" class="kebab-item" title="Reload Models">
                                        <span class="material-symbols-outlined">refresh</span><span>Reload Models</span>
                                    </button>
                                    <button id="export-chat-btn" class="kebab-item" title="Export Chat">
                                        <span class="material-symbols-outlined">download</span><span>Export Chat</span>
                                    </button>
                                    <button id="help-btn" class="kebab-item" title="Help">
                                        <span class="material-symbols-outlined">help</span><span>Help</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </header>

                    <main class="chat-area" id="chat-container">
                        <div class="message system-msg">
                            Welcome to Spin Your AI! Select a model and start chatting.
                        </div>
                        <!-- Messages will be appended here -->
                    </main>

                    <footer class="input-area glassmorphism">
                        <!-- Slash commands suggestions popover -->
                        <div id="slash-commands-popover" class="slash-commands-popover hidden">
                            <div class="slash-commands-header">
                                <span class="material-symbols-outlined" style="font-size: 14px; color: var(--text-ai, #7dd3fc);">terminal</span>
                                <span>COMMANDS &amp; SKILLS</span>
                                <span style="margin-left: auto; font-size: 10px; color: var(--text-muted, #94a3b8);">↑↓ navigate &bull; ↵ select &bull; esc close</span>
                            </div>
                            <div id="slash-commands-list" class="slash-commands-list"></div>
                        </div>

                        <div class="context-toggle">
                            <label class="toggle-pill">
                                <input type="checkbox" id="include-page-context">
                                <span class="pill-text"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">description</span> Include page content</span>
                            </label>
                        </div>
                        <div id="attachment-preview" class="attachment-preview hidden"></div>
                        <div class="input-wrapper">
                            <button id="attach-btn" class="icon-btn" title="Attach file" data-tooltip="Attach file">
                                <span class="material-symbols-outlined">attach_file</span>
                            </button>
                            <input type="file" id="file-input" class="hidden" multiple accept="image/*,audio/*,video/*,.pdf,.html,.htm,.css,.js,.ts,.json,.xml,.csv,.txt,.md,.py,.java,.c,.cpp,.go,.rs,.rb,.sh">
                            <textarea id="chat-input" placeholder="Ask anything... (/ for commands &amp; skills)" rows="1"></textarea>
                            <button id="send-btn" class="send-btn" title="Send message" data-tooltip="Send message">
                                <span class="material-symbols-outlined">send</span>
                            </button>
                            <button id="stop-btn" class="stop-btn hidden" title="Stop generation" data-tooltip="Stop generation">
                                <span class="material-symbols-outlined">stop_circle</span>
                            </button>
                        </div>
                    </footer>
                </div>
                
                <div id="sessions-modal" class="modal hidden">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2 style="font-size: 16px; color: var(--text-main);">Chat History</h2>
                            <button id="close-sessions-btn" class="icon-btn" title="Close" data-tooltip="Close"><span class="material-symbols-outlined">close</span></button>
                        </div>
                        <div id="sessions-list" class="modal-body sessions-list" style="max-height: 400px; overflow-y: auto;"></div>
                    </div>
                </div>

                <!-- Sub-Agents Monitor Modal -->
                <div id="subagents-modal" class="modal hidden">
                    <div class="modal-content subagents-modal-content">
                        <div class="modal-header">
                            <div class="modal-title-wrapper" style="display: flex; align-items: center; gap: 8px;">
                                <span class="material-symbols-outlined" style="color: #38bdf8; font-size: 18px;">account_tree</span>
                                <h2 style="font-size: 13px; color: var(--text-main); font-weight: bold; letter-spacing: 0.08em; margin: 0;">SUB-AGENTS MONITOR</h2>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button id="clear-subagents-btn" class="icon-btn" title="Reset Inactive Sub-Agents" data-tooltip="Reset Inactive Sub-Agents"><span class="material-symbols-outlined">delete_sweep</span></button>
                                <button id="close-subagents-btn" class="icon-btn" title="Close" data-tooltip="Close"><span class="material-symbols-outlined">close</span></button>
                            </div>
                        </div>
                        <div class="modal-body subagents-list-body" id="subagents-list-container">
                            <!-- Sub-agent cards rendered dynamically -->
                        </div>
                    </div>
                </div>

                <!-- Agent Permission Mode Modal -->
                <div id="agent-mode-modal" class="modal hidden">
                    <div class="modal-content agent-mode-content">
                        <div class="modal-header">
                            <div class="modal-title-wrapper" style="display: flex; align-items: center; gap: 8px;">
                                <span class="material-symbols-outlined" style="color: #a78bfa; font-size: 18px;">security</span>
                                <h2 style="font-size: 13px; color: var(--text-main); font-weight: bold; letter-spacing: 0.08em; margin: 0;">WORKSPACE AGENT PERMISSIONS</h2>
                            </div>
                            <button id="close-agent-mode-btn" class="icon-btn" title="Close" data-tooltip="Close"><span class="material-symbols-outlined">close</span></button>
                        </div>
                        <div class="agent-mode-body">
                            <p class="agent-mode-intro">Select permission mode for workspace file modification tools:</p>
                            <div class="mode-cards" id="mode-cards-container">
                                <label class="mode-card" data-mode="prompt">
                                    <input type="radio" name="workspace-agent-mode" value="prompt" checked>
                                    <div class="mode-card-inner">
                                        <div class="mode-card-header">
                                            <span class="mode-card-title">PROMPT</span>
                                            <span class="mode-badge badge-prompt">ASK EACH TIME</span>
                                        </div>
                                        <p class="mode-card-desc">Read-only tools run automatically. File writes and edits show a diff card and require your approval before applying.</p>
                                    </div>
                                </label>
                                <label class="mode-card" data-mode="allow_all">
                                    <input type="radio" name="workspace-agent-mode" value="allow_all">
                                    <div class="mode-card-inner">
                                        <div class="mode-card-header">
                                            <span class="mode-card-title">ALLOW ALL</span>
                                            <span class="mode-badge badge-auto">FULL AUTONOMOUS</span>
                                        </div>
                                        <p class="mode-card-desc">All workspace tools including file writes and edits execute automatically without confirmation prompts.</p>
                                    </div>
                                </label>
                                <label class="mode-card" data-mode="read_only">
                                    <input type="radio" name="workspace-agent-mode" value="read_only">
                                    <div class="mode-card-inner">
                                        <div class="mode-card-header">
                                            <span class="mode-card-title">READ ONLY</span>
                                            <span class="mode-badge badge-block">STRICT READ-ONLY</span>
                                        </div>
                                        <p class="mode-card-desc">Only read-only workspace tools are available. File writes and edits are blocked entirely.</p>
                                    </div>
                                </label>
                            </div>
                            <div class="mode-remember-row">
                                <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); cursor: pointer;">
                                    <input type="checkbox" id="remember-agent-mode" checked style="accent-color: #a78bfa;">
                                    <span>Remember selection for this workspace</span>
                                </label>
                            </div>
                        </div>
                        <div class="modal-footer" style="padding-top: 10px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 8px;">
                            <button id="save-agent-mode-btn" class="agent-btn agent-btn-allow">
                                <span class="material-symbols-outlined">check</span> SAVE
                            </button>
                        </div>
                    </div>
                </div>
                
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
