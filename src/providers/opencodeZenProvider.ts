import { OpenAIProvider } from './openaiProvider';
import { ModelInfo } from '../types';
import { HttpService } from '../utils/http';

export class OpenCodeZenProvider extends OpenAIProvider {
    constructor() {
        super({
            id: 'opencodeZen',
            name: 'OpenCode Zen',
            type: 'cloud',
            baseUrl: 'https://opencode.ai/zen/v1',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return [];
        }

        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json() as any;
            return data.data.map((m: any) => ({
                id: m.id,
                name: m.id
            }));
        } catch {
            return [];
        }
    }
}
