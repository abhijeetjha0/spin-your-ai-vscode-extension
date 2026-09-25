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
            return await this.secretStorage.get(`api-key-${providerId}`);
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
