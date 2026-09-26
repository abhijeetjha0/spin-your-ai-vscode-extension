import { OpenAIProvider } from './openaiProvider';
import { ModelInfo } from '../types';
import { HttpService } from '../utils/http';

export class OllamaProvider extends OpenAIProvider {
    constructor() {
        super();
        (this as any).config = {
            id: 'ollama',
            name: 'Ollama',
            type: 'local',
            baseUrl: 'http://localhost:11434/v1',
            apiKeyRequired: false
        };
    }

    protected getBaseUrl(): string {
        const url = super.getBaseUrl();
        return url.endsWith('/v1') ? url : `${url.replace(/\/$/, '')}/v1`;
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const baseUrl = this.getBaseUrl().replace(/\/v1\/?$/, '');
            const response = await HttpService.fetch(`${baseUrl}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as any;
            return (data.models || []).map((m: any) => ({
                id: m.name,
                name: m.name
            }));
        } catch {
            return [];
        }
    }
}
