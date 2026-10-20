import * as assert from 'assert';
import { SubagentService, SubagentStatusPayload } from '../services/subagentService';
import { AgentToolService } from '../services/agentToolService';

describe('SubagentService', () => {
    beforeEach(() => {
        SubagentService.resetForTest();
    });

    afterEach(() => {
        SubagentService.resetForTest();
    });

    it('initializes with 0 active count and empty subagents list', () => {
        assert.strictEqual(SubagentService.getActiveCount(), 0);
        assert.deepStrictEqual(SubagentService.getSubagents(), []);
        assert.strictEqual(SubagentService.getSubagent('non-existent'), null);
    });

    it('validates required task argument', async () => {
        await assert.rejects(
            async () => {
                await SubagentService.spinSubagent({ task: '' });
            },
            /Sub-agent requires a task description/
        );

        await assert.rejects(
            async () => {
                await SubagentService.spinSubagent({ task: '   ' });
            },
            /Sub-agent requires a task description/
        );
    });

    it('spins a new subagent with streamChat provider', async () => {
        const events: SubagentStatusPayload[] = [];
        SubagentService.onStatusChange((event) => events.push(event));

        const mockProvider = {
            async *streamChat() {
                yield { text: 'Analyzing code structure... ', done: false };
                yield { text: 'Everything looks optimal.', done: true };
            }
        };

        const result = await SubagentService.spinSubagent({
            role: 'Code Quality Inspector',
            task: 'Inspect src/services architecture',
            context: 'TypeScript 5.3 codebase',
            provider: mockProvider,
            modelId: 'gpt-4o'
        });

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(result.role, 'Code Quality Inspector');
        assert.strictEqual(result.result, 'Analyzing code structure... Everything looks optimal.');
        assert.strictEqual(result.turns_completed, 1);
        assert.strictEqual(SubagentService.getActiveCount(), 0);

        const subagents = SubagentService.getSubagents();
        assert.strictEqual(subagents.length, 1);
        assert.strictEqual(subagents[0].id, result.subagent_id);
        assert.strictEqual(subagents[0].role, 'Code Quality Inspector');

        // Status events should record working state then completed state
        assert.ok(events.length >= 2);
        assert.strictEqual(events[0].activeCount, 1);
        assert.strictEqual(events[events.length - 1].activeCount, 0);
    });

    it('maintains context across multiple turns when resumed by subagentId', async () => {
        const mockProvider = {
            async *streamChat(messages: any[]) {
                const last = messages[messages.length - 1];
                yield { text: `Answer to ${last.content.includes('Second') ? 'Second Turn' : 'First Turn'}`, done: true };
            }
        };

        // Turn 1
        const res1 = await SubagentService.spinSubagent({
            role: 'Database Specialist',
            task: 'Design schema for sessions',
            provider: mockProvider
        });

        assert.strictEqual(res1.status, 'completed');
        const saId = res1.subagent_id;

        const subagent1 = SubagentService.getSubagent(saId);
        assert.ok(subagent1);
        // History: system, user turn 1, assistant turn 1
        assert.strictEqual(subagent1.history.length, 3);
        assert.strictEqual(subagent1.history[0].role, 'system');
        assert.strictEqual(subagent1.history[1].role, 'user');
        assert.strictEqual(subagent1.history[2].role, 'assistant');

        // Turn 2: Resume with subagentId
        const res2 = await SubagentService.spinSubagent({
            subagentId: saId,
            task: 'Second: Add indexing for performance',
            provider: mockProvider
        });

        assert.strictEqual(res2.subagent_id, saId);
        assert.strictEqual(res2.status, 'completed');
        assert.strictEqual(res2.turns_completed, 2);

        const subagent2 = SubagentService.getSubagent(saId);
        assert.ok(subagent2);
        // History now includes: system, user1, assistant1, user2, assistant2
        assert.strictEqual(subagent2.history.length, 5);
        assert.strictEqual(subagent2.history[3].role, 'user');
        assert.strictEqual(subagent2.history[4].role, 'assistant');
        assert.ok(subagent2.history[3].content.includes('Second: Add indexing'));
    });

    it('handles multimodal attachments and decodes base64 text files', async () => {
        let sentMessages: any[] = [];
        const mockProvider = {
            async *streamChat(messages: any[]) {
                sentMessages = messages;
                yield { text: 'Reviewed files.', done: true };
            }
        };

        const sampleCode = 'export const testVal = 42;';
        const base64Code = Buffer.from(sampleCode).toString('base64');

        const attachments = [
            { name: 'config.ts', type: 'text/typescript', data: base64Code },
            { name: 'architecture.png', type: 'image/png', data: 'fake_image_bytes' }
        ];

        const result = await SubagentService.spinSubagent({
            role: 'Multimodal Analyst',
            task: 'Review diagram and config',
            attachments,
            provider: mockProvider
        });

        assert.strictEqual(result.status, 'completed');
        assert.ok(sentMessages.length > 0);
        const userMsg = sentMessages.find(m => m.role === 'user');
        assert.ok(userMsg.content.includes('export const testVal = 42;'));
        assert.ok(userMsg.content.includes('architecture.png'));
    });

    it('terminates an actively working subagent', async () => {
        const mockProvider = {
            async *streamChat(_m: any, _id: any, signal?: AbortSignal) {
                yield { text: 'Starting...', done: false };
                await new Promise(r => setTimeout(r, 80));
                if (signal?.aborted) return;
                yield { text: 'Finished.', done: true };
            }
        };

        const spinPromise = SubagentService.spinSubagent({
            role: 'Long Running Agent',
            task: 'Run heavy simulation',
            provider: mockProvider
        });

        await new Promise(r => setTimeout(r, 10));
        assert.strictEqual(SubagentService.getActiveCount(), 1);

        const all = SubagentService.getSubagents();
        const subagentId = all[0].id;

        const didTerminate = SubagentService.terminateSubagent(subagentId);
        assert.strictEqual(didTerminate, true);

        const result = await spinPromise;
        assert.strictEqual(result.status, 'cancelled');
        assert.strictEqual(SubagentService.getActiveCount(), 0);
    });

    it('clears completed and cancelled subagents', async () => {
        await SubagentService.spinSubagent({ role: 'A1', task: 'Task 1' });
        await SubagentService.spinSubagent({ role: 'A2', task: 'Task 2' });

        assert.strictEqual(SubagentService.getSubagents().length, 2);

        SubagentService.clearSubagents();
        assert.strictEqual(SubagentService.getSubagents().length, 0);
    });

    it('handles provider streamChat exceptions safely', async () => {
        const failingProvider = {
            async *streamChat(): AsyncGenerator<any, void, unknown> {
                yield { text: 'Starting...', done: false };
                throw new Error('API Rate Limit Exceeded');
            }
        };

        const result = await SubagentService.spinSubagent({
            role: 'Failing Subagent',
            task: 'Query cloud API',
            provider: failingProvider
        });

        assert.strictEqual(result.status, 'failed');
        assert.strictEqual(result.error, 'API Rate Limit Exceeded');
        assert.strictEqual(SubagentService.getActiveCount(), 0);
    });

    it('executes spin_subagent through AgentToolService.executeTool', async () => {
        SubagentService.setActiveTurnContext({
            provider: {
                async *streamChat() {
                    yield { text: 'Workspace subtask done.', done: true };
                }
            },
            modelId: 'test-model'
        });

        const toolRes = await AgentToolService.executeTool('spin_subagent', {
            role: 'Workspace Specialist',
            task: 'Search test configurations'
        });

        assert.strictEqual(toolRes.status, 'completed');
        assert.strictEqual(toolRes.role, 'Workspace Specialist');
        assert.strictEqual(toolRes.result, 'Workspace subtask done.');
    });

    it('blocks nested recursive subagent creation (leaf recursion guard)', async () => {
        let nestedToolResult: any;

        const recursiveProvider = {
            async *streamChat() {
                // Attempt to spin a nested sub-agent while inside a sub-agent
                nestedToolResult = await AgentToolService.executeTool('spin_subagent', {
                    role: 'Nested Subagent',
                    task: 'Should be blocked'
                });
                yield { text: 'Attempted recursion.', done: true };
            }
        };

        const result = await SubagentService.spinSubagent({
            role: 'Parent Subagent',
            task: 'Try to recurse',
            provider: recursiveProvider
        });

        assert.strictEqual(result.status, 'completed');
        assert.ok(nestedToolResult);
        assert.ok(nestedToolResult.error);
        assert.ok(nestedToolResult.error.includes('Sub-agents are leaf agents'));
        assert.strictEqual(SubagentService.isInsideSubagent(), false);
    });

    it('enforces MAX_SUBAGENTS_PER_TURN limit', async () => {
        SubagentService.setActiveTurnContext({
            provider: {
                async *streamChat() {
                    yield { text: 'Done', done: true };
                }
            }
        });

        SubagentService.resetTurnSubagentCount();

        // Spin up to the limit (5)
        for (let i = 0; i < SubagentService.MAX_SUBAGENTS_PER_TURN; i++) {
            const res = await AgentToolService.executeTool('spin_subagent', {
                role: `Worker ${i + 1}`,
                task: `Task ${i + 1}`
            });
            assert.strictEqual(res.status, 'completed');
        }

        assert.strictEqual(SubagentService.getTurnSubagentCount(), SubagentService.MAX_SUBAGENTS_PER_TURN);

        // 6th attempt should be blocked
        const overLimitRes = await AgentToolService.executeTool('spin_subagent', {
            role: 'Worker 6',
            task: 'Task 6'
        });

        assert.ok(overLimitRes.error);
        assert.ok(overLimitRes.error.includes('Turn sub-agent limit reached'));

        // Reset turn count enables spinning again
        SubagentService.resetTurnSubagentCount();
        assert.strictEqual(SubagentService.getTurnSubagentCount(), 0);
        const afterResetRes = await AgentToolService.executeTool('spin_subagent', {
            role: 'Worker 1 Again',
            task: 'Task 1 Again'
        });
        assert.strictEqual(afterResetRes.status, 'completed');
    });

    it('inherits defaultContext when context is not explicitly passed', async () => {
        SubagentService.setActiveTurnContext({
            provider: {
                async *streamChat() {
                    yield { text: 'Context verified', done: true };
                }
            },
            defaultContext: 'ACTIVE_FILE_CONTENT_INHERITED'
        });

        const res = await SubagentService.spinSubagent({
            role: 'Context Inspector',
            task: 'Analyze active file'
        });

        assert.strictEqual(res.status, 'completed');
        const sa = SubagentService.getSubagent(res.subagent_id);
        assert.ok(sa);
        const systemTurn = sa.history.find(h => h.role === 'system');
        const userTurn = sa.history.find(h => h.role === 'user');
        assert.ok(systemTurn?.content.includes('ACTIVE_FILE_CONTENT_INHERITED'));
        assert.ok(userTurn?.content.includes('ACTIVE_FILE_CONTENT_INHERITED'));
    });

    it('filters out spin_subagent from tool definitions when isSubagent is true', () => {
        const fullTools = AgentToolService.getToolDefinitions({ isSubagent: false });
        const hasSubagentTool = fullTools.some(t => t.function.name === 'spin_subagent');
        assert.strictEqual(hasSubagentTool, true);

        const subagentTools = AgentToolService.getToolDefinitions({ isSubagent: true });
        const hasSubagentToolFiltered = subagentTools.some(t => t.function.name === 'spin_subagent');
        assert.strictEqual(hasSubagentToolFiltered, false);
    });

    it('truncates large inherited context to 12000 chars for token efficiency', async () => {
        const massiveContext = 'A'.repeat(25000);
        SubagentService.setActiveTurnContext({
            provider: {
                async *streamChat() {
                    yield { text: 'Processed', done: true };
                }
            },
            defaultContext: massiveContext
        });

        const res = await SubagentService.spinSubagent({
            role: 'Token Efficient Subagent',
            task: 'Analyze massive context'
        });

        assert.strictEqual(res.status, 'completed');
        const sa = SubagentService.getSubagent(res.subagent_id);
        assert.ok(sa);
        const systemTurn = sa.history.find(h => h.role === 'system');
        assert.ok(systemTurn);
        assert.ok(systemTurn.content.includes('[Context truncated for sub-agent token efficiency]'));
        assert.ok(systemTurn.content.length < 20000);
    });

    it('falls back to activeTextEditor when inheritedContext is empty', async () => {
        (global as any).__vscodeMockState.activeTextEditor = {
            document: {
                fileName: '/mock/workspace/activeFile.ts',
                getText: () => 'const hello = "world";'
            }
        };

        const res = await SubagentService.spinSubagent({
            role: 'Editor Inspector',
            task: 'Inspect active file'
        });

        assert.strictEqual(res.status, 'completed');
        const sa = SubagentService.getSubagent(res.subagent_id);
        assert.ok(sa);
        const systemTurn = sa.history.find(h => h.role === 'system');
        assert.ok(systemTurn?.content.includes('--- Active File: /mock/workspace/activeFile.ts ---'));
        assert.ok(systemTurn?.content.includes('const hello = "world";'));

        // Cleanup mock
        (global as any).__vscodeMockState.activeTextEditor = undefined;
    });

    it('terminates all active subagents when terminateAllActive is called', async () => {
        let hangAbortSignal: AbortSignal | undefined;
        const hangingProvider = {
            async *streamChat(_messages: any[], _modelId: string, signal?: AbortSignal) {
                hangAbortSignal = signal;
                // Wait indefinitely until signal aborts
                while (!signal?.aborted) {
                    await new Promise(r => setTimeout(r, 20));
                }
                yield { text: 'Aborted', done: true };
            }
        };

        // Start 2 long-running subagents
        const p1 = SubagentService.spinSubagent({ role: 'Worker 1', task: 'Task 1', provider: hangingProvider });
        const p2 = SubagentService.spinSubagent({ role: 'Worker 2', task: 'Task 2', provider: hangingProvider });

        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(SubagentService.getActiveCount(), 2);

        // Terminate all active
        const terminatedCount = SubagentService.terminateAllActive();
        assert.strictEqual(terminatedCount, 2);
        assert.strictEqual(SubagentService.getActiveCount(), 0);

        await Promise.all([p1, p2]);
        assert.strictEqual(hangAbortSignal?.aborted, true);
    });
});
