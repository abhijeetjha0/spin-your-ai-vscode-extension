import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class OpenAIProvider extends BaseProvider {
    constructor() {
        super({
            id: 'openai',
            name: 'OpenAI',
            type: 'cloud',
            baseUrl: 'https://api.openai.com/v1',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('OpenAI API key not found'); }

        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        if (!response.ok) { throw new Error(`OpenAI error: ${response.statusText}`); }
        
        const data = await response.json() as any;
        return data.data
            .filter((m: any) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3'))
            .map((m: any) => ({
                id: m.id,
                name: m.id
            }));
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('OpenAI API key not found'); }

        const baseUrl = this.getBaseUrl();
        const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/completions`, {
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
