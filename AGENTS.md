# Spin Your AI (VS Code Extension) - Agent Rules & Guidelines

Welcome to **Spin Your AI** (VS Code Extension), a powerful VS Code extension designed to spin up AI models directly from your editor. It supports a wide range of cloud and local providers (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, etc.) with multimodality, page context awareness, and Model Context Protocol (MCP) tool execution.

When contributing to this project, adhere strictly to the following rules and design philosophies.

## 1. Design Language & UI/UX
- **Theme:** Strict Terminal / Hacker aesthetic. 
- **No True Glassmorphism:** Avoid translucent backgrounds or blurred backdrops. Use solid blocks, square corners, and sharp borders. Even if a class is named `glassmorphism`, it should only apply solid colors (`--panel-bg`) and borders.
- **Typography:** Strictly use monospace fonts (`'Courier New', Courier, monospace`) globally.
- **Color Palette (Monochrome Dark):**
  - **Main Background:** `#050505` (`--bg-color`)
  - **Panel/Header Background:** `#0a0a0a` (`--panel-bg`)
  - **Inputs/Dropdowns Background:** `#000`
  - **Borders:** `#333` (`--border-color`)
  - **Primary Text (User):** `#f8fafc` (`--text-main`)
  - **AI Text:** `#7dd3fc`
  - **Muted Text:** `#94a3b8` (`--text-muted`)
- **Scrollbars:** Custom, dark, solid, and blocky. No `border-radius`. Thumb should be `#333`, track `#000`.
- **Icons:** Strictly use Google Material Symbols (`<span class="material-symbols-outlined">...</span>`). Do **NOT** use unicode emojis (e.g., ⚙️, ✅, ❌) in the UI structure.

## 2. Terminology & Copywriting
- **Proper Nouns:** Ensure all AI providers and services are capitalized correctly in the UI (e.g., "OpenAI", not "openai"; "OpenCode", not "opencode").
- **Reset vs. Delete:** Always use the term **"Reset"** instead of "Delete" when referring to clearing a configuration or deleting credentials.

## 3. Data Privacy & Security
- **Strictly Local Storage:** API keys and credentials MUST never be leaked or logged. 
- **SecretStorage API:** Always use `VaultService` which leverages VS Code's native `SecretStorage` API for all sensitive credentials (like API keys).
- **Global State vs Settings:** We intentionally avoid registering configurations in `package.json` `contributes.configuration` to prevent UI clutter and schema errors. Instead, use `ConfigService` (which leverages `extensionContext.globalState`) to save and retrieve extension configurations like endpoint URLs.

## 4. Architecture & Coding Practices
- **Vanilla Stack (Webviews):** Use vanilla HTML, CSS, and JavaScript for VS Code Webviews. Do not introduce Tailwind CSS or frontend frameworks (React, Vue) to keep the bundle size small and performance high.
- **File Structure:**
  - `src/views/`: Contains Webview panels and UI components (`chatSidebarView.ts`, `settingsView.ts`, `helpPanel.ts`).
  - `media/`: Contains the static assets (CSS, JS) loaded by the Webviews (`chat.css`, `main.js`).
  - `src/providers/`: Contains all AI API integration logic (e.g., `openaiProvider.ts`, `ollamaProvider.ts`).
  - `src/services/`: Contains core business logic and state management (`vault.ts`, `configService.ts`, `mcpService.ts`, `http.ts`).
- **HTTP Client:** Always use `HttpService.fetch` for network requests to ensure proper proxy handling and timeouts.
- **MCP Integration:** The extension supports both HTTP/SSE and STDIO MCP servers via `McpService`. Ensure that new MCP features are compatible with `mcp_config.json` parsing. Local models (like Ollama) generally do not support tool execution natively, so do not force tool payloads onto providers that don't explicitly support them.
- **Auto-Scrolling:** When streaming text in the chat UI, implement "Smart Scrolling": only auto-scroll (`scrollTop = scrollHeight`) if the user is already near the bottom (within a ~150px threshold). This prevents "jitter" and dizziness if the user tries to scroll up while the model is generating.
- **Context Menus & Auto-Send:** Editor context menu actions (Explain, Refactor, Fix) should use rich, detailed system prompts (not simple one-liners) and invoke `autoSend: true`. To avoid race conditions where the Webview tries to send a message before the background APIs have finished fetching the model list, buffer auto-send requests (e.g., `pendingAutoSend`) until models are fully loaded.
- **Provider Toggling:** Allow users to dynamically enable or disable specific providers via `ConfigService` (`[providerId].enabled`). Disabled providers should have their models filtered out to unclutter the dropdown UI.

Follow these instructions whenever making modifications or adding new features to maintain the aesthetic integrity, performance, and security standards of the extension.

## 5. Build & Packaging
- **Update VSIX Package:** After making functional changes or adding new features to the extension, you MUST build and update the `.vsix` package (using `npm run build:vsix`) so that the latest changes can be installed and distributed.
