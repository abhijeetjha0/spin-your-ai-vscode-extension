import * as vscode from 'vscode';
import { McpService } from '../services/mcpService';
import { VaultService } from '../services/vault';
import { ProviderRegistry } from '../providers/providerRegistry';
import { Logger } from '../utils/logger';
import { ConfigService } from '../services/configService';

export class SettingsPanel {
    public static currentPanel: SettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel._panel.reveal(column);
            SettingsPanel.currentPanel.refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'spinYourAiSettings',
            'Spin Your AI Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    public async refresh() {
        if (!this._panel) { return; }
        const data = await this._getAllConfigData();
        this._panel.webview.postMessage({ type: 'INIT_DATA', data });
    }

    private async _handleMessage(message: any) {
        switch (message.type) {
            case 'GET_INIT_DATA': {
                const data = await this._getAllConfigData();
                this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                break;
            }

            case 'SAVE_MCP': {
                const { rawConfig, enabled } = message;
                const result = await McpService.saveRawConfig(rawConfig, enabled);
                if (result.ok) {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: 'Saved MCP Servers configuration',
                        variant: 'success'
                    });
                    const data = await this._getAllConfigData();
                    this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                } else {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: result.error || 'Failed to save MCP configuration',
                        variant: 'error'
                    });
                }
                break;
            }

            case 'TEST_MCP': {
                const { rawConfig } = message;
                this._panel.webview.postMessage({ type: 'TOAST', text: 'Testing MCP Servers...', variant: 'info' });
                const res = await McpService.testConnection(rawConfig);
                this._panel.webview.postMessage({ type: 'MCP_TEST_RESULT', result: res });
                if (res.ok) {
                    this._panel.webview.postMessage({ type: 'TOAST', text: 'MCP connection successful!', variant: 'success' });
                } else {
                    this._panel.webview.postMessage({ type: 'TOAST', text: res.error || 'MCP connection test failed', variant: 'error' });
                }
                break;
            }

            case 'OPEN_MCP_IN_EDITOR': {
                const doc = await vscode.workspace.openTextDocument(McpService.getConfigFileUri());
                await vscode.window.showTextDocument(doc);
                break;
            }

            case 'SAVE_KEY': {
                const { providerId, apiKey } = message;
                try {
                    await VaultService.storeKey(providerId, apiKey);
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Saved API key for ${providerId}`,
                        variant: 'success'
                    });
                    const data = await this._getAllConfigData();
                    this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                } catch (err: any) {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Error saving key: ${err.message}`,
                        variant: 'error'
                    });
                }
                break;
            }

            case 'RESET_KEY': {
                const { providerId } = message;
                await VaultService.deleteKey(providerId);
                this._panel.webview.postMessage({
                    type: 'TOAST',
                    text: `Reset key for ${providerId}`,
                    variant: 'success'
                });
                const data = await this._getAllConfigData();
                this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                break;
            }

            case 'SAVE_URL': {
                const { configKey, url } = message;
                try {
                    await ConfigService.update(configKey, url);
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Updated ${configKey}`,
                        variant: 'success'
                    });
                    const data = await this._getAllConfigData();
                    this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                } catch (err: any) {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Error updating URL: ${err.message}`,
                        variant: 'error'
                    });
                }
                break;
            }

            case 'TOGGLE_PROVIDER': {
                const { providerId, enabled } = message;
                try {
                    await ConfigService.update(`${providerId}.enabled`, enabled);
                    const data = await this._getAllConfigData();
                    this._panel.webview.postMessage({ type: 'INIT_DATA', data });
                } catch (err: any) {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Error toggling provider: ${err.message}`,
                        variant: 'error'
                    });
                }
                break;
            }

            case 'TEST_PROVIDER': {
                const { providerId } = message;
                this._panel.webview.postMessage({ type: 'TOAST', text: `Testing ${providerId}...`, variant: 'info' });
                try {
                    const provider = ProviderRegistry.getProvider(providerId);
                    if (!provider) {
                        throw new Error(`Provider ${providerId} not found`);
                    }
                    const models = await provider.listModels();
                    if (models && models.length > 0) {
                        this._panel.webview.postMessage({
                            type: 'TOAST',
                            text: `Connected to ${providerId}! Found ${models.length} model(s).`,
                            variant: 'success'
                        });
                    } else {
                        this._panel.webview.postMessage({
                            type: 'TOAST',
                            text: `Could not reach ${providerId} or no models available.`,
                            variant: 'error'
                        });
                    }
                } catch (err: any) {
                    this._panel.webview.postMessage({
                        type: 'TOAST',
                        text: `Test failed: ${err.message}`,
                        variant: 'error'
                    });
                }
                break;
            }
        }
    }

    private async _getAllConfigData() {
        const keys: Record<string, boolean> = {
            openai: !!(await VaultService.getKey('openai')),
            anthropic: !!(await VaultService.getKey('anthropic')),
            gemini: !!(await VaultService.getKey('gemini')),
            openrouter: !!(await VaultService.getKey('openrouter')),
            huggingface: !!(await VaultService.getKey('huggingface')),
            ollamaCloud: !!(await VaultService.getKey('ollamaCloud')),
            opencodeZen: !!(await VaultService.getKey('opencodeZen'))
        };

        const ollamaUrl = ConfigService.get<string>('ollama.baseUrl') || 'http://localhost:11434';
        const hermesUrl = ConfigService.get<string>('hermes.baseUrl') || 'http://localhost:8642/v1';
        const openclawUrl = ConfigService.get<string>('openclaw.baseUrl') || 'http://localhost:3141';
        const opencodeUrl = ConfigService.get<string>('opencode.baseUrl') || 'http://localhost:3000';

        const urls = {
            ollama: ollamaUrl,
            hermes: hermesUrl,
            openclaw: openclawUrl,
            opencode: opencodeUrl
        };

        // Local providers are considered 'configured' only if we can verify the service
        // is reachable. For simplicity, we reflect whether a custom URL has been set.
        const localConfigured: Record<string, boolean> = {
            ollama: !!ConfigService.get<string>('ollama.baseUrl'),
            hermes: !!ConfigService.get<string>('hermes.baseUrl'),
            openclaw: !!ConfigService.get<string>('openclaw.baseUrl'),
            opencode: !!ConfigService.get<string>('opencode.baseUrl'),
        };

        const mcpRaw = McpService.getRawConfig();
        const mcpEnabled = McpService.isEnabled();

        const providerEnabled: Record<string, boolean> = {};
        for (const p of ProviderRegistry.getAllProviders()) {
            providerEnabled[p.id] = ConfigService.get<boolean>(`${p.id}.enabled`) ?? true;
        }

        return { keys, urls, localConfigured, mcpRaw, mcpEnabled, providerEnabled };
    }

    public dispose() {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Spin Your AI - Settings</title>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
  <style>
    :root {
      --bg-color: #050505;
      --panel-bg: #0a0a0a;
      --card-bg: #000;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #333;
      --success: #10b981;
      --error: #ef4444;
      --font-mono: 'Courier New', Courier, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-mono);
      background-color: var(--bg-color);
      color: var(--text-main);
      height: 100vh;
      overflow: hidden;
    }

    .layout {
      display: flex;
      height: 100vh;
    }

    .sidebar {
      width: 220px;
      background: var(--panel-bg);
      border-right: 1px solid var(--border-color);
      padding: 30px 0;
      flex-shrink: 0;
      overflow-y: auto;
    }

    .sidebar-header {
      padding: 0 20px;
      margin-bottom: 20px;
    }

    .sidebar-header h2 {
      font-size: 14px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .nav-link {
      display: block;
      padding: 10px 20px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      border-left: 2px solid transparent;
      transition: all 0.2s;
    }

    .nav-link:hover, .nav-link.active {
      color: var(--text-main);
      background: #111;
      border-left-color: var(--text-main);
    }

    .content {
      flex: 1;
      padding: 30px 40px;
      overflow-y: auto;
      scroll-behavior: smooth;
    }

    .content-inner {
      max-width: 800px;
      margin: 0 auto;
    }

    .content-header {
      margin-bottom: 30px;
    }

    .content-header h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 13px;
    }

    .category-section {
      margin-bottom: 40px;
      scroll-margin-top: 20px;
    }

    .category-section h3 {
      font-size: 16px;
      margin-bottom: 16px;
      color: var(--text-main);
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 8px;
    }

    .provider-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      padding: 20px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }

    .provider-card:focus-within {
      border-color: var(--text-main);
    }

    .provider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .provider-name {
      font-weight: bold;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .provider-status {
      font-size: 11px;
      padding: 3px 8px;
      background: #111;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
    }

    .provider-status.active {
      background: #002200;
      border-color: var(--success);
      color: var(--success);
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .input-row {
      display: flex;
      gap: 8px;
    }

    .input-row input {
      flex: 1;
      background: #000;
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }

    .input-row input:focus {
      border-color: var(--text-main);
    }

    .icon-btn {
      background: #111;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      width: 38px;
      height: 38px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .icon-btn:hover {
      background: #222;
      color: var(--text-main);
      border-color: var(--text-main);
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }

    .btn {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
      border: 1px solid var(--border-color);
      transition: opacity 0.2s, background 0.2s;
      font-family: var(--font-mono);
    }

    .btn-primary {
      background: #222;
      color: var(--text-main);
      border-color: var(--text-main);
    }
    .btn-primary:hover { background: #333; }

    .btn-danger {
      background: #000;
      color: var(--error);
      border-color: rgba(239, 68, 68, 0.4);
    }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.15); border-color: var(--error); }

    .btn-secondary {
      background: #111;
      color: var(--text-main);
    }
    .btn-secondary:hover { background: #222; border-color: var(--text-main); }

    /* Toggle switch */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #333;
      transition: .3s;
      border-radius: 24px;
      border: 1px solid #444;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: #94a3b8;
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background-color: #004400;
      border-color: var(--success);
    }

    input:checked + .slider:before {
      transform: translateX(20px);
      background-color: var(--success);
    }

    /* Toasts */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 100;
    }

    .toast {
      background: #000;
      border: 1px solid var(--border-color);
      padding: 10px 16px;
      font-size: 13px;
      box-shadow: 4px 4px 0px rgba(0,0,0,0.8);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .toast.success { border-left: 4px solid var(--success); }
    .toast.error { border-left: 4px solid var(--error); }
    .toast.info { border-left: 4px solid #60a5fa; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Providers</h2>
      </div>
      <nav id="nav-links">
        <a href="#local" class="nav-link">Local Agents & Models</a>
        <a href="#cloud" class="nav-link">Cloud APIs</a>
        <a href="#aggregators" class="nav-link">Aggregators</a>
        <a href="#mcp" class="nav-link">MCP Servers</a>
      </nav>
    </aside>

    <main class="content">
      <header class="content-header">
        <h1>Provider Configuration</h1>
        <p class="subtitle"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle">lock</span> All keys and configurations are stored securely on your machine.</p>
      </header>

      <div class="toast-container" id="toast-container"></div>

      <div class="content-inner">

        <!-- LOCAL AGENTS & MODELS -->
        <div class="category-section" id="local">
          <h3>Local Agents &amp; Models</h3>

          <!-- Ollama -->
          <div class="provider-card" id="card-ollama">
            <div class="provider-header">
              <div class="provider-name">Ollama (Local) <span class="provider-status" id="ollama-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="ollama">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>Host URL</label>
              <div class="input-row">
                <input type="text" id="ollama-url" placeholder="http://localhost:11434">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-secondary" onclick="testProvider('ollama')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveUrl('ollama.baseUrl', 'ollama-url')">Save</button>
            </div>
          </div>

          <!-- OpenClaw -->
          <div class="provider-card" id="card-openclaw">
            <div class="provider-header">
              <div class="provider-name">OpenClaw <span class="provider-status" id="openclaw-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="openclaw">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>Host URL</label>
              <div class="input-row">
                <input type="text" id="openclaw-url" placeholder="http://localhost:3141">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-secondary" onclick="testProvider('openclaw')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveUrl('openclaw.baseUrl', 'openclaw-url')">Save</button>
            </div>
          </div>

          <!-- Hermes -->
          <div class="provider-card" id="card-hermes">
            <div class="provider-header">
              <div class="provider-name">Hermes Desktop <span class="provider-status" id="hermes-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="hermes">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>Host URL</label>
              <div class="input-row">
                <input type="text" id="hermes-url" placeholder="http://localhost:8642/v1">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-secondary" onclick="testProvider('hermes')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveUrl('hermes.baseUrl', 'hermes-url')">Save</button>
            </div>
          </div>

          <!-- OpenCode -->
          <div class="provider-card" id="card-opencode">
            <div class="provider-header">
              <div class="provider-name">OpenCode <span class="provider-status" id="opencode-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="opencode">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>Host URL</label>
              <div class="input-row">
                <input type="text" id="opencode-url" placeholder="http://localhost:3000">
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-secondary" onclick="testProvider('opencode')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveUrl('opencode.baseUrl', 'opencode-url')">Save</button>
            </div>
          </div>
        </div>

        <!-- CLOUD APIS -->
        <div class="category-section" id="cloud">
          <h3>Cloud APIs</h3>

          <!-- OpenAI -->
          <div class="provider-card" id="card-openai">
            <div class="provider-header">
              <div class="provider-name">OpenAI <span class="provider-status" id="openai-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="openai">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="openai-key" placeholder="sk-...">
                <button type="button" class="icon-btn" onclick="togglePeek('openai-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('openai')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('openai')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('openai', 'openai-key')">Save</button>
            </div>
          </div>

          <!-- Anthropic -->
          <div class="provider-card" id="card-anthropic">
            <div class="provider-header">
              <div class="provider-name">Anthropic <span class="provider-status" id="anthropic-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="anthropic">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="anthropic-key" placeholder="sk-ant-...">
                <button type="button" class="icon-btn" onclick="togglePeek('anthropic-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('anthropic')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('anthropic')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('anthropic', 'anthropic-key')">Save</button>
            </div>
          </div>

          <!-- Google Gemini -->
          <div class="provider-card" id="card-gemini">
            <div class="provider-header">
              <div class="provider-name">Google Gemini <span class="provider-status" id="gemini-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="gemini">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="gemini-key" placeholder="AIzaSy...">
                <button type="button" class="icon-btn" onclick="togglePeek('gemini-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('gemini')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('gemini')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('gemini', 'gemini-key')">Save</button>
            </div>
          </div>

          <!-- Ollama Cloud -->
          <div class="provider-card" id="card-ollamaCloud">
            <div class="provider-header">
              <div class="provider-name">Ollama Cloud <span class="provider-status" id="ollamaCloud-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="ollamaCloud">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="ollamaCloud-key" placeholder="API key...">
                <button type="button" class="icon-btn" onclick="togglePeek('ollamaCloud-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('ollamaCloud')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('ollamaCloud')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('ollamaCloud', 'ollamaCloud-key')">Save</button>
            </div>
          </div>

          <!-- Hugging Face -->
          <div class="provider-card" id="card-huggingface">
            <div class="provider-header">
              <div class="provider-name">Hugging Face <span class="provider-status" id="huggingface-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="huggingface">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="huggingface-key" placeholder="hf_...">
                <button type="button" class="icon-btn" onclick="togglePeek('huggingface-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('huggingface')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('huggingface')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('huggingface', 'huggingface-key')">Save</button>
            </div>
          </div>
        </div>

        <!-- AGGREGATORS -->
        <div class="category-section" id="aggregators">
          <h3>Aggregators</h3>

          <!-- OpenRouter -->
          <div class="provider-card" id="card-openrouter">
            <div class="provider-header">
              <div class="provider-name">OpenRouter <span class="provider-status" id="openrouter-status-badge">Not Configured</span></div>
              <label class="toggle-switch" title="Enable/Disable this provider">
                <input type="checkbox" class="provider-enable-toggle" data-id="openrouter">
                <span class="slider"></span>
              </label>
            </div>
            <div class="form-group">
              <label>API Key</label>
              <div class="input-row">
                <input type="password" id="openrouter-key" placeholder="sk-or-...">
                <button type="button" class="icon-btn" onclick="togglePeek('openrouter-key', this)"><span class="material-symbols-outlined">visibility</span></button>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn btn-danger" onclick="resetKey('openrouter')">Reset</button>
              <button type="button" class="btn btn-secondary" onclick="testProvider('openrouter')">Test Connection</button>
              <button type="button" class="btn btn-primary" onclick="saveKey('openrouter', 'openrouter-key')">Save</button>
            </div>
          </div>
        </div>

        <!-- MCP SERVERS (last) -->
        <div class="category-section" id="mcp">
          <h3>MCP Servers</h3>

          <div class="provider-card" id="card-mcp">
            <div class="provider-header">
              <div class="provider-name">
                MCP Servers
                <span class="provider-status" id="mcp-status-badge">Not Configured</span>
              </div>
              <label class="toggle-switch" title="Enable/Disable MCP tool calling for the agent">
                <input type="checkbox" id="mcp-toggle" checked>
                <span class="slider"></span>
              </label>
            </div>

            <div class="form-group" id="mcp-form-body">
              <label style="display: flex; align-items: center; gap: 6px;">
                mcp_config.json
                <span class="material-symbols-outlined" title="Only HTTP/SSE MCP endpoints are supported. Configure your servers as a JSON object. Use headers/env to pass HTTP headers." style="font-size: 16px; cursor: help;">info</span>
              </label>
              <textarea id="mcp-textarea" rows="12" style="width: 100%; font-family: monospace; background: #000; color: #fff; border: 1px solid #333; padding: 10px; resize: vertical; outline: none; line-height: 1.4;"></textarea>

              <div id="mcp-servers-list-container" style="margin-top: 15px; color: #94a3b8;">
                <strong style="font-size: 1.05em;">MCP Servers:</strong>
                <ul style="margin: 8px 0 0 20px; padding: 0; list-style-type: none;" id="mcp-servers-ul"></ul>
              </div>

              <div id="mcp-error-wrapper" style="display: none; margin-top: 15px; padding: 12px; background: #0a0a0a; border: 1px solid #333;">
                <div style="font-weight: bold; margin-bottom: 10px; color: #ef4444; font-size: 1.05em; display: flex; align-items: center; gap: 6px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">error</span>
                  Connection Errors
                </div>
                <div id="mcp-error-container" style="display: flex; flex-direction: column; gap: 6px;"></div>
              </div>
            </div>

            <div class="actions">
              <button type="button" class="btn btn-secondary" id="mcp-open-editor" title="Open mcp_config.json in VS Code editor tab">Open in Editor</button>
              <button type="button" class="btn btn-danger" id="mcp-reset-btn">Reset</button>
              <button type="button" class="btn btn-secondary" id="mcp-test-btn">Test Connection</button>
              <button type="button" class="btn btn-primary" id="mcp-save-btn">Save</button>
            </div>
          </div>
        </div>

      </div>
    </main>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const mcpTextarea = document.getElementById('mcp-textarea');
    const mcpToggle = document.getElementById('mcp-toggle');
    const mcpStatusBadge = document.getElementById('mcp-status-badge');
    const mcpServersUl = document.getElementById('mcp-servers-ul');
    const mcpErrorWrapper = document.getElementById('mcp-error-wrapper');
    const mcpErrorContainer = document.getElementById('mcp-error-container');

    const DEFAULT_MCP_TEMPLATE = JSON.stringify({
      "mcpServers": {
        "n8n-mcp": {
          "type": "http",
          "url": "http://localhost:5678/mcp-server/http",
          "headers": {
            "Authorization": "Bearer YOUR_ACCESS_TOKEN_HERE"
          }
        }
      }
    }, null, 2);

    // Ask extension for initial data
    vscode.postMessage({ type: 'GET_INIT_DATA' });

    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'INIT_DATA':
          populateData(msg.data);
          break;
        case 'MCP_TEST_RESULT':
          renderMcpTestResult(msg.result);
          break;
        case 'TOAST':
          showToast(msg.text, msg.variant);
          break;
      }
    });

    function setBadge(id, configured) {
      const badge = document.getElementById(id);
      if (!badge) { return; }
      badge.textContent = configured ? 'Configured' : 'Not Configured';
      if (configured) { badge.classList.add('active'); }
      else { badge.classList.remove('active'); }
    }

    function populateData(data) {
      if (!data) return;

      // URLs
      if (data.urls) {
        if (data.urls.ollama) document.getElementById('ollama-url').value = data.urls.ollama;
        if (data.urls.openclaw) document.getElementById('openclaw-url').value = data.urls.openclaw;
        if (data.urls.hermes) document.getElementById('hermes-url').value = data.urls.hermes;
        if (data.urls.opencode) document.getElementById('opencode-url').value = data.urls.opencode;
      }

      // Cloud/aggregator key badges (badge id = provider + '-status-badge')
      if (data.keys) {
        for (const [provider, configured] of Object.entries(data.keys)) {
          setBadge(provider + '-status-badge', configured);
        }
      }

      // Local provider badges — configured means a custom URL was explicitly saved
      if (data.localConfigured) {
        setBadge('ollama-status-badge', data.localConfigured.ollama);
        setBadge('hermes-status-badge', data.localConfigured.hermes);
        setBadge('openclaw-status-badge', data.localConfigured.openclaw);
        setBadge('opencode-status-badge', data.localConfigured.opencode);
      }

      if (data.providerEnabled) {
        for (const [provider, isEnabled] of Object.entries(data.providerEnabled)) {
          const toggle = document.querySelector(\`.provider-enable-toggle[data-id="\${provider}"]\`);
          if (toggle) {
            toggle.checked = isEnabled;
          }
        }
      }

      // MCP
      if (data.mcpRaw) {
        mcpTextarea.value = data.mcpRaw;
      } else {
        mcpTextarea.value = DEFAULT_MCP_TEMPLATE;
      }

      mcpToggle.checked = data.mcpEnabled !== false;
      updateMcpServerList();
    }

    function updateMcpServerList() {
      const val = mcpTextarea.value.trim();
      let serverNames = [];
      let isValid = false;

      try {
        const parsed = JSON.parse(val);
        if (parsed && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          serverNames = Object.keys(parsed.mcpServers);
          isValid = true;
        }
      } catch (e) {
        isValid = false;
      }

      if (isValid && serverNames.length > 0 && mcpToggle.checked) {
        mcpStatusBadge.textContent = 'Configured';
        mcpStatusBadge.classList.add('active');
      } else {
        mcpStatusBadge.textContent = 'Not Configured';
        mcpStatusBadge.classList.remove('active');
      }

      mcpServersUl.innerHTML = '';
      if (serverNames.length === 0) {
        mcpServersUl.innerHTML = '<li style="color: #64748b;">(No servers configured)</li>';
      } else {
        serverNames.forEach(s => {
          const li = document.createElement('li');
          li.id = 'mcp-server-' + s;
          li.style.display = 'flex';
          li.style.alignItems = 'center';
          li.style.gap = '8px';
          li.style.marginBottom = '6px';
          li.innerHTML = '<span class="material-symbols-outlined mcp-status-dot" style="font-size: 14px; color: gray;">circle</span> ' + s;
          mcpServersUl.appendChild(li);
        });
      }
    }

    mcpTextarea.addEventListener('input', () => {
      updateMcpServerList();
    });

    mcpToggle.addEventListener('change', () => {
      const formBody = document.getElementById('mcp-form-body');
      formBody.style.opacity = mcpToggle.checked ? '1' : '0.5';
      updateMcpServerList();
    });

    document.querySelectorAll('.provider-enable-toggle').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const providerId = e.target.getAttribute('data-id');
        const enabled = e.target.checked;
        vscode.postMessage({
          type: 'TOGGLE_PROVIDER',
          providerId,
          enabled
        });
      });
    });

    document.getElementById('mcp-save-btn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'SAVE_MCP',
        rawConfig: mcpTextarea.value,
        enabled: mcpToggle.checked
      });
    });

    document.getElementById('mcp-test-btn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'TEST_MCP',
        rawConfig: mcpTextarea.value
      });
    });

    document.getElementById('mcp-reset-btn').addEventListener('click', () => {
      mcpTextarea.value = DEFAULT_MCP_TEMPLATE;
      updateMcpServerList();
    });

    document.getElementById('mcp-open-editor').addEventListener('click', () => {
      vscode.postMessage({ type: 'OPEN_MCP_IN_EDITOR' });
    });

    function renderMcpTestResult(res) {
      if (!res || !res.serverStatuses) return;

      mcpErrorContainer.innerHTML = '';
      let hasErrors = false;

      for (const [key, info] of Object.entries(res.serverStatuses)) {
        const li = document.getElementById('mcp-server-' + key);
        if (li) {
          const dot = li.querySelector('.mcp-status-dot');
          if (dot) {
            dot.style.color = info.status === 'connected' ? '#22c55e' : '#ef4444';
          }
        }

        if (info.status === 'error' && info.error) {
          hasErrors = true;
          const errDiv = document.createElement('div');
          errDiv.style.background = '#111';
          errDiv.style.border = '1px solid #333';
          errDiv.style.padding = '8px 10px';
          errDiv.style.display = 'flex';
          errDiv.style.justifyContent = 'space-between';
          errDiv.style.alignItems = 'flex-start';
          errDiv.style.fontSize = '12px';

          const textSpan = document.createElement('span');
          textSpan.style.color = '#ef4444';
          textSpan.style.wordBreak = 'break-word';
          textSpan.textContent = '[' + key + '] ' + info.error;

          errDiv.appendChild(textSpan);
          mcpErrorContainer.appendChild(errDiv);
        }
      }

      mcpErrorWrapper.style.display = hasErrors ? 'block' : 'none';
    }

    function saveKey(providerId, inputId) {
      const val = document.getElementById(inputId).value.trim();
      if (!val) {
        showToast('Please enter an API key', 'error');
        return;
      }
      vscode.postMessage({ type: 'SAVE_KEY', providerId, apiKey: val });
      document.getElementById(inputId).value = '';
    }

    function resetKey(providerId) {
      vscode.postMessage({ type: 'RESET_KEY', providerId });
    }

    function saveUrl(configKey, inputId) {
      const val = document.getElementById(inputId).value.trim();
      vscode.postMessage({ type: 'SAVE_URL', configKey, url: val });
    }

    function testProvider(providerId) {
      vscode.postMessage({ type: 'TEST_PROVIDER', providerId });
    }

    function togglePeek(inputId, btn) {
      const inp = document.getElementById(inputId);
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.innerHTML = '<span class="material-symbols-outlined">visibility_off</span>';
      } else {
        inp.type = 'password';
        btn.innerHTML = '<span class="material-symbols-outlined">visibility</span>';
      }
    }

    function showToast(text, variant = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + variant;
      toast.textContent = text;
      container.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 3500);
    }
  </script>
</body>
</html>`;
    }
}
