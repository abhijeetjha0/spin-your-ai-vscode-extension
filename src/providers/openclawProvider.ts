import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class OpenClawProvider extends BaseProvider {
    constructor() {
        super({
            id: 'openclaw',
            name: 'OpenClaw',
            type: 'local',
            baseUrl: 'http://localhost:3141',
            apiKeyRequired: false
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/health`);
        
        if (!response.ok) { throw new Error(`OpenClaw not running at ${baseUrl}`); }
        
        return [{ id: 'agent', name: 'OpenClaw Agent' }];
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const baseUrl = this.getBaseUrl();
        const prompt = messages[messages.length - 1].content;

        const response = await HttpService.fetch(`${baseUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt }),
            signal
        });

        if (!response.ok) { throw new Error(`OpenClaw error: ${response.statusText}`); }
        
        const text = await response.text();
        yield { text, done: true };
    }
}
