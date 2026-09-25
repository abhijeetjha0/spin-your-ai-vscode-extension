import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';

export class OpenCodeProvider extends BaseProvider {
    constructor() {
        super({
            id: 'opencode',
            name: 'OpenCode',
            type: 'cloud',
            baseUrl: 'http://localhost:3000',
            apiKeyRequired: false
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const baseUrl = this.getBaseUrl();
        const response = await HttpService.fetch(`${baseUrl}/api/health`);
        
        if (!response.ok) { throw new Error(`OpenCode not running at ${baseUrl}`); }
        
        return [{ id: 'opencode-default', name: 'OpenCode Session' }];
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const baseUrl = this.getBaseUrl();
        
        let fullPrompt = '';
        const systemMsg = messages.find(m => m.role === 'system');
        if (systemMsg) {
            fullPrompt += systemMsg.content + '\n\n---\n\n';
        }
        const userMsg = messages.filter(m => m.role === 'user').pop();
        fullPrompt += userMsg ? userMsg.content : '';

        const response = await HttpService.fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: fullPrompt }),
            signal
        });

        if (!response.ok) { throw new Error(`OpenCode error: ${response.statusText}`); }
        
        const text = await response.text();
        yield { text, done: true };
    }
}
