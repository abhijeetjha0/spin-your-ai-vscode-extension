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
        if (this.config.type === 'cloud' || this.config.type === 'aggregator') {
            return this.config.baseUrl || '';
        }
        const customUrl = ConfigService.get<string>(`${this.config.id}.baseUrl`);
        return customUrl || this.config.baseUrl || '';
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
