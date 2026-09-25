import * as vscode from 'vscode';
import { ProviderRegistry } from '../providers/providerRegistry';
import { Logger } from '../utils/logger';

export class ChatSidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'spin-your-ai.chatView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

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
                this.sendProviders();
            }
        });
        this.sendProviders();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleSendMessage(data.text, data.providerId, data.modelId);
                    break;
                case 'getProviders':
                    this.sendProviders();
                    break;
                case 'insertCode':
                    this.insertCodeIntoEditor(data.code);
                    break;
            }
        });
    }

    public sendMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private insertCodeIntoEditor(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
        }
    }

    private sendProviders() {
        if (!this._view) { return; }
        const providers = ProviderRegistry.getAllProviders();
        this._view.webview.postMessage({ type: 'setProviders', providers });
    }

    private async handleSendMessage(text: string, providerId: string, modelId: string) {
        if (!this._view) { return; }

        let processedText = text;

        if (processedText.includes('@file')) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const fileContext = `\n\n--- Current File: ${document.fileName} ---\n${document.getText()}\n--- End File ---`;
                processedText = processedText.replace('@file', '') + fileContext;
            }
        }
        
        if (processedText.includes('@workspace')) {
            const workspaceName = vscode.workspace.name || 'Workspace';
            processedText = processedText.replace('@workspace', '') + `\n\n[Workspace context for ${workspaceName} included]`;
        }

        const provider = ProviderRegistry.getProvider(providerId);
        if (!provider) {
            this._view.webview.postMessage({ type: 'error', message: 'Provider not found' });
            return;
        }

        try {
            const stream = provider.streamChat([{ role: 'user', content: processedText }], modelId);
            
            for await (const chunk of stream) {
                this._view.webview.postMessage({ 
                    type: 'streamChunk', 
                    text: chunk.text, 
                    done: chunk.done 
                });
            }
        } catch (error: any) {
            Logger.error('Chat error', error);
            this._view.webview.postMessage({ type: 'error', message: error.message });
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src ${webview.cspSource};">
                <link href="${styleUri}" rel="stylesheet">
                <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
                <title>Spin Your AI</title>
            </head>
            <body>
                <div class="app-container">
                    <header class="header glassmorphism">
                        <select id="provider-select" style="background: #000; color: #fff; border: 1px solid #333; padding: 6px; font-family: monospace; width: 45%;"></select>
                        <input type="text" id="model-input" placeholder="Model ID..." style="background: #000; color: #fff; border: 1px solid #333; padding: 6px; font-family: monospace; width: 45%;" />
                    </header>

                    <main class="chat-area" id="messages">
                        <div class="message system-msg">
                            Welcome to Spin Your AI! Select a provider and enter a model ID.
                        </div>
                    </main>

                    <footer class="input-area glassmorphism">
                        <div class="input-wrapper" style="flex-wrap: wrap;">
                            <textarea id="message-input" placeholder="Ask AI (@file, @workspace)" rows="2" style="width: 100%; margin-bottom: 8px;"></textarea>
                            <button id="send-button" class="send-btn" style="flex: 1; border-radius: 4px; display: flex; gap: 4px; padding: 4px 0; width: auto; height: auto;">
                                <span class="material-symbols-outlined" style="font-size: 16px;">send</span> Send
                            </button>
                            <button id="insert-button" class="send-btn" style="flex: 1; border-radius: 4px; display: flex; gap: 4px; padding: 4px 0; width: auto; height: auto;">
                                <span class="material-symbols-outlined" style="font-size: 16px;">integration_instructions</span> Insert
                            </button>
                        </div>
                    </footer>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
