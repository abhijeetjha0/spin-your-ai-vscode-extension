import { OpenAIProvider } from './openaiProvider';
import { ModelInfo } from '../types';
import { HttpService } from '../utils/http';

export class HermesProvider extends OpenAIProvider {
    constructor() {
        super();
        (this as any).config = {
            id: 'hermes',
            name: 'Hermes',
            type: 'local',
            baseUrl: 'http://localhost:8642/v1',
            apiKeyRequired: false
        };
    }

    async listModels(): Promise<ModelInfo[]> {
        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': 'Bearer dummy-key' }
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
