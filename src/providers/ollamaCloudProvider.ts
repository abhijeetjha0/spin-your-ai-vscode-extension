import { OpenAIProvider } from './openaiProvider';
import { ModelInfo } from '../types';
import { HttpService } from '../utils/http';

export class OllamaCloudProvider extends OpenAIProvider {
    constructor() {
        super();
        (this as any).config = {
            id: 'ollamaCloud',
            name: 'Ollama Cloud',
            type: 'cloud',
            baseUrl: 'https://ollama.com/v1',
            apiKeyRequired: true
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { return []; }

        try {
            const response = await HttpService.fetch(`${this.config.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
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
}
