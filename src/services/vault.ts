import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export class VaultService {
    private static secretStorage: vscode.SecretStorage;

    public static initialize(context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
        Logger.log('VaultService initialized with VSCode SecretStorage');
    }

    public static async storeKey(providerId: string, apiKey: string): Promise<void> {
        try {
            await this.secretStorage.store(`api-key-${providerId}`, apiKey);
            Logger.log(`API key stored securely for provider: ${providerId}`);
        } catch (err) {
            Logger.error(`Failed to store API key for ${providerId}`, err);
            throw err;
        }
    }

    public static async getKey(providerId: string): Promise<string | undefined> {
        try {
            const key = await this.secretStorage.get(`api-key-${providerId}`);
            if (key) {
                return key;
            }

            // Check alternative snake_case ID if applicable (e.g. ollama_cloud vs ollamaCloud)
            if (providerId === 'ollamaCloud') {
                const altKey = await this.secretStorage.get('api-key-ollama_cloud');
                if (altKey) {
                    await this.storeKey(providerId, altKey);
                    return altKey;
                }
            }

            // Automatic Migration: check if key was previously set in VS Code settings.json
            const config = vscode.workspace.getConfiguration('spinYourAi');
            const legacyKey = config.get<string>(`${providerId}.apiKey`)
                || config.get<string>(`${providerId}ApiKey`)
                || config.get<string>(`apiKeys.${providerId}`)
                || config.get<string>(`${providerId}.key`)
                || (providerId === 'ollamaCloud' ? config.get<string>('ollama_cloud.apiKey') : undefined);

            if (legacyKey && legacyKey.trim()) {
                const trimmed = legacyKey.trim();
                await this.storeKey(providerId, trimmed);
                Logger.log(`Migrated legacy settings.json API key for "${providerId}" to secure SecretStorage.`);
                return trimmed;
            }

            return undefined;
        } catch (err) {
            Logger.error(`Failed to retrieve API key for ${providerId}`, err);
            return undefined;
        }
    }

    public static async deleteKey(providerId: string): Promise<void> {
        try {
            await this.secretStorage.delete(`api-key-${providerId}`);
            Logger.log(`API key deleted for provider: ${providerId}`);
        } catch (err) {
            Logger.error(`Failed to delete API key for ${providerId}`, err);
            throw err;
        }
    }
}
