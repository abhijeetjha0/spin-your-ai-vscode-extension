# Spin Your AI for VSCode

Spin up AI models from your editor, powered by local AI, cloud frontiers, and Model Context Protocol (MCP) agents.

## Features

- **Multi-Provider Support**: Switch seamlessly between local models (Ollama, Hermes Desktop, OpenCode, OpenClaw), MCP servers, and cloud frontiers (OpenAI, Anthropic, Gemini, OpenRouter, OpenCode Zen, Hugging Face, Ollama Cloud).
- **Persistent Sidebar Chat with Context Retention**: Native-feeling Webview chat interface with streaming responses, conversation history, and quick model switching. Built with `retainContextWhenHidden` and in-flight stream synchronization, ensuring you never lose context, active streaming tokens, or mid-process analysis when navigating between Activity Bar views (Explorer, Git, Search).
- **Context Injection & Workspace Awareness**: Use `@file` to inject active document content, and `@workspace` to scan and feed your full directory tree and workspace hierarchy to any model.
- **Built-in Workspace Agent Tools**: Tool-capable models can inspect files, list directories, search files across the workspace, and propose code changes using built-in agent tools (`workspace_search_files`, `workspace_get_context`, `workspace_list_dir`, `workspace_read_file`, `workspace_read_files`, `workspace_write_file`, `workspace_edit_file`).
- **Strict Permission-First Control**: No files are modified without your consent. Proposed changes display an interactive unified diff preview with **Approve** and **Reject** buttons directly in the chat sidebar.
- **Parallel File Reading & Smart Tool Caching**: Batch-read multiple workspace files in parallel (`workspace_read_files`). Idempotent read operations are cached in memory via `ToolCacheService`, with automatic cache invalidation upon approved file edits. Oversized file reads are safely truncated while preserving both head and tail lines.
- **Multimodal Sub-Agent Structure & Live Monitor**: The model can autonomously spin up specialized sub-agents (`spin_subagent`) with preserved conversation context for focused multimodal sub-tasks (image/diagram analysis, workspace search, security audits). The UI header features a live counter badge (`N Working`) with an interactive monitor modal to review sub-agent reasoning, inspect context history, and force-kill active workers.
- **Slash Commands & Dynamic Workspace Skills**: Type `/` in the chat input to access an autocomplete popover with fuzzy filtering. Supports built-in shortcuts (`/help`, `/clear`, `/history`, `/compact`, `/subagents`, `/settings`, `/explain`, `/refactor`, `/fix`) and dynamically discovers workspace skills from `.agents/skills/**/SKILL.md` by parsing YAML frontmatter.
- **Chat & Context Compaction**: Condense verbose earlier turns into an executive summary on demand (via `/compact` or the UI badge) or automatically when exceeding turn or token thresholds, slashing token consumption and latency while preserving full conversation context.
- **Multi-Session Chat & JSON Export**: Create, rename, switch between, and reset multiple named chat sessions stored in workspace state. Export conversation histories to standard OpenAI messages JSON format.
- **Editor Context Menu Integration**: Highlight code in any editor and right-click to **Explain Code**, **Refactor Code**, or **Fix Bug** with rich system prompts and automated buffered sending.
- **Secure Key Storage**: API keys are encrypted in your OS native keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) via VS Code's `SecretStorage` API.
- **Zero-Config Local**: Connects directly to local Ollama at `localhost:11434` out of the box with optional custom endpoint configurations.
- **Model Context Protocol (MCP)**: Native support for both **HTTP/SSE** and **STDIO** MCP tool servers configured via `mcp_config.json`.

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
- `Spin Your AI: Set OpenCode Zen Key`: Securely store OpenCode Zen API key.
- `Spin Your AI: Set Hugging Face Key`: Securely store Hugging Face API key.
- `Spin Your AI: Set Ollama Cloud Key`: Securely store Ollama Cloud API key.

### Model Endpoints & MCP
- `Spin Your AI: Configure Ollama Endpoint`: Set custom Ollama host/port (default `http://localhost:11434`).
- `Spin Your AI: Edit MCP Configuration (JSON)`: Configure external MCP tool servers via editable `mcp_config.json`.
- `Spin Your AI: Configure Hermes Endpoint`: Set Hermes agent endpoint (default `http://localhost:8642/v1`).
- `Spin Your AI: Configure OpenCode Endpoint`: Set OpenCode endpoint (default `http://localhost:3000` or `http://localhost:4096`).
- `Spin Your AI: Configure OpenClaw Endpoint`: Set OpenClaw agent endpoint (default `http://localhost:3141`).

## License
MIT
