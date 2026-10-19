import * as assert from 'assert';
import { ContextCompactor, ChatHistoryItem } from '../services/contextCompactor';
import { BaseProvider } from '../providers/baseProvider';
import { StreamChunk } from '../types';

describe('ContextCompactor', () => {
    it('verifies constant thresholds', () => {
        assert.strictEqual(ContextCompactor.PRESERVED_RECENT_TURNS, 4);
        assert.strictEqual(ContextCompactor.AUTO_COMPACT_MIN_TURNS, 10);
        assert.strictEqual(ContextCompactor.AUTO_COMPACT_TOKEN_THRESHOLD, 6000);
    });

    it('estimates tokens correctly', () => {
        assert.strictEqual(ContextCompactor.estimateTokens(''), 0);
        assert.strictEqual(ContextCompactor.estimateTokens('abcd'), 1);
        assert.strictEqual(ContextCompactor.estimateTokens('12345678'), 2);
    });

    it('estimates history tokens across array', () => {
        const history: ChatHistoryItem[] = [
            { role: 'user', text: '1234' },
            { role: 'assistant', text: '12345678' }
        ];
        assert.strictEqual(ContextCompactor.estimateHistoryTokens(history), 3);
    });

    it('returns empty compaction result when history is small or empty', async () => {
        const emptyResult = await ContextCompactor.compactHistory([]);
        assert.strictEqual(emptyResult.compactedCount, 0);
        assert.strictEqual(emptyResult.summary, '');
        assert.strictEqual(emptyResult.savedTokens, 0);

        const shortHistory: ChatHistoryItem[] = [
            { role: 'user', text: 'turn 1' },
            { role: 'assistant', text: 'turn 2' },
            { role: 'user', text: 'turn 3' },
            { role: 'assistant', text: 'turn 4' }
        ];
        const shortResult = await ContextCompactor.compactHistory(shortHistory);
        assert.strictEqual(shortResult.compactedCount, 0);
        assert.strictEqual(shortResult.remainingHistory.length, 4);
    });

    it('generates deterministic summary with file contexts and formatted turns', () => {
        const items: ChatHistoryItem[] = [
            {
                role: 'user',
                text: 'What does this function do?\n--- Active File: src/main.ts ---\nFile: `src/utils.ts`\n```typescript\nfunction test() {}\n```'
            },
            {
                role: 'assistant',
                text: '# Function Explanation\n## Return Value\nIt tests execution.'
            },
            {
                role: 'user',
                text: 'A'.repeat(200) // Truncation test > 140 chars
            },
            {
                role: 'assistant',
                text: '> blockquote\n\nDirect answer without headers.'
            },
            {
                role: 'user',
                text: ''
            },
            {
                role: 'system',
                text: 'System prompt'
            }
        ];

        const summary = ContextCompactor.generateDeterministicSummary(items);
        assert.ok(summary.includes('[COMPACTED CONTEXT SUMMARY - 6 EARLIER TURNS]'));
        assert.ok(summary.includes('[END COMPACTED CONTEXT SUMMARY]'));
        assert.ok(summary.includes('Files/Contexts referenced earlier: `src/main.ts`, `src/utils.ts`'));
        assert.ok(summary.includes('User queried/instructed: "What does this function do?"'));
        assert.ok(summary.includes('Assistant addressed: Function Explanation; Return Value'));
        assert.ok(summary.includes('Assistant outcome: "Direct answer without headers...."'));
        assert.ok(summary.includes('...')); // truncation
    });

    it('compacts older turns deterministically when no provider is given', async () => {
        const history: ChatHistoryItem[] = [
            { role: 'user', text: 'Question 1' },
            { role: 'assistant', text: 'Answer 1' },
            { role: 'user', text: 'Question 2' },
            { role: 'assistant', text: 'Answer 2' },
            { role: 'user', text: 'Recent 1' },
            { role: 'assistant', text: 'Recent 2' },
            { role: 'user', text: 'Recent 3' },
            { role: 'assistant', text: 'Recent 4' }
        ];

        const result = await ContextCompactor.compactHistory(history);
        assert.strictEqual(result.compactedCount, 4);
        assert.strictEqual(result.remainingHistory.length, 4);
        assert.ok(result.summary.includes('[COMPACTED CONTEXT SUMMARY - 4 EARLIER TURNS]'));
        assert.ok(result.savedTokens >= 0);
    });

    it('uses active provider to generate AI-assisted context summary', async () => {
        const history: ChatHistoryItem[] = [
            { role: 'user', text: 'Question 1' },
            { role: 'assistant', text: 'Answer 1' },
            { role: 'user', text: 'Question 2' },
            { role: 'assistant', text: 'Answer 2' },
            { role: 'user', text: 'Recent 1' },
            { role: 'assistant', text: 'Recent 2' },
            { role: 'user', text: 'Recent 3' },
            { role: 'assistant', text: 'Recent 4' }
        ];

        const mockProvider = {
            async *streamChat(): AsyncGenerator<StreamChunk> {
                yield { text: '- AI condensed bullet point 1', done: false };
                yield { text: '\n- AI condensed bullet point 2', done: true };
            }
        } as unknown as BaseProvider;

        const result = await ContextCompactor.compactHistory(history, mockProvider, 'test-model');
        assert.strictEqual(result.compactedCount, 4);
        assert.ok(result.summary.includes('AI condensed bullet point 1'));
        assert.ok(result.summary.includes('[COMPACTED CONTEXT SUMMARY - 4 EARLIER TURNS]'));
    });

    it('falls back to deterministic compaction when AI provider throws error', async () => {
        const history: ChatHistoryItem[] = [
            { role: 'user', text: 'Goal: refactor codebase' },
            { role: 'assistant', text: 'Code refactored.' },
            { role: 'user', text: 'Goal: add unit tests' },
            { role: 'assistant', text: 'Unit tests added.' },
            { role: 'user', text: 'Recent 1' },
            { role: 'assistant', text: 'Recent 2' },
            { role: 'user', text: 'Recent 3' },
            { role: 'assistant', text: 'Recent 4' }
        ];

        const failingProvider = {
            // eslint-disable-next-line require-yield
            async *streamChat(): AsyncGenerator<StreamChunk> {
                throw new Error('API connection timeout');
            }
        } as unknown as BaseProvider;

        const result = await ContextCompactor.compactHistory(history, failingProvider, 'test-model');
        assert.strictEqual(result.compactedCount, 4);
        assert.ok(result.summary.includes('User queried/instructed: "Goal: refactor codebase"'));
    });

    it('falls back to deterministic compaction when AI provider returns empty summary', async () => {
        const history: ChatHistoryItem[] = [
            { role: 'user', text: 'Initial request' },
            { role: 'assistant', text: 'Initial response' },
            { role: 'user', text: 'Second request' },
            { role: 'assistant', text: 'Second response' },
            { role: 'user', text: 'Recent 1' },
            { role: 'assistant', text: 'Recent 2' },
            { role: 'user', text: 'Recent 3' },
            { role: 'assistant', text: 'Recent 4' }
        ];

        const emptyProvider = {
            async *streamChat(): AsyncGenerator<StreamChunk> {
                yield { text: '    ', done: true };
            }
        } as unknown as BaseProvider;

        const result = await ContextCompactor.compactHistory(history, emptyProvider, 'test-model');
        assert.strictEqual(result.compactedCount, 4);
        assert.ok(result.summary.includes('User queried/instructed: "Initial request"'));
    });
});
