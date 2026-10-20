import * as vscode from 'vscode';
import * as path from 'path';

export interface FileDiffInfo {
    filePath: string;
    isNew: boolean;
    oldContent: string;
    newContent: string;
    diffText: string;
}

export class WorkspaceService {
    /**
     * Parses a single .gitignore line into corresponding glob pattern(s).
     * Returns an empty array for comments, empty lines, negation patterns, or invalid patterns.
     */
    public static parseGitIgnoreLineToGlobs(line: string): string[] {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
            return [];
        }

        // Unescape escaped hash or exclamation
        if (trimmed.startsWith('\\#') || trimmed.startsWith('\\!')) {
            trimmed = trimmed.slice(1);
        }

        let isDirOnly = false;
        let clean = trimmed;

        if (clean.endsWith('/')) {
            isDirOnly = true;
            clean = clean.slice(0, -1);
        }

        const isRootAnchored = clean.startsWith('/');
        if (isRootAnchored) {
            clean = clean.slice(1);
        }

        if (!clean || clean.includes('{') || clean.includes('}')) {
            return [];
        }

        const globs: string[] = [];
        const hasWildcard = clean.includes('*') || clean.includes('?');

        if (isRootAnchored) {
            if (isDirOnly) {
                globs.push(`${clean}/**`);
            } else if (hasWildcard && !clean.includes('/')) {
                globs.push(clean);
                globs.push(`${clean}/**`);
            } else {
                globs.push(`${clean}/**`);
                globs.push(clean);
            }
        } else if (clean.startsWith('**/')) {
            if (isDirOnly) {
                globs.push(`${clean}/**`);
            } else {
                globs.push(`${clean}/**`);
                globs.push(clean);
            }
        } else {
            if (isDirOnly) {
                globs.push(`**/${clean}/**`);
            } else if (hasWildcard && !clean.includes('/')) {
                globs.push(`**/${clean}`);
                globs.push(`**/${clean}/**`);
            } else {
                globs.push(`**/${clean}/**`);
                globs.push(`**/${clean}`);
            }
        }

        return globs;
    }

    /**
     * Reads the workspace's .gitignore file(s) and converts user-specified
     * patterns into a glob exclude pattern string suitable for vscode.workspace.findFiles.
     * Always ensures .git directory contents are excluded.
     */
    public static async getGitIgnoreExcludePattern(rootUri?: vscode.Uri): Promise<string> {
        const globs = new Set<string>();
        globs.add('**/.git/**');

        const folders = rootUri
            ? [{ uri: rootUri }]
            : (vscode.workspace.workspaceFolders || []);

        for (const folder of folders) {
            try {
                const gitIgnoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
                const raw = await vscode.workspace.fs.readFile(gitIgnoreUri);
                const content = Buffer.from(raw).toString('utf8');
                const lines = content.split(/\r?\n/);
                for (const line of lines) {
                    const parsed = this.parseGitIgnoreLineToGlobs(line);
                    for (const g of parsed) {
                        globs.add(g);
                    }
                }
            } catch {
                // .gitignore does not exist in this folder, continue safely
            }
        }

        if (globs.size === 1) {
            return Array.from(globs)[0];
        }

        return `{${Array.from(globs).join(',')}}`;
    }

    /**
     * Returns true if there is an open workspace folder.
     */
    public static hasWorkspace(): boolean {
        return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
    }

    /**
     * Get the root Uri of the primary workspace folder.
     */
    public static getRootUri(): vscode.Uri | null {
        if (!this.hasWorkspace()) {
            return null;
        }
        return vscode.workspace.workspaceFolders![0].uri;
    }

    /**
     * Returns a structured overview of the workspace directory tree and active file.
     */
    public static async getWorkspaceContext(maxFiles: number = 300): Promise<string> {
        if (!this.hasWorkspace()) {
            return 'No workspace folder is currently open in VS Code.';
        }

        const workspaceFolder = vscode.workspace.workspaceFolders![0];
        const workspaceName = workspaceFolder.name;
        const rootPath = workspaceFolder.uri.fsPath;

        // Active editor information
        let activeEditorInfo = 'None';
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const rel = path.relative(rootPath, activeEditor.document.fileName);
            activeEditorInfo = `${rel} (${activeEditor.document.languageId}, ${activeEditor.document.lineCount} lines)`;
        }

        // Fast file finding using VS Code's indexer, respecting the user's .gitignore
        const excludePattern = await this.getGitIgnoreExcludePattern(workspaceFolder.uri);
        const fileUris = await vscode.workspace.findFiles('**/*', excludePattern, maxFiles);

        const relativePaths = fileUris.map(uri => path.relative(rootPath, uri.fsPath)).sort();

        // Build tree string
        const treeString = this.formatFileTree(relativePaths);

        return `### Workspace: ${workspaceName}\n` +
            `Root: \`${rootPath}\`\n` +
            `Active Document: \`${activeEditorInfo}\`\n` +
            `Total Indexed Files: ${relativePaths.length}${relativePaths.length >= maxFiles ? ' (capped at limit)' : ''}\n\n` +
            `\`\`\`\n${treeString}\n\`\`\``;
    }

    /**
     * Formats a list of relative paths into a clean indented ASCII directory tree.
     */
    private static formatFileTree(paths: string[]): string {
        interface TreeNode {
            [key: string]: TreeNode;
        }

        const root: TreeNode = {};

        for (const p of paths) {
            const parts = p.split(path.sep).filter(Boolean);
            let current = root;
            for (const part of parts) {
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
            }
        }

        const lines: string[] = [];

        function printNode(node: TreeNode, indent: string = '') {
            const keys = Object.keys(node).sort((a, b) => {
                const aIsDir = Object.keys(node[a]).length > 0;
                const bIsDir = Object.keys(node[b]).length > 0;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.localeCompare(b);
            });

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const isLast = i === keys.length - 1;
                const marker = isLast ? '└── ' : '├── ';
                const childIndent = indent + (isLast ? '    ' : '│   ');
                const isDir = Object.keys(node[key]).length > 0;

                lines.push(`${indent}${marker}${key}${isDir ? '/' : ''}`);
                if (isDir) {
                    printNode(node[key], childIndent);
                }
            }
        }

        printNode(root);
        return lines.length > 0 ? lines.join('\n') : '(Empty workspace)';
    }

    /**
     * Resolves a file path relative to the workspace root.
     */
    public static resolveUri(targetPath: string): vscode.Uri {
        if (path.isAbsolute(targetPath)) {
            return vscode.Uri.file(targetPath);
        }
        const root = this.getRootUri();
        if (!root) {
            throw new Error('No workspace folder is currently open.');
        }
        return vscode.Uri.joinPath(root, targetPath);
    }

    /**
     * Reads file content from the workspace safely.
     */
    public static async readFile(targetPath: string, maxBytes = 100000): Promise<string> {
        const uri = this.resolveUri(targetPath);
        try {
            const uint8 = await vscode.workspace.fs.readFile(uri);
            if (uint8.length > maxBytes) {
                const truncated = uint8.slice(0, maxBytes);
                return Buffer.from(truncated).toString('utf8') + `\n\n... [Truncated: file size exceeds ${maxBytes} bytes]`;
            }
            return Buffer.from(uint8).toString('utf8');
        } catch (err: any) {
            throw new Error(`Failed to read file "${targetPath}": ${err.message}`);
        }
    }

    /**
     * Reads multiple files from the workspace in parallel.
     */
    public static async readMultipleFiles(targetPaths: string[], maxBytesPerFile = 60000): Promise<Record<string, { content?: string; error?: string }>> {
        const results: Record<string, { content?: string; error?: string }> = {};
        await Promise.all(
            targetPaths.map(async (targetPath) => {
                try {
                    const content = await this.readFile(targetPath, maxBytesPerFile);
                    results[targetPath] = { content };
                } catch (err: any) {
                    results[targetPath] = { error: err.message };
                }
            })
        );
        return results;
    }

    /**
     * Lists files and folders in a given directory path.
     */
    public static async listDirectory(targetPath: string = '.'): Promise<{ name: string; isDirectory: boolean }[]> {
        const uri = this.resolveUri(targetPath);
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => ({
                name,
                isDirectory: type === vscode.FileType.Directory
            })).sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });
        } catch (err: any) {
            throw new Error(`Failed to list directory "${targetPath}": ${err.message}`);
        }
    }

    /**
     * Searches for a text query or pattern across workspace files.
     */
    public static async searchFiles(query: string, filePattern?: string, maxResults = 30): Promise<string> {
        if (!query || query.trim() === '') {
            return 'Empty search query provided.';
        }

        const includePattern = filePattern && filePattern.trim() ? filePattern.trim() : '**/*';
        const excludePattern = await this.getGitIgnoreExcludePattern();
        const files = await vscode.workspace.findFiles(includePattern, excludePattern, 200);

        if (!files || files.length === 0) {
            return `No files found matching pattern "${includePattern}".`;
        }

        const matches: string[] = [];
        const root = this.getRootUri();
        const rootPath = root ? root.fsPath : '';
        const lowerQuery = query.toLowerCase();

        for (const fileUri of files) {
            if (matches.length >= maxResults) break;
            try {
                const raw = await vscode.workspace.fs.readFile(fileUri);
                if (raw.length > 500000) continue; // Skip large binary/data files > 500KB
                const content = Buffer.from(raw).toString('utf8');
                if (!content.toLowerCase().includes(lowerQuery)) continue;

                const relPath = rootPath ? path.relative(rootPath, fileUri.fsPath) : fileUri.fsPath;
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    if (matches.length >= maxResults) break;
                    if (lines[i].toLowerCase().includes(lowerQuery)) {
                        const snippet = lines[i].trim().substring(0, 140);
                        matches.push(`${relPath}:${i + 1}: ${snippet}`);
                    }
                }
            } catch {
                // Ignore unreadable or locked files
            }
        }

        if (matches.length === 0) {
            return `No matches found for "${query}".`;
        }

        return `Found ${matches.length} match(es) for "${query}":\n` + matches.join('\n');
    }

    /**
     * Prepares diff information for a file creation or overwrite.
     */
    public static async prepareWriteDiff(targetPath: string, newContent: string): Promise<FileDiffInfo> {
        const uri = this.resolveUri(targetPath);
        let oldContent = '';
        let isNew = true;

        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            oldContent = Buffer.from(raw).toString('utf8');
            isNew = false;
        } catch {
            // File does not exist yet
            isNew = true;
            oldContent = '';
        }

        const diffText = this.createUnifiedDiff(targetPath, oldContent, newContent, isNew);

        return {
            filePath: targetPath,
            isNew,
            oldContent,
            newContent,
            diffText
        };
    }

    /**
     * Prepares diff information for replacing target content with new content.
     */
    public static async prepareEditDiff(targetPath: string, targetContent: string, replacementContent: string): Promise<FileDiffInfo> {
        const uri = this.resolveUri(targetPath);
        const raw = await vscode.workspace.fs.readFile(uri);
        const oldContent = Buffer.from(raw).toString('utf8');

        if (!oldContent.includes(targetContent)) {
            throw new Error(`Target content to replace was not found in file "${targetPath}".`);
        }

        const newContent = oldContent.replace(targetContent, replacementContent);
        const diffText = this.createUnifiedDiff(targetPath, oldContent, newContent, false);

        return {
            filePath: targetPath,
            isNew: false,
            oldContent,
            newContent,
            diffText
        };
    }

    /**
     * Performs the actual write operation on disk once user approval is received.
     */
    public static async applyWrite(targetPath: string, content: string): Promise<void> {
        const uri = this.resolveUri(targetPath);
        const data = Buffer.from(content, 'utf8');
        await vscode.workspace.fs.writeFile(uri, data);
    }

    /**
     * Generates a clean unified diff string.
     */
    public static createUnifiedDiff(filePath: string, oldContent: string, newContent: string, isNew: boolean): string {
        const oldLines = isNew ? [] : oldContent.split('\n');
        const newLines = newContent.split('\n');

        const header = [
            `--- a/${filePath}${isNew ? ' (new file)' : ''}`,
            `+++ b/${filePath}`
        ];

        // Simplified diff generation
        const diffLines: string[] = [...header];

        if (isNew) {
            diffLines.push(`@@ -0,0 +1,${newLines.length} @@`);
            for (const l of newLines) {
                diffLines.push(`+${l}`);
            }
        } else {
            // Find common prefix and suffix
            let start = 0;
            while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
                start++;
            }

            let oldEnd = oldLines.length - 1;
            let newEnd = newLines.length - 1;
            while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
                oldEnd--;
                newEnd--;
            }

            const contextStart = Math.max(0, start - 2);
            const oldContextEnd = Math.min(oldLines.length - 1, oldEnd + 2);
            const newContextEnd = Math.min(newLines.length - 1, newEnd + 2);

            diffLines.push(`@@ -${contextStart + 1},${oldContextEnd - contextStart + 1} +${contextStart + 1},${newContextEnd - contextStart + 1} @@`);

            // Pre-context
            for (let i = contextStart; i < start; i++) {
                diffLines.push(` ${oldLines[i]}`);
            }
            // Removed
            for (let i = start; i <= oldEnd; i++) {
                diffLines.push(`-${oldLines[i]}`);
            }
            // Added
            for (let i = start; i <= newEnd; i++) {
                diffLines.push(`+${newLines[i]}`);
            }
            // Post-context
            for (let i = oldEnd + 1; i <= oldContextEnd; i++) {
                diffLines.push(` ${oldLines[i]}`);
            }
        }

        return diffLines.join('\n');
    }
}
