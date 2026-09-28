import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { ConfigService } from '../services/configService';

export class OpenCodeProvider extends BaseProvider {
    constructor() {
        super({
            id: 'opencode',
            name: 'OpenCode',
            type: 'local',
            baseUrl: 'http://localhost:3000',
            apiKeyRequired: true
        });
    }

    private async getAuthHeader(): Promise<string | null> {
        const password = await this.getApiKey();
        const username = ConfigService.get<string>('opencode.username');
        if (!username || !password) return null;
        return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    async listModels(): Promise<ModelInfo[]> {
        const baseUrl = this.getBaseUrl();
        const headers: Record<string, string> = {};
        const authHeader = await this.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;

        const response = await HttpService.fetch(`${baseUrl}/api/model`, { headers });
        if (!response.ok) { 
            throw new Error(`HTTP ${response.status}: ${response.statusText}`); 
        }
        
        const data = await response.json();
        const models = data?.data || [];
        
        if (models.length === 0) {
            return [{ id: 'default', name: 'OpenCode Default Model' }];
        }

        return models.map((m: any) => ({
            id: `${m.providerID}::${m.id}`,
            name: `${m.providerID} / ${m.id}`
        }));
    }

    async *streamChat(messages: Message[], _modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const baseUrl = this.getBaseUrl();
        
        let fullPrompt = '';
        const systemMsg = messages.find(m => m.role === 'system');
        if (systemMsg) {
            fullPrompt += systemMsg.content + '\n\n---\n\n';
        }
        const userMsg = messages.filter(m => m.role === 'user').pop();
        fullPrompt += userMsg ? userMsg.content : '';

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const authHeader = await this.getAuthHeader();
        if (authHeader) headers['Authorization'] = authHeader;

        let modelRef = null;
        try {
            if (_modelId && _modelId !== 'default') {
                const parts = _modelId.split('::');
                if (parts.length === 2) {
                    modelRef = { providerID: parts[0], id: parts[1] };
                }
            }
        } catch {
            // ignore
        }

        const response = await HttpService.fetch(`${baseUrl}/api/experimental/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
                prompt: fullPrompt,
                ...(modelRef && { model: modelRef })
            }),
            signal
        });

        if (!response.ok) { 
            const errorText = await response.text().catch(() => '');
            throw new Error(`OpenCode error: ${response.statusText} ${errorText}`); 
        }
        
        const data = await response.json();
        const text = data?.data?.text || '';
        yield { text, done: true };
    }
}
