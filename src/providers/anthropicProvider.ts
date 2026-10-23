import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';
import { SubagentService } from '../services/subagentService';
import { CacheMetricsService } from '../services/cacheMetricsService';
import { ToolCacheService } from '../services/toolCacheService';

export class AnthropicProvider extends BaseProvider {
    constructor() {
        super({
            id: 'anthropic',
            name: 'Anthropic',
            type: 'cloud',
            baseUrl: 'https://api.anthropic.com/v1',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { return []; }

        return [
            { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
        ];
    }

    async *streamChat(
        messages: Message[], 
        modelId: string, 
        signal?: AbortSignal, 
        options?: { isSubagent?: boolean; maxToolTurns?: number }
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Anthropic API key not found'); }

        const baseUrl = this.getBaseUrl();
        const isSubagent = !!options?.isSubagent || SubagentService.isInsideSubagent();
        const allTools = await McpService.getActiveTools({ isSubagent });
        const maxToolTurns = options?.maxToolTurns ?? (isSubagent ? 12 : 35);
        
        const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const currentMessages: any[] = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
        }));
        let toolCallCount = 0;
        let totalGeneratedContent = 0;
        let rawUsage: any = {};
        const startTime = Date.now();

        while (true) {
            const canSpin = !isSubagent && SubagentService.getTurnSubagentCount() < SubagentService.MAX_SUBAGENTS_PER_TURN;
            const turnTools = (canSpin ? allTools : allTools.filter(t => t.function.name !== 'spin_subagent'))
                .sort((a, b) => a.function.name.localeCompare(b.function.name));

            const body: any = {
                model: modelId,
                messages: currentMessages,
                max_tokens: 4096,
                stream: true
            };

            if (systemMessages) {
                body.system = [
                    {
                        type: 'text',
                        text: systemMessages,
                        cache_control: { type: 'ephemeral' }
                    }
                ];
            }

            if (turnTools.length > 0) {
                body.tools = turnTools.map((t, idx) => {
                    const toolObj: any = {
                        name: t.function.name,
                        description: t.function.description || 'Tool',
                        input_schema: t.function.parameters || { type: 'object', properties: {} }
                    };
                    // Tag the last tool definition to cache all tools
                    if (idx === turnTools.length - 1) {
                        toolObj.cache_control = { type: 'ephemeral' };
                    }
                    return toolObj;
                });
            }

            const stream = HttpService.streamServerSentEvents(`${baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(body),
                signal
            });

            const toolCalls: Record<number, { id: string; name: string; inputJson: string }> = {};
            let currentBlockIndex = -1;

            for await (const data of stream) {
                let parsed: any;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    // Ignore parse errors on malformed chunks
                    continue;
                }

                if (parsed.type === 'error' || parsed.error) {
                    const err = parsed.error || parsed;
                    const errMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
                    throw new Error(errMsg);
                }

                if (parsed.type === 'message_start' && parsed.message?.usage) {
                    rawUsage = { ...rawUsage, ...parsed.message.usage };
                } else if (parsed.type === 'message_delta' && parsed.usage) {
                    rawUsage = { ...rawUsage, ...parsed.usage };
                }

                if (parsed.type === 'content_block_start') {
                    currentBlockIndex = parsed.index;
                    if (parsed.content_block?.type === 'tool_use') {
                        toolCalls[currentBlockIndex] = {
                            id: parsed.content_block.id,
                            name: parsed.content_block.name,
                            inputJson: ''
                        };
                    }
                } else if (parsed.type === 'content_block_delta') {
                    if (parsed.delta?.text) {
                        totalGeneratedContent += parsed.delta.text.length;
                        yield { text: parsed.delta.text, done: false };
                    } else if (parsed.delta?.partial_json && toolCalls[currentBlockIndex]) {
                        toolCalls[currentBlockIndex].inputJson += parsed.delta.partial_json;
                    }
                }
            }

            const toolCallList = Object.values(toolCalls);
            if (toolCallList.length > 0) {
                toolCallCount++;
                if (toolCallCount > maxToolTurns) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#f59e0b">warning</span> *Reached sequential tool call safety limit (${maxToolTurns} turns). Stopping autonomous loop.*`, done: false };
                    break;
                }

                const assistantContent: any[] = [];

                for (const tc of toolCallList) {
                    assistantContent.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.inputJson ? JSON.parse(tc.inputJson) : {}
                    });

                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#a78bfa">settings</span> *Executing tool \`${tc.name}\`...*\n\n`, done: false };
                }

                const toolResults = await Promise.all(
                    toolCallList.map(async (tc) => {
                        let result: any;
                        try {
                            const args = tc.inputJson ? JSON.parse(tc.inputJson) : {};
                            result = await McpService.executeTool(tc.name, args);
                        } catch (err: any) {
                            result = `Error: ${err.message}`;
                        }

                        let contentStr = typeof result === 'string' ? result : JSON.stringify(result);
                        contentStr = ToolCacheService.smartTruncate(contentStr, 8000);

                        return {
                            type: 'tool_result',
                            tool_use_id: tc.id,
                            content: contentStr
                        };
                    })
                );

                currentMessages.push({
                    role: 'assistant',
                    content: assistantContent
                });

                currentMessages.push({
                    role: 'user',
                    content: toolResults
                });

                continue;
            }

            break;
        }

        if (toolCallCount > 0 && totalGeneratedContent === 0) {
            yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#94a3b8">info</span> *Completed ${toolCallCount} tool execution(s). Model finished without additional commentary.*`, done: false };
        }
        
        const durationMs = Date.now() - startTime;
        const normalizedUsage = CacheMetricsService.normalizeUsage(rawUsage, 'anthropic', durationMs);
        yield { text: '', done: true, usage: normalizedUsage };
    }
}
