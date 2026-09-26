import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/providerRegistry';
import { Logger } from '../utils/logger';
import { HelpPanel } from './helpPanel';
import { Message } from '../types';
import { ConfigService } from '../services/configService';
import { McpService } from '../services/mcpService';

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
}

export class ChatSidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'spin-your-ai.chatView';
    private _view?: vscode.WebviewView;
    private _sessions: ChatSession[] = [];
    private _currentSessionId: string | null = null;
    private _currentAbortController?: AbortController;

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
        context: vscode.WebviewViewResolveContext,
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
                this.restoreHistory();
            }
        });

        // Initialize state for webview
        this.sendModels();
        this.restoreHistory();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
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
                    this.restoreHistory();
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
                    }
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
        this._view.webview.postMessage({
            type: 'restoreHistory',
            history: this.currentHistory,
            sessions: this._sessions,
            currentSessionId: this._currentSessionId
        });
    }

    private clearHistory() {
        this._currentSessionId = null;
        if (this._currentAbortController) {
            this._currentAbortController.abort();
            this._currentAbortController = undefined;
        }
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

        this._view.webview.postMessage({
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

        let processedText = text;

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
            }
        }
        
        if (processedText.includes('@workspace')) {
            const workspaceName = vscode.workspace.name || 'Workspace';
            processedText = processedText.replace('@workspace', '') + `\n\n[Workspace context for ${workspaceName} included]`;
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
            this._view.webview.postMessage({ type: 'error', message: 'Provider not found or not configured.' });
            return;
        }

        if (!this._currentSessionId) {
            this._currentSessionId = Date.now().toString();
            const title = text.trim();
            this._sessions.push({
                id: this._currentSessionId,
                title: title.length > 25 ? title.substring(0, 25) + '...' : title,
                createdAt: Date.now(),
                history: []
            });
            this._view?.webview.postMessage({
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

        try {
            const messagesPayload: Message[] = [];
            const systemMessage = ConfigService.get<string>('systemMessage');
            if (systemMessage) {
                messagesPayload.push({ role: 'system', content: systemMessage });
            }

            // Include history (excluding the very last item which is the current raw message we just pushed)
            for (let i = 0; i < history.length - 1; i++) {
                messagesPayload.push({ role: history[i].role, content: history[i].text });
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
                this._view.webview.postMessage({ 
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
                this._view.webview.postMessage({ type: 'error', message: error.message });
            }
        } finally {
            if (this._currentAbortController?.signal.aborted) {
                this._view.webview.postMessage({ type: 'streamChunk', text: '\n\n**[Aborted by user]**', done: true });
            } else {
                this._view.webview.postMessage({ type: 'streamChunk', text: '', done: true });
            }
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
                            <button id="sessions-btn" class="icon-btn" title="Chat History"><span class="material-symbols-outlined">history</span></button>
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
                            <button id="reload-models-btn" class="icon-btn" title="Reload Models"><span class="material-symbols-outlined">refresh</span></button>
                            <button id="export-chat-btn" class="icon-btn" title="Export Chat"><span class="material-symbols-outlined">download</span></button>
                            <button id="new-chat-btn" class="icon-btn" title="New Chat"><span class="material-symbols-outlined">add</span></button>
                            <button id="help-btn" class="icon-btn" title="Help"><span class="material-symbols-outlined">help</span></button>
                            <button id="options-btn" class="icon-btn" title="Settings"><span class="material-symbols-outlined">settings</span></button>
                        </div>
                    </header>

                    <main class="chat-area" id="chat-container">
                        <div class="message system-msg">
                            Welcome to Spin Your AI! Select a model and start chatting.
                        </div>
                        <!-- Messages will be appended here -->
                    </main>

                    <footer class="input-area glassmorphism">
                        <div class="context-toggle">
                            <label class="toggle-pill">
                                <input type="checkbox" id="include-page-context">
                                <span class="pill-text"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">description</span> Include page content</span>
                            </label>
                        </div>
                        <div id="attachment-preview" class="attachment-preview hidden"></div>
                        <div class="input-wrapper">
                            <button id="attach-btn" class="icon-btn" title="Attach file">
                                <span class="material-symbols-outlined">attach_file</span>
                            </button>
                            <input type="file" id="file-input" class="hidden" multiple accept="image/*,audio/*,video/*,.pdf,.html,.htm,.css,.js,.ts,.json,.xml,.csv,.txt,.md,.py,.java,.c,.cpp,.go,.rs,.rb,.sh">
                            <textarea id="chat-input" placeholder="Ask anything..." rows="1"></textarea>
                            <button id="send-btn" class="send-btn" title="Send message">
                                <span class="material-symbols-outlined">send</span>
                            </button>
                            <button id="stop-btn" class="stop-btn hidden" title="Stop generation">
                                <span class="material-symbols-outlined">stop_circle</span>
                            </button>
                        </div>
                    </footer>
                </div>
                
                <div id="sessions-modal" class="modal hidden">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2 style="font-size: 16px; color: var(--text-main);">Chat History</h2>
                            <button id="close-sessions-btn" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                        </div>
                        <div id="sessions-list" class="modal-body sessions-list" style="max-height: 400px; overflow-y: auto;"></div>
                    </div>
                </div>
                
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
