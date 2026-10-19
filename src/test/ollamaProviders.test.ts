import * as assert from 'assert';
import { OllamaCloudProvider } from '../providers/ollamaCloudProvider';
import { OllamaProvider } from '../providers/ollamaProvider';
import { VaultService } from '../services/vault';
import { HttpService } from '../utils/http';

import { ConfigService } from '../services/configService';

describe('Ollama Providers Tool Capabilities & Model Listing', () => {
    const mockSecrets = new Map<string, string>();
    let originalFetch: typeof HttpService.fetch;

    before(() => {
        originalFetch = HttpService.fetch;
        ConfigService.initialize({
            globalState: {
                get: () => undefined,
                update: async () => {}
            }
        } as any);
        VaultService.initialize({
            secrets: {
                get: async (k: string) => mockSecrets.get(k),
                store: async (k: string, v: string) => { mockSecrets.set(k, v); },
                delete: async (k: string) => { mockSecrets.delete(k); },
                onDidChange: () => ({ dispose: () => {} })
            }
        } as any);
    });

    afterEach(() => {
        HttpService.fetch = originalFetch;
        mockSecrets.clear();
    });

    it('enables supportsTools for OllamaCloudProvider', () => {
        const provider = new OllamaCloudProvider();
        assert.strictEqual(provider.config.id, 'ollamaCloud');
        assert.strictEqual(provider.config.name, 'Ollama Cloud');
        assert.strictEqual(provider.config.supportsTools, true);
        assert.strictEqual(provider.config.type, 'cloud');
        assert.strictEqual(provider.config.baseUrl, 'https://ollama.com/v1');
    });

    it('disables supportsTools for local OllamaProvider', () => {
        const provider = new OllamaProvider();
        assert.strictEqual(provider.config.id, 'ollama');
        assert.strictEqual(provider.config.name, 'Ollama');
        assert.strictEqual(provider.config.supportsTools, false);
        assert.strictEqual(provider.config.type, 'local');
    });

    it('OllamaCloudProvider returns empty array when no apiKey configured', async () => {
        const provider = new OllamaCloudProvider();
        const models = await provider.listModels();
        assert.deepStrictEqual(models, []);
    });

    it('OllamaCloudProvider lists models successfully when API key and valid response present', async () => {
        mockSecrets.set('api-key-ollamaCloud', 'test-ollama-cloud-key');
        HttpService.fetch = async (url: string) => {
            assert.ok(url.includes('https://ollama.com/v1/models'));
            return {
                ok: true,
                json: async () => ({
                    data: [
                        { id: 'llama3.2:latest' },
                        { id: 'qwen2.5-coder:latest' }
                    ]
                })
            } as any;
        };

        const provider = new OllamaCloudProvider();
        const models = await provider.listModels();
        assert.strictEqual(models.length, 2);
        assert.strictEqual(models[0].id, 'llama3.2:latest');
        assert.strictEqual(models[1].name, 'qwen2.5-coder:latest');
    });

    it('OllamaCloudProvider handles HTTP errors or invalid payloads gracefully', async () => {
        mockSecrets.set('api-key-ollamaCloud', 'test-ollama-cloud-key');
        HttpService.fetch = async () => ({
            ok: false,
            status: 401
        } as any);

        const provider = new OllamaCloudProvider();
        const models = await provider.listModels();
        assert.deepStrictEqual(models, []);

        HttpService.fetch = async () => {
            throw new Error('Network offline');
        };
        const modelsOffline = await provider.listModels();
        assert.deepStrictEqual(modelsOffline, []);
    });

    it('OllamaProvider normalizes base URL and lists models from /api/tags', async () => {
        HttpService.fetch = async (url: string) => {
            assert.ok(url.includes('/api/tags'));
            return {
                ok: true,
                json: async () => ({
                    models: [
                        { name: 'llama3.1:8b' },
                        { name: 'mistral:latest' }
                    ]
                })
            } as any;
        };

        const provider = new OllamaProvider();
        const models = await provider.listModels();
        assert.strictEqual(models.length, 2);
        assert.strictEqual(models[0].id, 'llama3.1:8b');
        assert.strictEqual(models[1].name, 'mistral:latest');
    });

    it('OllamaProvider handles failure to reach local server', async () => {
        HttpService.fetch = async () => {
            throw new Error('ECONNREFUSED');
        };

        const provider = new OllamaProvider();
        const models = await provider.listModels();
        assert.deepStrictEqual(models, []);
    });
});
