import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { VaultService } from './services/vault';
import { McpService } from './services/mcpService';
import { ProviderRegistry } from './providers/providerRegistry';
import { ChatSidebarViewProvider } from './views/chatSidebarView';
import { SettingsPanel } from './views/settingsView';
import { ConfigService } from './services/configService';

export function activate(context: vscode.ExtensionContext) {
    Logger.initialize('Spin Your AI');
    ConfigService.initialize(context);
    VaultService.initialize(context);
    McpService.initialize(context);
    ProviderRegistry.initialize();
    Logger.log('Extension "spin-your-ai-vscode" is now active!');

    // Register Chat Sidebar
    const chatProvider = new ChatSidebarViewProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatSidebarViewProvider.viewType, chatProvider)
    );

    const extensionId = context.extension?.id || 'abhijeetjha0.spin-your-ai-vscode';
    const walkthroughId = `${extensionId}#spin-your-ai.welcome`;

    // Auto-launch walkthrough on first install or update
    const WALKTHROUGH_STORAGE_KEY = 'spinYourAi.hasOpenedWalkthrough_v1_0_2';
    const hasOpenedWalkthrough = context.globalState.get<boolean>(WALKTHROUGH_STORAGE_KEY);
    if (!hasOpenedWalkthrough) {
        context.globalState.update(WALKTHROUGH_STORAGE_KEY, true);
        setTimeout(() => {
            vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
        }, 500);
    }

    // Start command
    const startCommand = vscode.commands.registerCommand('spin-your-ai.start', () => {
        vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
        vscode.commands.executeCommand('spin-your-ai.chatView.focus');
    });
    context.subscriptions.push(startCommand);

    // Open Walkthrough command
    const openWalkthroughCommand = vscode.commands.registerCommand('spin-your-ai.openWalkthrough', () => {
        vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthroughId, false);
    });
    context.subscriptions.push(openWalkthroughCommand);

    // Open Settings command (opens dedicated SettingsPanel webview)
    const openSettingsCommand = vscode.commands.registerCommand('spin-your-ai.openSettings', () => {
        SettingsPanel.createOrShow(context.extensionUri);
    });
    context.subscriptions.push(openSettingsCommand);

    // Edit MCP Config command (opens mcp_config.json in editor)
    const editMcpConfigCommand = vscode.commands.registerCommand('spin-your-ai.editMcpConfig', async () => {
        const doc = await vscode.workspace.openTextDocument(McpService.getConfigFileUri());
        await vscode.window.showTextDocument(doc);
    });
    context.subscriptions.push(editMcpConfigCommand);

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

    // Endpoint configuration commands
    const configureOllama = vscode.commands.registerCommand('spin-your-ai.configureOllama', async () => {
        await promptAndStoreConfig('ollama.baseUrl', 'Ollama Endpoint', 'http://localhost:11434');
    });
    const configureHermes = vscode.commands.registerCommand('spin-your-ai.configureHermes', async () => {
        await promptAndStoreConfig('hermes.baseUrl', 'Hermes Endpoint', 'http://localhost:8642/v1');
    });
    const configureOpenCode = vscode.commands.registerCommand('spin-your-ai.configureOpenCode', async () => {
        await promptAndStoreConfig('opencode.baseUrl', 'OpenCode Endpoint', 'http://localhost:3000');
    });
    const configureOpenClaw = vscode.commands.registerCommand('spin-your-ai.configureOpenClaw', async () => {
        await promptAndStoreConfig('openclaw.baseUrl', 'OpenClaw Endpoint', 'http://localhost:3141');
    });
    
    context.subscriptions.push(
        setOpenAiKey,
        setAnthropicKey,
        setGeminiKey,
        setOpenRouterKey,
        setHuggingFaceKey,
        setOllamaCloudKey,
        configureOllama,
        configureHermes,
        configureOpenCode,
        configureOpenClaw
    );
}

async function promptAndStoreConfig(configKey: string, title: string, defaultPlaceholder: string) {
    const currentValue = ConfigService.get<string>(configKey) || defaultPlaceholder;
    const newValue = await vscode.window.showInputBox({
        title: `Configure ${title}`,
        prompt: `Enter the URL/endpoint for ${title}`,
        value: currentValue,
        ignoreFocusOut: true
    });
    
    if (newValue !== undefined) {
        await ConfigService.update(configKey, newValue.trim());
        vscode.window.showInformationMessage(`Successfully updated ${title}!`);
    }
}

async function promptAndStoreKey(providerId: string, title: string) {
    const currentKey = await VaultService.getKey(providerId);
    const newKey = await vscode.window.showInputBox({
        title: `Set ${title}`,
        prompt: `Enter your API key for ${title}`,
        password: true,
        value: currentKey || '',
        ignoreFocusOut: true
    });

    if (newKey !== undefined) {
        if (newKey.trim() === '') {
            await VaultService.deleteKey(providerId);
            vscode.window.showInformationMessage(`${title} cleared successfully.`);
        } else {
            await VaultService.storeKey(providerId, newKey.trim());
            vscode.window.showInformationMessage(`${title} saved successfully.`);
        }
    }
}

function sendEditorSelectionToChat(chatProvider: ChatSidebarViewProvider, prefix: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Please open a file and select some code first.');
        return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const code = selectedText || editor.document.getText();
    const fileName = editor.document.fileName.split(/[\\/]/).pop() || 'file';
    const languageId = editor.document.languageId;

    const prompt = `${prefix}\nFile: \`${fileName}\` (${languageId})\n\`\`\`${languageId}\n${code}\n\`\`\``;
    
    vscode.commands.executeCommand('spin-your-ai.chatView.focus');
    chatProvider.sendExternalPrompt(prompt);
}

export function deactivate() {
    Logger.log('Extension "spin-your-ai-vscode" deactivated.');
}
