# Model Context Protocol (MCP) & Local Agents

Extend Spin Your AI with Model Context Protocol (MCP) servers and local autonomous agents.

## Supported Protocols & Agents

- **Model Context Protocol (MCP)**: Connect your AI agent to external tool servers like `n8n-mcp`, databases, and APIs using standard JSON-RPC HTTP/SSE endpoints or local STDIO commands (like `npx`). Configure them in an editable `mcp_config.json` file.
- **Hermes**: Fast local reasoning and agentic server (default `http://localhost:8642/v1`).
- **OpenCode**: Code synthesis and execution session agent (default `http://localhost:3000`).
- **OpenClaw**: Autonomous coding and orchestration agent (default `http://localhost:3141`).

## Quick Configuration

Configure your endpoints and tools directly:

- [Edit MCP Configuration (JSON)](command:spin-your-ai.editMcpConfig)
- [Open Provider Settings](command:spin-your-ai.openSettings)
- [Configure Hermes Endpoint](command:spin-your-ai.configureHermes)
- [Configure OpenCode Endpoint](command:spin-your-ai.configureOpenCode)
- [Configure OpenClaw Endpoint](command:spin-your-ai.configureOpenClaw)
