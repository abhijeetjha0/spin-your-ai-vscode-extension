import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

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
        return [
            { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
        ];
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Anthropic API key not found'); }

        const baseUrl = this.getBaseUrl();
        
        const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
        }));

        const stream = HttpService.streamServerSentEvents(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: modelId,
                system: systemMessages || undefined,
                messages: userMessages,
                max_tokens: 4096,
                stream: true
            }),
            signal
        });

        for await (const data of stream) {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    yield { text: parsed.delta.text, done: false };
                } else if (parsed.type === 'message_stop') {
                    yield { text: '', done: true };
                }
            } catch (e) {
                // Ignore parse errors on malformed chunks
            }
        }
    }
}
