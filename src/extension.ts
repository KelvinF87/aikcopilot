// src/extension.ts
// (Sin cambios respecto a la versión anterior, ya estaba correcta)

import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/chatViewProvider';
import { CompletionProvider } from './providers/completionProvider';
import { LlmService } from './llmService';
import { ConfigManager } from './utils/configManager';

const Logger = console;

export function activate(context: vscode.ExtensionContext) {
    Logger.log('!!! Iniciando activación de AIK-Pilot !!!');

    // Instanciar Clases
    const configManager = new ConfigManager();
    const llmService = new LlmService(configManager);
    const chatProvider = new ChatViewProvider(context.extensionUri, llmService, configManager);
    const completionProvider = new CompletionProvider(llmService, configManager);

    // --- Registrar ---
    Logger.log(`>>> Registrando WebviewViewProvider: '${ChatViewProvider.viewType}'`);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType, chatProvider, { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    Logger.log(">>> Registrando CompletionProvider...");
    const supportedLanguages = ['*'];
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
             supportedLanguages.map(lang => ({ scheme: 'file', language: lang })),
             completionProvider, '.' // Trigger inicial
        )
    );

    // Comandos
    context.subscriptions.push(
        vscode.commands.registerCommand('aik-pilot.helloWorld', () => {
           vscode.window.showInformationMessage('Hello World from AIK-Pilot!');
       })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('aik-pilot.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.aik-pilot-sidebar');
        })
    );

    // Listener Configuración
    Logger.log(">>> Registrando Listener Configuración...");
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aik-pilot.activeProvider') || e.affectsConfiguration('aik-pilot.providers')) {
                Logger.log("[Extensión] Config proveedor cambiada, notificando ChatView...");
                chatProvider.sendInitialDataToWebview();
            }
            // Añadir más checks si es necesario
        })
    );

    Logger.log('!!! Activación de AIK-Pilot FINALIZADA !!!');
}

export function deactivate() {
    Logger.log('!!! Desactivando AIK-Pilot !!!');
}