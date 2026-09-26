# Spin Your AI for VSCode

Spin up AI models from your editor, powered by local AI, cloud frontiers, and Model Context Protocol (MCP) agents.

## Features

- **Multi-Provider Support**: Switch seamlessly between local models (Ollama, Hermes, OpenCode, OpenClaw), MCP servers, and cloud frontiers (OpenAI, Anthropic, Gemini, OpenRouter, Hugging Face, Ollama Cloud).
- **Sidebar Chat**: Native-feeling Webview chat interface with streaming responses.
- **Context Injection**: Use `@file` and `@workspace` to instantly feed relevant context to any LLM.
- **Editor Integration**: Highlight code and right-click to Explain, Refactor, or Fix Bugs.
- **Secure Key Storage**: API keys are encrypted in your OS native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via VS Code's `SecretStorage` API.
- **Zero Config Local**: Connects directly to Ollama at `localhost:11434` out of the box.
- **Model Context Protocol (MCP)**: Native HTTP/SSE endpoint support for MCP tool servers.
- **Local Autonomous Agents**: Direct integration for Hermes, OpenCode, and OpenClaw endpoints.

## Getting Started

An onboarding walkthrough automatically launches on first install.

To re-open the walkthrough at any time, run:
- `Spin Your AI: Open Walkthrough`

To configure providers and API keys:
- Click the **gear icon** (`settings`) in the chat sidebar, or run `Spin Your AI: Open Settings`.

To open the Help page:
- Click the **question mark icon** (`help`) in the chat sidebar.

## Commands

All commands are prefixed with **Spin Your AI**:

### General & Setup
- `Spin Your AI: Start`: Launches the welcome walkthrough and focuses the Chat Sidebar.
- `Spin Your AI: Open Walkthrough`: Opens the 3-step setup walkthrough.
- `Spin Your AI: Open Settings`: Opens the Webview settings page to configure providers and API keys.

### Code Actions (Editor Context Menu & Palette)
- `Spin Your AI: Explain Code`: Explains the selected code block.
- `Spin Your AI: Refactor Code`: Refactors the selected code block.
- `Spin Your AI: Fix Bug`: Analyzes the selected code for bugs.

### Cloud API Keys
- `Spin Your AI: Set OpenAI Key`: Securely store OpenAI API key.
- `Spin Your AI: Set Anthropic Key`: Securely store Anthropic API key.
- `Spin Your AI: Set Gemini Key`: Securely store Google Gemini API key.
- `Spin Your AI: Set OpenRouter Key`: Securely store OpenRouter API key.
- `Spin Your AI: Set Hugging Face Key`: Securely store Hugging Face API key.
- `Spin Your AI: Set Ollama Cloud Key`: Securely store Ollama Cloud API key.

### Model Endpoints & MCP
- `Spin Your AI: Configure Ollama Endpoint`: Set custom Ollama host/port (default `http://localhost:11434`).
- `Spin Your AI: Edit MCP Configuration (JSON)`: Configure external MCP tool servers (e.g., `n8n-mcp`) via editable `mcp_config.json`.
- `Spin Your AI: Configure Hermes Endpoint`: Set Hermes agent endpoint (default `http://localhost:8642/v1`).
- `Spin Your AI: Configure OpenCode Endpoint`: Set OpenCode endpoint (default `http://localhost:3000`).
- `Spin Your AI: Configure OpenClaw Endpoint`: Set OpenClaw agent endpoint (default `http://localhost:3141`).

## Development

### Prerequisites

- Node.js 18+
- npm

Install dependencies:

```bash
npm install
```

### Build Scripts

| Script | Command | Description |
|---|---|---|
| **check-types** | `npm run check-types` | Runs `tsc --noEmit` to type-check all TypeScript source files without emitting any output. Run this to catch type errors early. |
| **lint** | `npm run lint` | Runs ESLint across `src/` to enforce code style and catch common issues. |
| **compile** | `npm run compile` | Full development build: type-checks → lints → bundles `src/extension.ts` into `dist/extension.js` via esbuild (with source maps, unminified). |
| **watch** | `npm run watch` | Runs esbuild and tsc in parallel watch modes. Use this during active development — rebuilds automatically on every file save. |
| **watch:esbuild** | `npm run watch:esbuild` | Runs only the esbuild bundler in watch mode (faster, skips tsc type checking). |
| **watch:tsc** | `npm run watch:tsc` | Runs only the TypeScript compiler in watch mode for type checking (no emit). |
| **package** | `npm run package` | Production build: type-checks → lints → bundles with esbuild in `--production` mode (minified, no source maps). Output: `dist/extension.js`. Called automatically by `vscode:prepublish` before publishing. |
| **build:vsix** | `npm run build:vsix` | Packages the extension into a `.vsix` installer file using `vsce`. Run `package` first. Install locally with `code --install-extension <file>.vsix`. |
| **publish:vsx** | `npm run publish:vsx` | Publishes the extension to the Open VSX Registry (for VS Codium and other non-Microsoft marketplaces) using `ovsx`. |
| **compile-tests** | `npm run compile-tests` | Compiles the test suite using `tsc` into the `out/` directory. |
| **watch-tests** | `npm run watch-tests` | Watches and recompiles the test suite on change. |
| **pretest** | `npm run pretest` | Automatically runs before `npm test`: compiles tests, compiles extension, and lints. |
| **test** | `npm test` | Runs the extension test suite using `@vscode/test-cli`. |

### Typical Workflows

**Active development (recommended):**
```bash
npm run watch
```
Then press `F5` in VS Code to launch the Extension Development Host.

**Before committing:**
```bash
npm run compile
```

**Build and install locally:**
```bash
npm run build:vsix
code --install-extension spin-your-ai-vscode-*.vsix
```

**Publish a release:**
```bash
npm run build:vsix     # Creates the .vsix archive
npm run publish:vsx    # Publishes to Open VSX Registry
```