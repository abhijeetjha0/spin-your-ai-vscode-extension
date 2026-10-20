import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';
import { SubagentService } from '../services/subagentService';
import { ToolCacheService } from '../services/toolCacheService';

export class OpenRouterProvider extends BaseProvider {
    constructor() {
        super({
            id: 'openrouter',
            name: 'OpenRouter',
            type: 'aggregator',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKeyRequired: true,
            supportsTools: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return [];
        }

        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://github.com/abhijeetjha0/spin-your-ai-vscode-extension',
                    'X-Title': 'Spin Your AI VSCode'
                }
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json() as any;
            return data.data
                .map((m: any) => ({
                    id: m.id,
                    name: m.name || m.id
                }));
        } catch {
            return [];
        }
    }

    async *streamChat(
        messages: Message[], 
        modelId: string, 
        signal?: AbortSignal, 
        options?: { isSubagent?: boolean; maxToolTurns?: number }
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('OpenRouter API key not found'); }

        const baseUrl = this.getBaseUrl();
        const isSubagent = !!options?.isSubagent || SubagentService.isInsideSubagent();
        const allTools = await McpService.getActiveTools({ isSubagent });
        const maxToolTurns = options?.maxToolTurns ?? (isSubagent ? 12 : 35);
        const currentMessages: any[] = [...messages];
        let toolCallCount = 0;
        let totalGeneratedContent = 0;

        while (true) {
            const canSpin = !isSubagent && SubagentService.getTurnSubagentCount() < SubagentService.MAX_SUBAGENTS_PER_TURN;
            const turnTools = canSpin ? allTools : allTools.filter(t => t.function.name !== 'spin_subagent');

            const payload: any = {
                model: modelId,
                messages: currentMessages,
                stream: true
            };

            if (turnTools.length > 0) {
                payload.tools = turnTools;
            }

            const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/abhijeetjha0/spin-your-ai-vscode-extension',
                    'X-Title': 'Spin Your AI VSCode'
                },
                body: JSON.stringify(payload),
                signal
            });

            const toolCallsBuffer: Record<number, any> = {};

            for await (const data of stream) {
                let parsed: any;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    // Ignore parse errors on malformed chunks
                    continue;
                }

                if (parsed.error) {
                    const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
                    throw new Error(errMsg);
                }

                const delta = parsed.choices?.[0]?.delta;
                if (delta?.content) {
                    totalGeneratedContent += delta.content.length;
                    yield { text: delta.content, done: false };
                }
                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (!toolCallsBuffer[tc.index]) {
                            toolCallsBuffer[tc.index] = {
                                id: tc.id || `call_${Date.now()}_${tc.index}`,
                                type: 'function',
                                function: { name: tc.function?.name || '', arguments: '' }
                            };
                        } else if (tc.id && !toolCallsBuffer[tc.index].id) {
                            toolCallsBuffer[tc.index].id = tc.id;
                        }
                        if (tc.function?.arguments) {
                            toolCallsBuffer[tc.index].function.arguments += tc.function.arguments;
                        }
                    }
                }
            }

            const toolCalls = Object.values(toolCallsBuffer);
            if (toolCalls.length > 0) {
                toolCallCount++;
                if (toolCallCount > maxToolTurns) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#f59e0b">warning</span> *Reached sequential tool call safety limit (${maxToolTurns} turns). Stopping autonomous loop.*`, done: false };
                    break;
                }

                currentMessages.push({
                    role: 'assistant',
                    tool_calls: toolCalls,
                    content: null
                });

                for (const tc of toolCalls) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#a78bfa">settings</span> *Executing tool \`${tc.function.name}\`...*\n\n`, done: false };
                }

                const toolResults = await Promise.all(
                    toolCalls.map(async (tc) => {
                        const toolName = tc.function.name;
                        try {
                            const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                            const result = await McpService.executeTool(toolName, args);
                            let contentStr = typeof result === 'string' ? result : JSON.stringify(result);
                            contentStr = ToolCacheService.smartTruncate(contentStr, 8000);
                            return {
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: contentStr
                            };
                        } catch (err: any) {
                            return {
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: `Error executing tool: ${err.message}`
                            };
                        }
                    })
                );

                for (const tr of toolResults) {
                    currentMessages.push(tr);
                }

                // Continue loop
                continue;
            }

            break;
        }

        if (toolCallCount > 0 && totalGeneratedContent === 0) {
            yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#94a3b8">info</span> *Completed ${toolCallCount} tool execution(s). Model finished without additional commentary.*`, done: false };
        }

        yield { text: '', done: true };
    }
}
