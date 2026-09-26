import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';

export class OllamaProvider extends BaseProvider {
    constructor() {
        super({
            id: 'ollama',
            name: 'Ollama',
            type: 'local',
            baseUrl: 'http://localhost:11434',
            apiKeyRequired: false
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as any;
            return (data.models || []).map((m: any) => ({
                id: m.name,
                name: m.name
            }));
        } catch {
            return [];
        }
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
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

            const response = await HttpService.fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal
            });

            if (!response.ok) {
                throw new Error(`Ollama chat error: ${response.statusText}`);
            }

            if (!response.body) { throw new Error('No response body'); }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const toolCalls: any[] = [];
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) { break; }
                    
                    const chunkStr = decoder.decode(value, { stream: true });
                    const lines = chunkStr.split('\n').filter(l => l.trim().length > 0);
                    
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.message?.content) {
                                yield {
                                    text: data.message.content,
                                    done: false
                                };
                            }
                            if (data.message?.tool_calls) {
                                toolCalls.push(...data.message.tool_calls);
                            }
                        } catch (e) {
                            // Ignore parse errors for partial chunks
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            if (toolCalls.length > 0) {
                currentMessages.push({
                    role: 'assistant',
                    content: '',
                    tool_calls: toolCalls
                });

                for (const tc of toolCalls) {
                    const fnName = tc.function?.name;
                    yield { text: `\n\n> ⚙️ *Executing MCP tool \`${fnName}\`...*\n\n`, done: false };

                    let result: any;
                    try {
                        result = await McpService.executeTool(fnName, tc.function?.arguments || {});
                    } catch (err: any) {
                        result = `Error: ${err.message}`;
                    }

                    currentMessages.push({
                        role: 'tool',
                        content: typeof result === 'string' ? result : JSON.stringify(result)
                    });
                }
                continue;
            }

            break;
        }

        yield { text: '', done: true };
    }
}
