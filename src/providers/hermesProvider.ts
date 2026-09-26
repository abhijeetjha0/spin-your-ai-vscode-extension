import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class HermesProvider extends BaseProvider {
    constructor() {
        super({
            id: 'hermes',
            name: 'Hermes',
            type: 'local',
            baseUrl: 'http://localhost:8642/v1',
            apiKeyRequired: false
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': 'Bearer dummy-key' }
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
        const baseUrl = this.getBaseUrl();
        const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer dummy-key',
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
