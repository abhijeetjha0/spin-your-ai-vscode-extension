import * as vscode from 'vscode';

export class HelpPanel {
    public static currentPanel: HelpPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (HelpPanel.currentPanel) {
            HelpPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'spinYourAiHelp',
            'Spin Your AI - Help',
            column || vscode.ViewColumn.One,
            {
                enableScripts: false,
                retainContextWhenHidden: true,
            }
        );

        HelpPanel.currentPanel = new HelpPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public dispose() {
        HelpPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spin Your AI - Help</title>
  <style>
    :root {
      --bg-color: #050505;
      --panel-bg: #0a0a0a;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #333;
      --success: #10b981;
      --font-mono: 'Courier New', Courier, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-mono);
      background-color: var(--bg-color);
      color: var(--text-main);
      padding: 40px;
      line-height: 1.7;
    }

    .content {
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .logo-icon {
      font-size: 28px;
      color: var(--text-main);
      font-family: 'Courier New', Courier, monospace;
    }

    h1 {
      font-size: 22px;
      letter-spacing: 1px;
      color: var(--text-main);
    }

    .help-section {
      margin-bottom: 36px;
      padding: 24px;
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
    }

    .help-section h2 {
      font-size: 15px;
      color: var(--text-main);
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .help-section p {
      color: var(--text-muted);
      font-size: 13px;
      margin-bottom: 12px;
    }

    .help-section ul {
      list-style: none;
      padding: 0;
    }

    .help-section li {
      color: var(--text-muted);
      font-size: 13px;
      padding: 5px 0 5px 16px;
      border-left: 2px solid var(--border-color);
      margin-bottom: 8px;
    }

    .help-section li strong {
      color: var(--text-main);
    }

    code {
      background: #000;
      border: 1px solid var(--border-color);
      padding: 1px 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #7dd3fc;
    }

    .badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      background: #002200;
      border: 1px solid var(--success);
      color: var(--success);
      vertical-align: middle;
      margin-left: 6px;
    }
  </style>
</head>
<body>
  <div class="content">
    <header class="header">
      <span class="logo-icon">&gt;_</span>
      <h1>Spin Your AI &mdash; Help Center</h1>
    </header>

    <main>
      <section class="help-section">
        <h2>1. Getting Started</h2>
        <p>Spin Your AI connects to multiple AI models directly from your editor. To begin:</p>
        <ul>
          <li>Open the <strong>Settings</strong> page via the gear icon in the chat sidebar, or run the command <code>Spin Your AI: Open Settings</code>.</li>
          <li>Enter your <strong>API Keys</strong> for cloud providers you wish to use (OpenAI, Anthropic, Gemini, etc.).</li>
          <li>For local providers like <strong>Ollama</strong>, ensure your local server is running. It auto-connects to <code>http://localhost:11434</code> with no config needed.</li>
          <li>For agents like <strong>OpenCode</strong>, <strong>Hermes</strong>, or <strong>OpenClaw</strong>, set the correct host URL in Settings.</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>2. Using the Chat Sidebar</h2>
        <p>The main chat interface lives in the VS Code sidebar panel.</p>
        <ul>
          <li><strong>Select a Model:</strong> Click the model dropdown at the top to switch between available AI providers and models.</li>
          <li><strong>Include Page Content:</strong> Toggle &ldquo;Include page content&rdquo; to automatically inject your active editor file into the prompt.</li>
          <li><strong>@file tag:</strong> Type <code>@file</code> anywhere in your message to inject your active editor file.</li>
          <li><strong>@workspace tag:</strong> Type <code>@workspace</code> to include the workspace name in context.</li>
          <li><strong>Attachments:</strong> Click the paperclip icon to upload images, documents, or code files to send to multimodal models.</li>
          <li><strong>New Chat:</strong> Click the trash icon at the top to reset the conversation history.</li>
          <li><strong>Stop Generation:</strong> Click the stop button to cancel a running response stream.</li>
          <li><strong>Code Actions:</strong> Right-click selected code in the editor and choose <strong>Spin Your AI: Explain Code</strong>, <strong>Refactor Code</strong>, or <strong>Fix Bug</strong>.</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>3. Providers Reference</h2>
        <ul>
          <li><strong>Ollama (Local):</strong> Zero config. Connects to <code>http://localhost:11434</code>. Configure endpoint in Settings if needed.</li>
          <li><strong>OpenAI:</strong> Requires API key. Access GPT-4o and o-series models.</li>
          <li><strong>Anthropic:</strong> Requires API key. Access Claude Sonnet and Opus models.</li>
          <li><strong>Google Gemini:</strong> Requires API key. Access Gemini 1.5 Pro, 2.0 Flash, and more.</li>
          <li><strong>OpenRouter:</strong> Aggregator. Requires API key. Access hundreds of hosted models.</li>
          <li><strong>Hugging Face:</strong> Requires API key. Access serverless inference for text-generation models on HF Hub.</li>
          <li><strong>Ollama Cloud:</strong> Requires API key. Access Ollama&rsquo;s managed cloud models.</li>
          <li><strong>Hermes:</strong> Local agent. Set your Hermes Desktop endpoint URL in Settings.</li>
          <li><strong>OpenCode:</strong> Local agent. Set your OpenCode server endpoint URL in Settings.</li>
          <li><strong>OpenClaw:</strong> Local agent. Set your OpenClaw endpoint URL in Settings.</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>4. Model Context Protocol (MCP) &amp; Agents</h2>
        <p>Spin Your AI supports agentic behavior via the Model Context Protocol (MCP).</p>
        <ul>
          <li><strong>JSON Config:</strong> In Settings, use the <strong>MCP Servers</strong> JSON editor to configure your HTTP/SSE MCP servers (e.g., n8n-mcp).</li>
          <li><strong>Tool Calling:</strong> When using capable models (OpenAI, Gemini, Anthropic), the model autonomously executes tools from your MCP servers during chat.</li>
          <li><strong>Toggle:</strong> Use the enable/disable switch on the MCP card in Settings to turn tool calling on or off without losing your config.</li>
          <li><strong>Supported:</strong> Only HTTP/SSE MCP endpoints are supported. Standard stdio MCP servers are not supported.</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>5. Data Privacy &amp; Security</h2>
        <p>Your data stays with you. Spin Your AI is a secure, local-first extension.</p>
        <ul>
          <li>All API keys are encrypted and stored in your <strong>OS native keychain</strong> (macOS Keychain, Windows Credential Manager, Linux Secret Service) via VS Code&rsquo;s <code>SecretStorage</code> API.</li>
          <li>Keys are <strong>never</strong> stored in <code>settings.json</code>, synced to external servers, or transmitted beyond the direct API call to your chosen provider.</li>
          <li>Endpoint URLs (Ollama, Hermes, etc.) are stored in VS Code workspace/global settings (<code>spinYourAi.*</code>) as plain strings &mdash; no secrets.</li>
          <li>The Settings webview never echoes raw API key values back into the UI. Only a <strong>Configured</strong> <span class="badge">&#10003;</span> badge is shown when a key exists.</li>
        </ul>
      </section>

      <section class="help-section">
        <h2>6. Troubleshooting</h2>
        <ul>
          <li>If a provider shows <strong>No models</strong> in the dropdown, click <strong>Test Connection</strong> in Settings to verify your credentials or endpoint.</li>
          <li>Ensure you have sufficient API credits on your provider&rsquo;s dashboard if cloud calls fail.</li>
          <li>For Ollama, verify the local server is running: <code>ollama serve</code>.</li>
          <li>For MCP servers, verify the JSON config is valid and the server URL is reachable over HTTP.</li>
          <li>Check the VS Code <strong>Output</strong> panel (select <em>Spin Your AI</em> from the dropdown) for detailed error logs.</li>
        </ul>
      </section>
    </main>
  </div>
</body>
</html>`;
    }
}
