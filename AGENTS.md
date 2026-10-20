# Spin Your AI (VS Code Extension) - Agent Rules & Guidelines

Welcome to **Spin Your AI** (VS Code Extension), a powerful VS Code extension designed to spin up AI models directly from your editor. It supports a wide range of cloud and local providers (OpenAI, Anthropic, Gemini, OpenRouter, OpenCode, OpenCode Zen, Hugging Face, Ollama Cloud, Ollama, Hermes Desktop, OpenClaw, MCP, etc.) with multimodality, workspace context awareness, autonomous workspace agent tools, and Model Context Protocol (MCP) tool execution.

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
- **Icons:** Strictly use Google Material Symbols (`<span class="material-symbols-outlined">...</span>`). Do **NOT** use unicode emojis (e.g., ⚙️, ✅, ❌) anywhere in the UI or chat streams.
- **Loading States:** Use hacker-themed, randomized action phrases (e.g., "Analyzing context...", "Compiling token stream...", "Executing neural model...") during AI generation.

## 2. Terminology & Copywriting
- **Proper Nouns:** Ensure all AI providers and services are capitalized correctly in the UI (e.g., "OpenAI", not "openai"; "OpenCode", not "opencode"; "OpenCode Zen", not "opencode_zen"; "Ollama Cloud", not "ollama_cloud").
- **Reset vs. Delete:** Always use the term **"Reset"** instead of "Delete" when referring to clearing a configuration, resetting credentials, or resetting chat history.

## 3. Data Privacy & Security
- **Strictly Local Storage:** API keys and credentials MUST never be leaked or logged. 
- **SecretStorage API:** Always use `VaultService` which leverages VS Code's native `SecretStorage` API for all sensitive credentials (like API keys) stored in the OS credential manager.
- **Global State vs Settings:** We intentionally avoid registering configurations in `package.json` `contributes.configuration` to prevent UI clutter and schema errors. Instead, use `ConfigService` (which leverages `extensionContext.globalState`) to save and retrieve extension configurations like endpoint URLs.

## 4. Architecture & Coding Practices
- **Vanilla Stack (Webviews):** Use vanilla HTML, CSS, and JavaScript for VS Code Webviews. Do not introduce Tailwind CSS or frontend frameworks (React, Vue) to keep the bundle size small and performance high.
- **File Structure:**
  - `src/views/`: Contains Webview panels and UI components (`chatSidebarView.ts`, `settingsView.ts`, `helpPanel.ts`).
  - `media/`: Contains static assets loaded by Webviews (`media/chat/style.css`, `media/chat/main.js`).
  - `src/providers/`: Contains AI provider integrations (`openaiProvider.ts`, `anthropicProvider.ts`, `geminiProvider.ts`, `ollamaProvider.ts`, etc.).
  - `src/services/`: Contains core business logic (`agentToolService.ts`, `subagentService.ts`, `slashCommandService.ts`, `contextCompactor.ts`, `toolCacheService.ts`, `workspaceService.ts`, `vault.ts`, `configService.ts`, `mcpService.ts`).
  - `src/test/`: Contains Mocha test suites run via `@vscode/test-cli` / `c8`.
- **HTTP Client:** Always use `HttpService.fetch` for network requests to ensure proper proxy handling and timeouts.
- **Auto-Scrolling:** When streaming text in the chat UI, implement "Smart Scrolling": only auto-scroll (`scrollTop = scrollHeight`) if the user is already near the bottom (within a ~150px threshold). This prevents "jitter" and disorientation if the user scrolls up during generation.
- **Context Menus & Auto-Send:** Editor context menu actions (Explain, Refactor, Fix) should use rich, detailed system prompts and invoke `autoSend: true`. Buffer auto-send requests (`pendingAutoSend`) until models are fully loaded.
- **Provider Toggling:** Allow users to dynamically enable or disable specific providers via `ConfigService` (`[providerId].enabled`). Disabled providers have their models filtered out from the combobox.

## 5. Webview Context Retention & Visibility Sync
- **Retain Context When Hidden:** `registerWebviewViewProvider` must be registered with `{ webviewOptions: { retainContextWhenHidden: true } }` so that switching between Activity Bar views (Explorer, Git, Search) does not destroy the Webview DOM.
- **Active Stream Tracking:** Track ongoing generation via `_currentStreamingText` and `_currentAbortController`.
- **Visibility Synchronization:** In `onDidChangeVisibility`, if generation is active, send a non-destructive `syncActiveStream` event. Never invoke `restoreHistory()` while an active generation is in progress, as `renderHistory()` will clear `chatContainer.innerHTML` and destroy in-flight turns.
- **Frontend Protection:** In `media/chat/main.js`, `case 'restoreHistory'` must guard against active generation (`if (isGenerating && msg.isGenerating !== false) break;`). `case 'syncActiveStream'` synchronizes text, subagents, and rehydrates in-flight state seamlessly.

## 6. Workspace Agent Tools & Permission Control
- **Built-in Workspace Tools:** `AgentToolService` exposes workspace inspection and modification tools: `workspace_search_files`, `workspace_get_context`, `workspace_list_dir`, `workspace_read_file`, `workspace_read_files` (parallel batch read), `workspace_write_file`, and `workspace_edit_file`.
- **Dynamic `.gitignore` Pattern Respect:** `WorkspaceService` dynamically parses and applies the user's workspace `.gitignore` rules (along with `.git` internal protection) when indexing files or performing searches (`workspace_get_context`, `workspace_search_files`). Do not invent or hardcode custom file exclusion lists.
- **Permission-First Safety:** File modifications (`workspace_write_file`, `workspace_edit_file`) are never applied automatically. They present an interactive unified diff card in the chat sidebar with **Approve** and **Reject** buttons.
- **Tool Output Caching & Truncation:** `ToolCacheService` caches idempotent tool results (`workspace_read_file`, `workspace_list_dir`, etc.) in memory, and automatically invalidates the cache whenever a file write or edit is approved. Large file reads are truncated with `smartTruncate` to preserve both top and bottom context lines.

## 7. Sub-Agents Architecture
- **Autonomous Leaf Workers:** Tool-capable models can spin up specialized sub-agents (`spin_subagent` tool via `SubagentService`) with inherited workspace context and multimodal attachments for deep analysis or multi-step tasks.
- **Leaf Recursion Guard:** Sub-agents execute as leaf workers only (`isSubagent: true` disables nested `spin_subagent` calls).
- **Turn Limits & Concurrency:** Capped at `MAX_SUBAGENTS_PER_TURN = 5` per turn to avoid runaway loops.
- **Termination & Monitoring:** Sub-agent executions are bound to parent signals. Calling `terminateAllActive()` stops all working subagents immediately. The UI header badge (`N Working`) and interactive Sub-Agents Monitor modal allow inspecting sub-agent cards, viewing internal context, and resetting inactive records.

## 8. Slash Commands & Dynamic Workspace Skills
- **Slash Commands Popover:** Typing `/` in the chat input opens an autocomplete popover with fuzzy filtering and keyboard navigation.
- **Dynamic Skills Discovery:** `SlashCommandService` dynamically scans `.agents/skills/**/SKILL.md` in all workspace roots, parsing YAML frontmatter without hardcoded definitions.
- **Built-in Shortcuts:** Standard commands (`/help`, `/clear`, `/history`, `/compact`, `/subagents`, `/settings`, `/explain`, `/refactor`, `/fix`) provide instant keyboard-driven execution.

## 9. Context Compaction & Multi-Session Chat
- **Context Compactor (`ContextCompactor`):** Earlier conversation turns are compacted on demand (via `/compact`) or automatically when turn count (`AUTO_COMPACT_MIN_TURNS = 6`) or token count (`AUTO_COMPACT_TOKEN_THRESHOLD = 3000`) is exceeded.
- **Graceful Fallback:** If the active AI provider is unavailable or throws during compaction, deterministic summary compaction takes over automatically.
- **Session Persistence & Export:** Multiple chat sessions are stored in `workspaceState`. Users can switch, create, and export chat histories as standard OpenAI JSON format.

## 10. Model Context Protocol (MCP)
- The extension supports both **HTTP/SSE** and **STDIO** MCP servers via `McpService`.
- External MCP configurations are loaded from `.vscode/mcp_config.json` or user global config.
- Local models generally do not support tool execution natively (`supportsTools: false`), whereas cloud providers (OpenAI, Anthropic, Gemini, OpenRouter, Ollama Cloud) support native tool calling payloads.

## 11. Testing & Code Quality
- Run the full test suite via `npm test` (compiles tests, compiles extension, runs ESLint, and executes Mocha tests with c8 coverage).
- All changes must maintain or increase test coverage (>90% on new logic).

## 12. Build & Packaging
- **Update VSIX Package:** After making functional changes or adding new features to the extension, you MUST build and update the `.vsix` package using `npm run build:vsix` so that the latest changes can be installed and distributed.
