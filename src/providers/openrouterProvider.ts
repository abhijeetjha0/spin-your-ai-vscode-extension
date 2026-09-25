import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

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
        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/models`);
        if (!response.ok) { throw new Error(`OpenRouter error: ${response.statusText}`); }
        
        const data = await response.json() as any;
        return data.data.map((m: any) => ({
            id: m.id,
            name: m.name
        }));
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('OpenRouter API key not found'); }

        const baseUrl = this.getBaseUrl();
        const stream = HttpService.streamServerSentEvents(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/abhijeetjha0/spin-your-ai-vscode',
                'X-Title': 'Spin Your AI VSCode'
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
