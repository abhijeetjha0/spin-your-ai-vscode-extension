import * as assert from 'assert';
import { WorkspaceService } from '../services/workspaceService';

declare const global: any;

describe('WorkspaceService', () => {
    beforeEach(() => {
        global.__vscodeMockState.workspaceFolders = [
            { name: 'test-project', uri: { fsPath: '/test/workspace', path: '/test/workspace' } }
        ];
        global.__vscodeMockState.files.clear();
        global.__vscodeMockState.directories.clear();
        global.__vscodeMockState.activeTextEditor = undefined;
    });

    it('checks workspace presence', () => {
        assert.strictEqual(WorkspaceService.hasWorkspace(), true);
        assert.ok(WorkspaceService.getRootUri());

        global.__vscodeMockState.workspaceFolders = [];
        assert.strictEqual(WorkspaceService.hasWorkspace(), false);
        assert.strictEqual(WorkspaceService.getRootUri(), null);
    });

    it('resolves URIs correctly', () => {
        const absUri = WorkspaceService.resolveUri('/absolute/path/file.txt');
        assert.strictEqual(absUri.fsPath, '/absolute/path/file.txt');

        const relUri = WorkspaceService.resolveUri('src/index.ts');
        assert.ok(relUri.fsPath.includes('/test/workspace/src/index.ts'));

        // Throws when no workspace open
        global.__vscodeMockState.workspaceFolders = undefined;
        assert.throws(() => WorkspaceService.resolveUri('relative.ts'), /No workspace folder is currently open/);
    });

    it('generates workspace context when no workspace is open', async () => {
        global.__vscodeMockState.workspaceFolders = [];
        const ctx = await WorkspaceService.getWorkspaceContext();
        assert.strictEqual(ctx, 'No workspace folder is currently open in VS Code.');
    });

    it('generates rich workspace context tree with active editor', async () => {
        global.__vscodeMockState.files.set('/test/workspace/src/app.ts', 'console.log("app");');
        global.__vscodeMockState.files.set('/test/workspace/src/utils/math.ts', 'export const add = 1;');
        global.__vscodeMockState.files.set('/test/workspace/package.json', '{}');

        global.__vscodeMockState.activeTextEditor = {
            document: {
                fileName: '/test/workspace/src/app.ts',
                languageId: 'typescript',
                lineCount: 42
            }
        };

        const ctx = await WorkspaceService.getWorkspaceContext(10);
        assert.ok(ctx.includes('Workspace: test-project'));
        assert.ok(ctx.includes('Active Document: `src/app.ts (typescript, 42 lines)`'));
        assert.ok(ctx.includes('src/'));
        assert.ok(ctx.includes('app.ts'));
        assert.ok(ctx.includes('package.json'));
    });

    it('reads file safely and truncates when exceeding maxBytes', async () => {
        const filePath = 'test.txt';
        const fullPath = '/test/workspace/test.txt';
        global.__vscodeMockState.files.set(fullPath, 'Hello world');

        const content = await WorkspaceService.readFile(filePath);
        assert.strictEqual(content, 'Hello world');

        // Truncation test
        const longContent = 'A'.repeat(50);
        global.__vscodeMockState.files.set(fullPath, longContent);
        const truncated = await WorkspaceService.readFile(filePath, 20);
        assert.ok(truncated.includes('Truncated: file size exceeds 20 bytes'));

        // Error test
        await assert.rejects(
            async () => WorkspaceService.readFile('nonexistent.txt'),
            /Failed to read file "nonexistent.txt"/
        );
    });

    it('lists directory contents with correct sorting and handles errors', async () => {
        global.__vscodeMockState.directories.set('/test/workspace/src', [
            { name: 'zebra.ts', isDirectory: false },
            { name: 'alpha.ts', isDirectory: false },
            { name: 'zoo', isDirectory: true },
            { name: 'alpha_dir', isDirectory: true }
        ]);

        const items = await WorkspaceService.listDirectory('src');
        assert.strictEqual(items.length, 4);
        // Directories first, then alphabetically
        assert.strictEqual(items[0].name, 'alpha_dir');
        assert.strictEqual(items[0].isDirectory, true);
        assert.strictEqual(items[1].name, 'zoo');
        assert.strictEqual(items[1].isDirectory, true);
        // Files second, alphabetically
        assert.strictEqual(items[2].name, 'alpha.ts');
        assert.strictEqual(items[2].isDirectory, false);
        assert.strictEqual(items[3].name, 'zebra.ts');
        assert.strictEqual(items[3].isDirectory, false);

        // Error handling test
        await assert.rejects(
            async () => WorkspaceService.listDirectory('/invalid/nonexistent/dir'),
            /Failed to list directory/
        );
    });

    it('creates unified diff for new and modified files', () => {
        const newDiff = WorkspaceService.createUnifiedDiff('new.txt', '', 'line 1\nline 2', true);
        assert.ok(newDiff.includes('--- a/new.txt (new file)'));
        assert.ok(newDiff.includes('+line 1'));
        assert.ok(newDiff.includes('+line 2'));

        const modDiff = WorkspaceService.createUnifiedDiff(
            'mod.txt',
            'prefix1\nprefix2\nold middle\nsuffix1\nsuffix2',
            'prefix1\nprefix2\nnew middle\nsuffix1\nsuffix2',
            false
        );
        assert.ok(modDiff.includes('--- a/mod.txt'));
        assert.ok(modDiff.includes('-old middle'));
        assert.ok(modDiff.includes('+new middle'));
        assert.ok(modDiff.includes(' prefix1'));
        assert.ok(modDiff.includes(' suffix1'));
    });

    it('prepares write diff for new and existing files', async () => {
        const fullPath = '/test/workspace/file.ts';

        // File does not exist yet -> isNew = true
        const diffNew = await WorkspaceService.prepareWriteDiff('file.ts', 'const a = 1;');
        assert.strictEqual(diffNew.isNew, true);
        assert.ok(diffNew.diffText.includes('+const a = 1;'));

        // File exists -> isNew = false
        global.__vscodeMockState.files.set(fullPath, 'const a = 1;');
        const diffExisting = await WorkspaceService.prepareWriteDiff('file.ts', 'const a = 2;');
        assert.strictEqual(diffExisting.isNew, false);
        assert.ok(diffExisting.diffText.includes('-const a = 1;'));
        assert.ok(diffExisting.diffText.includes('+const a = 2;'));
    });

    it('prepares edit diff and applies write', async () => {
        const fullPath = '/test/workspace/edit.ts';
        global.__vscodeMockState.files.set(fullPath, 'const hello = "world";\nconsole.log(hello);');

        const editDiff = await WorkspaceService.prepareEditDiff('edit.ts', 'hello = "world"', 'hello = "universe"');
        assert.strictEqual(editDiff.isNew, false);
        assert.ok(editDiff.newContent.includes('hello = "universe"'));
        assert.ok(editDiff.diffText.includes('-const hello = "world";'));
        assert.ok(editDiff.diffText.includes('+const hello = "universe";'));

        // Error when target content not found
        await assert.rejects(
            async () => WorkspaceService.prepareEditDiff('edit.ts', 'missing_text', 'replacement'),
            /Target content to replace was not found/
        );

        // Apply write
        await WorkspaceService.applyWrite('edit.ts', editDiff.newContent);
        assert.strictEqual(global.__vscodeMockState.files.get(fullPath), editDiff.newContent);
    });

    it('searches files across the workspace accurately', async () => {
        // Empty query
        const emptyQueryRes = await WorkspaceService.searchFiles('');
        assert.strictEqual(emptyQueryRes, 'Empty search query provided.');

        // Setup files in mock state
        global.__vscodeMockState.files.set('/test/workspace/src/auth.ts', 'export function login() {\n  const token = "auth-token-xyz";\n  return token;\n}');
        global.__vscodeMockState.files.set('/test/workspace/src/api.ts', 'import { login } from "./auth";\n// Call login function');
        global.__vscodeMockState.files.set('/test/workspace/docs/readme.md', '# Documentation\nAuthentication uses token mechanism.');

        // Search for 'login'
        const matchRes = await WorkspaceService.searchFiles('login');
        assert.ok(matchRes.includes('Found 3 match(es) for "login":'));
        assert.ok(matchRes.includes('src/auth.ts:1: export function login() {'));
        assert.ok(matchRes.includes('src/api.ts:1: import { login } from "./auth";'));
        assert.ok(matchRes.includes('src/api.ts:2: // Call login function'));

        // Search with no matches
        const noMatchRes = await WorkspaceService.searchFiles('non_existent_symbol');
        assert.strictEqual(noMatchRes, 'No matches found for "non_existent_symbol".');

        // Search with maxResults
        const limitedRes = await WorkspaceService.searchFiles('login', undefined, 1);
        assert.ok(limitedRes.includes('Found 1 match(es) for "login":'));
    });

    it('parses .gitignore lines into globs accurately', () => {
        // Comments, empty lines, negation
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('# comment'), []);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs(''), []);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('   '), []);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('!keep.txt'), []);

        // Directory only (trailing slash)
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('node_modules/'), ['**/node_modules/**']);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('/out/'), ['out/**']);

        // Root anchored
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('/dist'), ['dist/**', 'dist']);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('/build/Release'), ['build/Release/**', 'build/Release']);

        // Wildcards
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('*.log'), ['**/*.log', '**/*.log/**']);
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('*.vsix'), ['**/*.vsix', '**/*.vsix/**']);

        // Subdirectories without leading slash
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('build/Release'), ['**/build/Release/**', '**/build/Release']);

        // Already with glob prefix
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('**/.vitepress/dist'), ['**/.vitepress/dist/**', '**/.vitepress/dist']);

        // Malformed braces
        assert.deepStrictEqual(WorkspaceService.parseGitIgnoreLineToGlobs('foo{a,b}'), []);
    });

    it('reads .gitignore and dynamically creates exclude pattern', async () => {
        // Without .gitignore, defaults to **/.git/**
        const defaultExcludes = await WorkspaceService.getGitIgnoreExcludePattern();
        assert.strictEqual(defaultExcludes, '**/.git/**');

        // With .gitignore present in workspace
        const gitIgnoreContent = '# Comment\nnode_modules/\ndist/\n*.log\n/out\n!keep.txt\n';
        global.__vscodeMockState.files.set('/test/workspace/.gitignore', gitIgnoreContent);

        const pattern = await WorkspaceService.getGitIgnoreExcludePattern();
        assert.ok(pattern.includes('**/.git/**'));
        assert.ok(pattern.includes('**/node_modules/**'));
        assert.ok(pattern.includes('**/dist/**'));
        assert.ok(pattern.includes('**/*.log'));
        assert.ok(pattern.includes('out/**'));
        assert.strictEqual(pattern.includes('!keep.txt'), false);
    });

    it('respects .gitignore patterns when fetching files for context and search', async () => {
        // Define user's gitignore
        global.__vscodeMockState.files.set(
            '/test/workspace/.gitignore',
            'node_modules/\ndist/\n*.log\n'
        );

        // Define files
        global.__vscodeMockState.files.set('/test/workspace/src/app.ts', 'const app = "login";');
        global.__vscodeMockState.files.set('/test/workspace/dist/bundle.js', 'const bundle = "login";');
        global.__vscodeMockState.files.set('/test/workspace/node_modules/pkg/index.js', 'const pkg = "login";');
        global.__vscodeMockState.files.set('/test/workspace/debug.log', 'login error in log');

        // Context fetching should exclude gitignored files
        const ctx = await WorkspaceService.getWorkspaceContext(10);
        assert.ok(ctx.includes('app.ts'));
        assert.strictEqual(ctx.includes('bundle.js'), false);
        assert.strictEqual(ctx.includes('pkg/index.js'), false);

        // Search fetching should exclude gitignored files
        const searchRes = await WorkspaceService.searchFiles('login');
        assert.ok(searchRes.includes('src/app.ts:1: const app = "login";'));
        assert.strictEqual(searchRes.includes('dist/bundle.js'), false);
        assert.strictEqual(searchRes.includes('node_modules'), false);
    });
});


