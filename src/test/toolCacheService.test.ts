import * as assert from 'assert';
import { ToolCacheService } from '../services/toolCacheService';

describe('ToolCacheService', () => {
    beforeEach(() => {
        ToolCacheService.reset();
    });

    it('identifies idempotent tools accurately', () => {
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_read_file'), true);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_read_files'), true);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_list_dir'), true);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_get_context'), true);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_search_files'), true);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_write_file'), false);
        assert.strictEqual(ToolCacheService.isIdempotent('workspace_edit_file'), false);
        assert.strictEqual(ToolCacheService.isIdempotent('spin_subagent'), false);
    });

    it('caches and retrieves results for idempotent tools', () => {
        ToolCacheService.set('workspace_read_file', { file_path: 'test.ts' }, 'hello world');
        const cached = ToolCacheService.get('workspace_read_file', { file_path: 'test.ts' });
        assert.strictEqual(cached, 'hello world');

        // Non-idempotent tool should never be cached
        ToolCacheService.set('workspace_write_file', { file_path: 'test.ts' }, 'data');
        assert.strictEqual(ToolCacheService.get('workspace_write_file', { file_path: 'test.ts' }), null);

        // Different args miss cache
        assert.strictEqual(ToolCacheService.get('workspace_read_file', { file_path: 'other.ts' }), null);
    });

    it('invalidates cache correctly', () => {
        ToolCacheService.set('workspace_read_file', { file_path: 'a.ts' }, 'content A');
        assert.strictEqual(ToolCacheService.get('workspace_read_file', { file_path: 'a.ts' }), 'content A');

        ToolCacheService.invalidate();
        assert.strictEqual(ToolCacheService.get('workspace_read_file', { file_path: 'a.ts' }), null);
    });

    it('smartTruncate returns short content intact', () => {
        const short = 'line 1\nline 2\nline 3';
        assert.strictEqual(ToolCacheService.smartTruncate(short, 8000), short);
    });

    it('smartTruncate preserves top and bottom lines for oversized content', () => {
        const lines: string[] = [];
        for (let i = 1; i <= 300; i++) {
            lines.push(`Line ${i}: const var_${i} = ${i}; // padding text to inflate characters`);
        }
        const fullText = lines.join('\n');
        assert.ok(fullText.length > 5000);

        const truncated = ToolCacheService.smartTruncate(fullText, 2000);
        assert.ok(truncated.length <= 2500);
        assert.ok(truncated.includes('Line 1:'));
        assert.ok(truncated.includes('Line 300:'));
        assert.ok(truncated.includes('... [Omitted'));
    });
});
