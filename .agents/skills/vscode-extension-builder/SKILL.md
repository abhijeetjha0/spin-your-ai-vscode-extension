---
name: vscode-extension-builder
description: >-
  Guides the creation, development, and publishing of Visual Studio Code extensions.
  Enforces industry best practices including Yeoman scaffolding, TypeScript, UI/UX
  guidelines, and proper use of the Extension API and Contribution Points.
author: "Abhijit Kumar Jha"
author_url: "https://github.com/abhijeetjha0"
version: "1.0.0"
---

# 📝 Skill: vscode-extension-builder

Use this skill whenever asked to scaffold, build, debug, or publish a Visual Studio Code extension.

---

## 📌 Core Rules & Workflow for AI Agents

### 1. Scaffolding & Setup

When asked to create a new VS Code extension, always recommend the official Yeoman generator (`yo code`).
- **Prompt the user** to run the generator if the project is empty.
  ```bash
  npx --yes yo code
  ```
- **Language**: Default to **TypeScript**. Avoid plain JavaScript unless explicitly requested.
- **Bundler**: Recommend **esbuild** or **webpack** (available via `yo code`) for faster load times and smaller VSIX packages.

### 2. Extension Anatomy & Contribution Points

Before writing code, analyze the requirements and plan the `package.json` (Extension Manifest).
- **Activation Events (`activationEvents`)**: Keep them minimal. Use `onCommand`, `onView`, `onLanguage`, etc. Avoid `*` (activate on startup) unless absolutely necessary for performance. In newer VS Code versions, many activation events are inferred from contribution points, but it's best to be explicit if unsure.
- **Contribution Points (`contributes`)**: Define UI elements declaratively here, not in code.
  - `commands`: Register commands.
  - `menus`: Bind commands to UI locations (editor context menu, explorer, command palette).
  - `keybindings`: Provide default shortcuts.
  - `configuration`: Expose user settings.
  - `views` & `viewsContainers`: Create custom sidebars.
  - `colors`: Contribute custom theme colors.

### 3. API Usage & Best Practices

- **Context & Subscriptions**: Always push disposables (event listeners, registered commands) to `context.subscriptions` in the `activate` function to prevent memory leaks.
  ```typescript
  export function activate(context: vscode.ExtensionContext) {
      let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {});
      context.subscriptions.push(disposable);
  }
  ```
- **UI/UX Guidelines**:
  - Prefer native VS Code UI paradigms (QuickPicks, InputBoxes, TreeViews) over Webviews.
  - If a Webview is necessary (for complex/custom UI), ensure it matches the active VS Code theme using CSS variables (`var(--vscode-editor-background)`, etc.).
  - Follow the official VS Code UX Guidelines for terminology, iconography (use `ThemeIcon`), and layout.
- **Long-Running Tasks**: Use `vscode.window.withProgress` to provide visual feedback for asynchronous operations.
- **Logging**: Output detailed logs to a custom `vscode.OutputChannel` rather than relying solely on `console.log`.

### 4. Testing

- Utilize the built-in `@vscode/test-electron` test runner (scaffolded by `yo code`).
- Write integration tests that launch a VS Code instance and interact with the extension API.

### 5. Packaging & Publishing

When asked to prepare an extension for release:
1. Ensure `vsce` is installed (`npm install -g @vscode/vsce`).
2. Verify the `README.md` and `CHANGELOG.md` are updated (default templates will block publishing).
3. Check `package.json` for proper `publisher`, `icon`, `repository`, and `license` fields.
4. Provide the command to package the extension:
   ```bash
   vsce package
   ```
5. To publish, recommend:
   ```bash
   vsce publish
   ```
   (Note: The user will need a Personal Access Token from Azure DevOps).

---

## 🚫 Anti-Patterns

- **Don't** perform heavy synchronous work in the `activate` function.
- **Don't** use Webviews just because it's easier to write HTML/CSS. Always evaluate native APIs first (TreeViews, QuickPicks).
- **Don't** hardcode paths. Use `context.extensionUri` or `context.extensionPath`.
- **Don't** forget to handle the `deactivate` lifecycle if you allocate resources outside of standard VS Code disposables.
