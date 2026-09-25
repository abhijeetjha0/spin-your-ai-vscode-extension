import * as vscode from 'vscode';

export class Logger {
    private static channel: vscode.OutputChannel;

    public static initialize(name: string) {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel(name);
        }
    }

    public static log(message: string) {
        if (this.channel) {
            this.channel.appendLine(`[INFO ${new Date().toISOString()}] ${message}`);
        }
    }

    public static error(message: string, error?: any) {
        if (this.channel) {
            const errorMsg = error ? ` - ${error instanceof Error ? error.message : JSON.stringify(error)}` : '';
            this.channel.appendLine(`[ERROR ${new Date().toISOString()}] ${message}${errorMsg}`);
            if (error instanceof Error && error.stack) {
                this.channel.appendLine(error.stack);
            }
        }
    }
}
