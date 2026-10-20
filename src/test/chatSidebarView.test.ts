import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChatSidebarViewProvider } from '../views/chatSidebarView';
import { ProviderRegistry } from '../providers/providerRegistry';

describe('ChatSidebarView Context & Stream Retention', () => {
    let mockContext: any;
    let workspaceStateStore: Map<string, any>;
    let globalStateStore: Map<string, any>;
    let postedMessages: any[];
    let visibilityListener: (() => void) | undefined;
    let messageListener: ((msg: any) => Promise<void>) | undefined;
    let mockWebviewView: any;

    beforeEach(() => {
        workspaceStateStore = new Map();
        globalStateStore = new Map();
        postedMessages = [];
        visibilityListener = undefined;
        messageListener = undefined;

        mockContext = {
            workspaceState: {
                get: (k: string) => workspaceStateStore.get(k),
                update: (k: string, v: any) => {
                    workspaceStateStore.set(k, v);
                    return Promise.resolve();
                }
            },
            globalState: {
                get: (k: string) => globalStateStore.get(k),
                update: (k: string, v: any) => {
                    globalStateStore.set(k, v);
                    return Promise.resolve();
                }
            }
        };

        mockWebviewView = {
            webview: {
                options: {},
                html: '',
                asWebviewUri: (u: any) => u,
                postMessage: (msg: any) => {
                    postedMessages.push(msg);
                    return Promise.resolve(true);
                },
                onDidReceiveMessage: (fn: any) => {
                    messageListener = fn;
                    return { dispose: () => {} };
                }
            },
            visible: true,
            onDidChangeVisibility: (fn: any) => {
                visibilityListener = fn;
                return { dispose: () => {} };
            }
        };
    });

    it('resolves webview view, attaches listeners, and sends initial models and history', () => {
        const uri = vscode.Uri.file('/mock/extension');
        const provider = new ChatSidebarViewProvider(uri, mockContext);

        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

        assert.ok(mockWebviewView.webview.html.length > 0, 'Webview HTML should be populated');
        assert.ok(visibilityListener !== undefined, 'Visibility listener should be attached');
        assert.ok(messageListener !== undefined, 'Message listener should be attached');

        const restoreMsg = postedMessages.find(m => m.type === 'restoreHistory');
        assert.ok(restoreMsg !== undefined, 'Should post restoreHistory initially');
        assert.strictEqual(restoreMsg.isGenerating, false, 'Initial state isGenerating should be false');
    });

    it('invokes restoreHistory when becoming visible and not generating', () => {
        const uri = vscode.Uri.file('/mock/extension');
        const provider = new ChatSidebarViewProvider(uri, mockContext);

        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
        postedMessages.length = 0; // Clear initial calls

        mockWebviewView.visible = true;
        visibilityListener!();

        const restoreMsg = postedMessages.find(m => m.type === 'restoreHistory');
        assert.ok(restoreMsg !== undefined, 'Should post restoreHistory on visibility change when idle');
        assert.strictEqual(restoreMsg.isGenerating, false);
    });

    it('invokes syncActiveStream instead of restoreHistory on visibility change while generating', () => {
        const uri = vscode.Uri.file('/mock/extension');
        const provider = new ChatSidebarViewProvider(uri, mockContext);

        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
        postedMessages.length = 0;

        // Simulate active generation by setting abort controller and streaming text
        (provider as any)._currentAbortController = new AbortController();
        (provider as any)._currentStreamingText = 'Streaming mid-turn response...';

        mockWebviewView.visible = true;
        visibilityListener!();

        const restoreMsg = postedMessages.find(m => m.type === 'restoreHistory');
        assert.strictEqual(restoreMsg, undefined, 'Must NOT post restoreHistory while generating');

        const syncMsg = postedMessages.find(m => m.type === 'syncActiveStream');
        assert.ok(syncMsg !== undefined, 'Must post syncActiveStream to retain context while generating');
        assert.strictEqual(syncMsg.text, 'Streaming mid-turn response...');
        assert.strictEqual(syncMsg.isGenerating, true);
    });

    it('handles getHistory request by syncing active stream if generating', async () => {
        const uri = vscode.Uri.file('/mock/extension');
        const provider = new ChatSidebarViewProvider(uri, mockContext);

        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
        postedMessages.length = 0;

        (provider as any)._currentAbortController = new AbortController();
        (provider as any)._currentStreamingText = 'Active progress text';

        await messageListener!({ type: 'getHistory' });

        const syncMsg = postedMessages.find(m => m.type === 'syncActiveStream');
        assert.ok(syncMsg !== undefined, 'Must reply to getHistory with syncActiveStream while generating');
        assert.strictEqual(syncMsg.text, 'Active progress text');
    });

    it('clears active stream text and abort controller on stopGeneration', async () => {
        const uri = vscode.Uri.file('/mock/extension');
        const provider = new ChatSidebarViewProvider(uri, mockContext);

        provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

        const abortController = new AbortController();
        (provider as any)._currentAbortController = abortController;
        (provider as any)._currentStreamingText = 'In flight text';

        await messageListener!({ type: 'stopGeneration' });

        assert.strictEqual(abortController.signal.aborted, true, 'Abort controller should be aborted');
        assert.strictEqual((provider as any)._currentAbortController, undefined, 'Abort controller should be cleared');
        assert.strictEqual((provider as any)._currentStreamingText, '', 'Streaming text should be reset');
    });
});
