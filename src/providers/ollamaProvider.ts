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
        const currentMessages: any[] = [...messages];

        while (true) {
            const payload: any = {
                model: modelId,
                messages: currentMessages,
                stream: true
            };

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
                        } catch (e) {
                            // Ignore parse errors for partial chunks
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            break;
        }

        yield { text: '', done: true };
    }
}
