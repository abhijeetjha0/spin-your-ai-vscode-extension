import { OpenAIProvider } from './openaiProvider';
import { ModelInfo } from '../types';
import { HttpService } from '../utils/http';

export class HuggingFaceProvider extends OpenAIProvider {
    constructor() {
        super();
        (this as any).config = {
            id: 'huggingface',
            name: 'Hugging Face',
            type: 'cloud',
            baseUrl: 'https://api-inference.huggingface.co/v1',
            apiKeyRequired: true
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { return []; }

        try {
            const response = await HttpService.fetch(`https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=20`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) { return []; }
            
            const data = await response.json() as any[];
            if (Array.isArray(data) && data.length > 0) {
                return data.map((m: any) => ({
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
