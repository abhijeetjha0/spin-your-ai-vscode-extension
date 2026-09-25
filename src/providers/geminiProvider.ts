import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class GeminiProvider extends BaseProvider {
    constructor() {
        super({
            id: 'gemini',
            name: 'Google Gemini',
            type: 'cloud',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Gemini API key not found'); }

        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/models?key=${apiKey}`);
        if (!response.ok) { throw new Error(`Gemini error: ${response.statusText}`); }
        
        const data = await response.json() as any;
        return data.models
            .filter((m: any) => m.name.includes('gemini') && m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => ({
                id: m.name.replace('models/', ''),
                name: m.displayName || m.name
            }));
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Gemini API key not found'); }

        const baseUrl = this.getBaseUrl();
        
        const contents = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        
        const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        
        const body: any = { contents };
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const stream = HttpService.streamServerSentEvents(`${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        });

        for await (const data of stream) {
            try {
                const parsed = JSON.parse(data);
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                yield { text, done: false };
            } catch (e) {
                // Ignore parse errors
            }
        }
        yield { text: '', done: true };
    }
}
