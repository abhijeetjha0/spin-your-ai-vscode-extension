# Spin Your AI for VSCode

Spin up AI models from your editor, powered by local and cloud AI providers.

## Features

- **Multi-Provider Support**: Switch seamlessly between local models (Ollama) and cloud frontiers (OpenAI, Anthropic, Gemini, OpenRouter).
- **Sidebar Chat**: A native-feeling Webview UI Toolkit chat interface.
- **Context Injection**: Use `@file` and `@workspace` to instantly feed context to the LLM.
- **Editor Integration**: Highlight code and right-click to Explain, Refactor, or Fix Bugs.
- **Secure Key Storage**: API keys are securely stored in your OS keychain using VSCode's Vault Service.
- **Zero Config Local**: Connects directly to Ollama at `localhost:11434` out of the box.

## Setup

A setup walkthrough will open the first time you install the extension. 

To set your cloud provider API keys manually, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Spin AI: Set`. You will see commands for setting OpenAI, Anthropic, Gemini, and OpenRouter keys.

## Commands

- `Spin Your AI: Start`: Opens the Chat Sidebar.
- `Spin AI: Explain Code`: Explains the selected code block.
- `Spin AI: Refactor Code`: Refactors the selected code block.
- `Spin AI: Fix Bug`: Analyzes the selected code for bugs.