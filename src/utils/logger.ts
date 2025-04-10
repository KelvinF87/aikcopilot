import * as vscode from 'vscode';

export class Logger {
    private static outputChannel: vscode.OutputChannel | undefined;

    static init() {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel("LLM Assistant");
        }
    }

    static log(message: string) {
        this.outputChannel?.appendLine(`[INFO] ${new Date().toISOString()}: ${message}`);
    }

    static warn(message: string) {
        this.outputChannel?.appendLine(`[WARN] ${new Date().toISOString()}: ${message}`);
    }

    static error(message: string) {
        this.outputChannel?.appendLine(`[ERROR] ${new Date().toISOString()}: ${message}`);
        // Opcional: Mostrar el canal de salida al usuario en caso de error grave
        // this.outputChannel?.show(true);
    }

     static dispose() {
        this.outputChannel?.dispose();
        this.outputChannel = undefined;
    }
}