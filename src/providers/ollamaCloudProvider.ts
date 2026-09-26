import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class OllamaCloudProvider extends BaseProvider {
    constructor() {
        super({
            id: 'ollamaCloud',
            name: 'Ollama Cloud',
            type: 'cloud',
            baseUrl: 'https://ollama.com/v1',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { return []; }

        try {
            const response = await HttpService.fetch(`${this.config.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) { return []; }
            
            const data = await response.json() as any;
            if (Array.isArray(data.data) && data.data.length > 0) {
                return data.data.map((m: any) => ({
                    id: m.id,
                    name: m.id
                }));
            }
            return [];
        } catch {
            return [];
        }
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Ollama Cloud API key not found'); }

        const stream = HttpService.streamServerSentEvents(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: messages,
                stream: true
            }),
            signal
        });

        for await (const data of stream) {
            try {
                const parsed = JSON.parse(data);
                const text = parsed.choices?.[0]?.delta?.content || '';
                yield { text, done: false };
            } catch (e) {
                // Ignore parse errors on malformed chunks
            }
        }
        yield { text: '', done: true };
    }
}
