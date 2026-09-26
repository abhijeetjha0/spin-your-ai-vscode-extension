import * as vscode from 'vscode';

export class ConfigService {
    private static _context: vscode.ExtensionContext;

    static initialize(context: vscode.ExtensionContext) {
        this._context = context;
    }

    static get<T>(key: string): T | undefined {
        return this._context.globalState.get<T>(`spinYourAi.${key}`);
    }

    static async update(key: string, value: any): Promise<void> {
        await this._context.globalState.update(`spinYourAi.${key}`, value);
    }
}
