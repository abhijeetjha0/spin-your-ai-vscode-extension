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
