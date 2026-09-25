import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { VaultService } from './services/vault';
import { ProviderRegistry } from './providers/providerRegistry';
import { ChatSidebarViewProvider } from './views/chatSidebarView';

export function activate(context: vscode.ExtensionContext) {
    Logger.initialize('Spin Your AI');
    VaultService.initialize(context);
    ProviderRegistry.initialize();
    Logger.log('Extension "spin-your-ai-vscode" is now active!');

    // Register Chat Sidebar
    const chatProvider = new ChatSidebarViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatSidebarViewProvider.viewType, chatProvider)
    );

    // Start command
    const disposable = vscode.commands.registerCommand('spin-your-ai.start', () => {
        vscode.window.showInformationMessage('Spin Your AI is starting...');
    });
    context.subscriptions.push(disposable);

    // Explain Code command
    const explainCommand = vscode.commands.registerCommand('spin-your-ai.explainCode', () => {
        sendEditorSelectionToChat(chatProvider, 'Please explain this code:\n');
    });
    context.subscriptions.push(explainCommand);

    // Refactor Code command
    const refactorCommand = vscode.commands.registerCommand('spin-your-ai.refactorCode', () => {
        sendEditorSelectionToChat(chatProvider, 'Please refactor this code to improve it:\n');
    });
    context.subscriptions.push(refactorCommand);

    // Fix Bug command
    const fixBugCommand = vscode.commands.registerCommand('spin-your-ai.fixBug', () => {
        sendEditorSelectionToChat(chatProvider, 'Please find and fix the bugs in this code:\n');
    });
    context.subscriptions.push(fixBugCommand);

    // API Key commands
    const setOpenAiKey = vscode.commands.registerCommand('spin-your-ai.setOpenAiKey', async () => {
        await promptAndStoreKey('openai', 'OpenAI API Key');
    });
    const setAnthropicKey = vscode.commands.registerCommand('spin-your-ai.setAnthropicKey', async () => {
        await promptAndStoreKey('anthropic', 'Anthropic API Key');
    });
    const setGeminiKey = vscode.commands.registerCommand('spin-your-ai.setGeminiKey', async () => {
        await promptAndStoreKey('gemini', 'Gemini API Key');
    });
    const setOpenRouterKey = vscode.commands.registerCommand('spin-your-ai.setOpenRouterKey', async () => {
        await promptAndStoreKey('openrouter', 'OpenRouter API Key');
    });
    const setHuggingFaceKey = vscode.commands.registerCommand('spin-your-ai.setHuggingFaceKey', async () => {
        await promptAndStoreKey('huggingface', 'Hugging Face API Key');
    });
    const setOllamaCloudKey = vscode.commands.registerCommand('spin-your-ai.setOllamaCloudKey', async () => {
        await promptAndStoreKey('ollamaCloud', 'Ollama Cloud API Key');
    });
    
    context.subscriptions.push(setOpenAiKey, setAnthropicKey, setGeminiKey, setOpenRouterKey, setHuggingFaceKey, setOllamaCloudKey);
}

async function promptAndStoreKey(providerId: string, title: string) {
    const key = await vscode.window.showInputBox({
        title: `Enter ${title}`,
        prompt: `This key will be securely stored in your OS keychain.`,
        password: true,
        ignoreFocusOut: true
    });
    
    if (key) {
        await VaultService.storeKey(providerId, key);
        vscode.window.showInformationMessage(`Successfully saved ${title}!`);
    }
}

function sendEditorSelectionToChat(chatProvider: ChatSidebarViewProvider, promptPrefix: string) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (text) {
            // Open the view if not visible
            vscode.commands.executeCommand('spin-your-ai.chatView.focus');
            
            chatProvider.sendMessageToWebview({
                type: 'populateInput',
                text: `${promptPrefix}\`\`\`\n${text}\n\`\`\`\n`
            });
        } else {
            vscode.window.showWarningMessage('Please select some code first.');
        }
    }
}

export function deactivate() {}
