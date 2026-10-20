import * as assert from 'assert';
import { AgentToolService, ToolPermissionRequest } from '../services/agentToolService';

declare const global: any;

describe('AgentToolService', () => {
    beforeEach(() => {
        global.__vscodeMockState.workspaceFolders = [
            { name: 'test-project', uri: { fsPath: '/test/workspace', path: '/test/workspace' } }
        ];
        global.__vscodeMockState.files.clear();
        global.__vscodeMockState.directories.clear();
        // Clear permission handler
        AgentToolService.setPermissionHandler(undefined as any);
    });

    it('returns built-in workspace tool schemas', () => {
        const tools = AgentToolService.getToolDefinitions();
        assert.strictEqual(tools.length, 7);
        const names = tools.map(t => t.function.name);
        assert.ok(names.includes('workspace_get_context'));
        assert.ok(names.includes('workspace_list_dir'));
        assert.ok(names.includes('workspace_search_files'));
        assert.ok(names.includes('workspace_read_file'));
        assert.ok(names.includes('workspace_write_file'));
        assert.ok(names.includes('workspace_edit_file'));
        assert.ok(names.includes('spin_subagent'));
    });

    it('identifies agent tools accurately', () => {
        assert.strictEqual(AgentToolService.isAgentTool('workspace_read_file'), true);
        assert.strictEqual(AgentToolService.isAgentTool('workspace_search_files'), true);
        assert.strictEqual(AgentToolService.isAgentTool('workspace_get_context'), true);
        assert.strictEqual(AgentToolService.isAgentTool('spin_subagent'), true);
        assert.strictEqual(AgentToolService.isAgentTool('mcp_fetch'), false);
        assert.strictEqual(AgentToolService.isAgentTool('random_tool'), false);
    });

    it('executes workspace_search_files with query matching and validation', async () => {
        await assert.rejects(
            async () => AgentToolService.executeTool('workspace_search_files', {}),
            /Missing required argument: "query"/
        );

        global.__vscodeMockState.files.set('/test/workspace/src/app.ts', 'const token = "secret123";\nconst hello = "world";');
        const res = await AgentToolService.executeTool('workspace_search_files', { query: 'secret123' });
        assert.strictEqual(res.query, 'secret123');
        assert.ok(res.results.includes('Found 1 match'));
        assert.ok(res.results.includes('src/app.ts:1: const token = "secret123";'));

        const emptyRes = await AgentToolService.executeTool('workspace_search_files', { query: 'nonexistent' });
        assert.ok(emptyRes.results.includes('No matches found for "nonexistent"'));
    });

    it('executes workspace_get_context and workspace_list_dir', async () => {
        global.__vscodeMockState.files.set('/test/workspace/file1.txt', 'one');
        global.__vscodeMockState.directories.set('/test/workspace', [
            { name: 'file1.txt', isDirectory: false },
            { name: 'src', isDirectory: true }
        ]);

        const ctx = await AgentToolService.executeTool('workspace_get_context', {});
        assert.ok(typeof ctx === 'string');
        assert.ok(ctx.includes('Workspace: test-project'));

        const listRes = await AgentToolService.executeTool('workspace_list_dir', { dir_path: '.' });
        assert.strictEqual(listRes.directory, '.');
        assert.ok(listRes.items.includes('src/'));
        assert.ok(listRes.items.includes('file1.txt'));
    });

    it('executes workspace_read_file with argument checks', async () => {
        await assert.rejects(
            async () => AgentToolService.executeTool('workspace_read_file', {}),
            /Missing required argument: "file_path"/
        );

        global.__vscodeMockState.files.set('/test/workspace/hello.txt', 'hello content');
        const readRes = await AgentToolService.executeTool('workspace_read_file', { file_path: 'hello.txt' });
        assert.strictEqual(readRes.file_path, 'hello.txt');
        assert.strictEqual(readRes.content, 'hello content');
    });

    it('executes workspace_write_file with permission gating (rejected and approved)', async () => {
        // Missing args
        await assert.rejects(
            async () => AgentToolService.executeTool('workspace_write_file', { file_path: 'file.txt' }),
            /Missing required arguments/
        );

        // No permission handler registered -> default rejection
        const rejectedDefault = await AgentToolService.executeTool('workspace_write_file', {
            file_path: 'new.txt',
            content: 'data'
        });
        assert.strictEqual(rejectedDefault.success, false);
        assert.ok(rejectedDefault.message.includes('User rejected permission'));

        // Permission handler registered -> rejects
        AgentToolService.setPermissionHandler(async (req: ToolPermissionRequest) => {
            assert.strictEqual(req.filePath, 'new.txt');
            AgentToolService.resolvePermission(req.requestId, false);
            return false;
        });

        const rejected = await AgentToolService.executeTool('workspace_write_file', {
            file_path: 'new.txt',
            content: 'data'
        });
        assert.strictEqual(rejected.success, false);

        // Permission handler registered -> approves
        AgentToolService.setPermissionHandler(async (req: ToolPermissionRequest) => {
            AgentToolService.resolvePermission(req.requestId, true);
            return true;
        });

        const approved = await AgentToolService.executeTool('workspace_write_file', {
            file_path: 'new.txt',
            content: 'approved data'
        });
        assert.strictEqual(approved.success, true);
        assert.strictEqual(global.__vscodeMockState.files.get('/test/workspace/new.txt'), 'approved data');
    });

    it('executes workspace_edit_file with permission gating', async () => {
        // Missing args
        await assert.rejects(
            async () => AgentToolService.executeTool('workspace_edit_file', { file_path: 'mod.txt' }),
            /Missing required arguments/
        );

        global.__vscodeMockState.files.set('/test/workspace/mod.txt', 'old content here');

        // Approve
        AgentToolService.setPermissionHandler(async (req: ToolPermissionRequest) => {
            assert.ok(req.diffText.includes('-old content here'));
            assert.ok(req.diffText.includes('+new content here'));
            AgentToolService.resolvePermission(req.requestId, true);
            return true;
        });

        const approved = await AgentToolService.executeTool('workspace_edit_file', {
            file_path: 'mod.txt',
            target_content: 'old content here',
            replacement_content: 'new content here'
        });
        assert.strictEqual(approved.success, true);
        assert.strictEqual(global.__vscodeMockState.files.get('/test/workspace/mod.txt'), 'new content here');

        // User rejection during edit
        AgentToolService.setPermissionHandler(async (req: ToolPermissionRequest) => {
            AgentToolService.resolvePermission(req.requestId, false);
            return false;
        });

        const rejected = await AgentToolService.executeTool('workspace_edit_file', {
            file_path: 'mod.txt',
            target_content: 'new content here',
            replacement_content: 'another update'
        });
        assert.strictEqual(rejected.success, false);
        assert.ok(rejected.message.includes('User rejected permission'));
    });

    it('handles permission handler errors safely by rejecting', async () => {
        global.__vscodeMockState.files.set('/test/workspace/error_test.txt', 'data');
        AgentToolService.setPermissionHandler(async () => {
            throw new Error('UI permission handler crashed');
        });

        const res = await AgentToolService.executeTool('workspace_write_file', {
            file_path: 'error_test.txt',
            content: 'new content'
        });
        assert.strictEqual(res.success, false);
        assert.ok(res.message.includes('User rejected permission'));
    });

    it('handles resolvePermission with unknown requestId safely', () => {
        // Calling with unknown requestId should not throw
        assert.doesNotThrow(() => AgentToolService.resolvePermission('non-existent-id', true));
    });

    it('throws error for unknown workspace agent tool', async () => {
        await assert.rejects(
            async () => AgentToolService.executeTool('workspace_unknown_action', {}),
            /Unknown workspace agent tool: workspace_unknown_action/
        );
    });
});
