import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class MCPProvider extends BaseProvider {
    constructor() {
        super({
            id: 'mcp',
            name: 'MCP (Local HTTP)',
            type: 'mcp',
            baseUrl: 'http://localhost:3000',
            apiKeyRequired: false
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/models`);
        if (!response.ok) { throw new Error(`MCP error: ${response.statusText}`); }
        
        const data = await response.json() as any;
        return data.models.map((m: any) => ({
            id: m.id,
            name: m.name
        }));
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const baseUrl = this.getBaseUrl();
        const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                messages: messages
            }),
            signal
        });

        for await (const data of stream) {
            try {
                const parsed = JSON.parse(data);
                if (parsed.text !== undefined) {
                    yield { text: parsed.text, done: parsed.done || false };
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
}
