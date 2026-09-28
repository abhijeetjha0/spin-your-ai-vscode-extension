import { Message, ModelInfo, ProviderConfig, StreamChunk } from '../types';
import { VaultService } from '../services/vault';
import { ConfigService } from '../services/configService';

export abstract class BaseProvider {
    constructor(public readonly config: ProviderConfig) {}

    protected async getApiKey(): Promise<string | undefined> {
        if (!this.config.apiKeyRequired) { return undefined; }
        return VaultService.getKey(this.config.id);
    }

    protected getBaseUrl(): string {
        let url = '';
        if (this.config.type === 'cloud' || this.config.type === 'aggregator') {
            url = this.config.baseUrl || '';
        } else {
            const customUrl = ConfigService.get<string>(`${this.config.id}.baseUrl`);
            url = customUrl || this.config.baseUrl || '';
        }
        return url.replace(/\/+$/, '');
    }

    abstract listModels(): Promise<ModelInfo[]>;
    abstract streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown>;
    
    public async ping(): Promise<boolean> {
        try {
            await this.listModels();
            return true;
        } catch {
            return false;
        }
    }
}
