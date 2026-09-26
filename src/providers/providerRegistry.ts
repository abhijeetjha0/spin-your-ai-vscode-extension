import { BaseProvider } from './baseProvider';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GeminiProvider } from './geminiProvider';
import { OpenRouterProvider } from './openrouterProvider';
import { HuggingFaceProvider } from './huggingfaceProvider';
import { OllamaCloudProvider } from './ollamaCloudProvider';
import { OpenCodeProvider } from './opencodeProvider';
import { HermesProvider } from './hermesProvider';
import { OpenClawProvider } from './openclawProvider';
import { ProviderConfig } from '../types';

export class ProviderRegistry {
    private static providers: Map<string, BaseProvider> = new Map();

    public static initialize() {
        this.register(new OllamaProvider());
        this.register(new OpenAIProvider());
        this.register(new AnthropicProvider());
        this.register(new GeminiProvider());
        this.register(new OpenRouterProvider());
        this.register(new HuggingFaceProvider());
        this.register(new OllamaCloudProvider());
        this.register(new OpenCodeProvider());
        this.register(new HermesProvider());
        this.register(new OpenClawProvider());
    }

    public static register(provider: BaseProvider) {
        this.providers.set(provider.config.id, provider);
    }

    public static getProvider(id: string): BaseProvider | undefined {
        return this.providers.get(id);
    }

    public static getAllProviders(): ProviderConfig[] {
        return Array.from(this.providers.values()).map(p => p.config);
    }
}
