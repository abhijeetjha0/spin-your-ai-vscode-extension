import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';

export class OpenRouterProvider extends BaseProvider {
    constructor() {
        super({
            id: 'openrouter',
            name: 'OpenRouter',
            type: 'aggregator',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKeyRequired: true
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
                    'HTTP-Referer': 'https://github.com/abhijeetjha0/spin-your-ai-vscode',
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

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('OpenRouter API key not found'); }

        const baseUrl = this.getBaseUrl();
        const tools = await McpService.getActiveTools();
        const currentMessages: any[] = [...messages];

        while (true) {
            const payload: any = {
                model: modelId,
                messages: currentMessages,
                stream: true
            };

            if (tools.length > 0) {
                payload.tools = tools;
            }

            const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/abhijeetjha0/spin-your-ai-vscode',
                    'X-Title': 'Spin Your AI VSCode'
                },
                body: JSON.stringify(payload),
                signal
            });

            const toolCallsBuffer: Record<number, any> = {};

            for await (const data of stream) {
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    if (delta?.content) {
                        yield { text: delta.content, done: false };
                    }
                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            if (!toolCallsBuffer[tc.index]) {
                                toolCallsBuffer[tc.index] = {
                                    id: tc.id,
                                    type: 'function',
                                    function: { name: tc.function?.name || '', arguments: '' }
                                };
                            }
                            if (tc.function?.arguments) {
                                toolCallsBuffer[tc.index].function.arguments += tc.function.arguments;
                            }
                        }
                    }
                } catch (e) {
                    // Ignore parse errors on malformed chunks
                }
            }

            const toolCalls = Object.values(toolCallsBuffer);
            if (toolCalls.length > 0) {
                currentMessages.push({
                    role: 'assistant',
                    tool_calls: toolCalls,
                    content: null
                });

                for (const tc of toolCalls) {
                    const toolName = tc.function.name;
                    yield { text: `\n\n> ⚙️ *Executing MCP tool \`${toolName}\`...*\n\n`, done: false };

                    try {
                        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                        const result = await McpService.executeTool(toolName, args);
                        currentMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: typeof result === 'string' ? result : JSON.stringify(result)
                        });
                    } catch (err: any) {
                        currentMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: `Error executing tool: ${err.message}`
                        });
                    }
                }

                // Continue loop
                continue;
            }

            break;
        }

        yield { text: '', done: true };
    }
}
