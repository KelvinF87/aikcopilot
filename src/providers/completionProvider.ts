// src/providers/completionProvider.ts

import * as vscode from 'vscode';
import { LlmService } from '../llmService';
import { ConfigManager } from '../utils/configManager';

const Logger = console;

export class CompletionProvider implements vscode.CompletionItemProvider {

    private llmService: LlmService;
    private configManager: ConfigManager;
    private debounceTimer: NodeJS.Timeout | undefined;
    private lastRequestTime: number = 0;
    private isRequestPending: boolean = false;

    constructor(llmService: LlmService, configManager: ConfigManager) {
        this.llmService = llmService;
        this.configManager = configManager;
        Logger.log("[CompletionProvider] Construido.");
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | undefined> {

        Logger.log(`[CompletionProvider] provideCompletionItems ACTIVADO. Trigger: ${context.triggerKind}. Char: ${context.triggerCharacter || 'N/A'}. Pos: ${position.line + 1}:${position.character + 1}`);

        if (!this.configManager.isCompletionEnabled) {
             Logger.log("[CompletionProvider] Autocompletado DESACTIVADO en ajustes.");
            return undefined;
        }
        Logger.log('[CompletionProvider] Autocompletado HABILITADO.');

        if (this.isRequestPending) {
            Logger.log("[CompletionProvider] Petición ya en curso, omitiendo.");
            return undefined;
        }

        const debounceMs = this.configManager.completionDebounceMs;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        Logger.log('[CompletionProvider] Iniciando debounce timer...');

        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        if (!linePrefix.trim() && context.triggerKind !== vscode.CompletionTriggerKind.Invoke) {
             Logger.log("[CompletionProvider] Prefijo vacío, omitiendo (salvo Invoke).");
             clearTimeout(this.debounceTimer); // Cancelar timer si ya no aplica
             this.debounceTimer = undefined;
            return undefined;
        }

        const maxContextLines = 15;
        const startLine = Math.max(0, position.line - maxContextLines);
        const range = new vscode.Range(startLine, 0, position.line, position.character);
        const prefixContext = document.getText(range);

        // Prompt específico para completado
        const prompt = `Complete the following ${document.languageId} code. Only provide the code completion, without any explanation or surrounding text.\n\`\`\`${document.languageId}\n${prefixContext}`;
        Logger.log(`[CompletionProvider] Prompt generado (inicio): ${prompt.substring(0, 200).replace(/\n/g, '\\n')}...`);

        return new Promise((resolve) => {
            this.debounceTimer = setTimeout(async () => {
                this.debounceTimer = undefined;
                this.lastRequestTime = Date.now();
                this.isRequestPending = true;
                Logger.log("[CompletionProvider] Debounce terminado. Preparando llamada API...");

                try {
                    if (token.isCancellationRequested) {
                         Logger.log("[CompletionProvider] Cancelado ANTES de llamada API.");
                         this.isRequestPending = false; resolve(undefined); return;
                    }

                    Logger.log("[CompletionProvider] Llamando a llmService.getCodeCompletion...");
                    const suggestion = await this.llmService.getCodeCompletion(prompt);
                    Logger.log('[CompletionProvider] Sugerencia recibida (o vacía):', suggestion);

                    if (token.isCancellationRequested) {
                        Logger.log("[CompletionProvider] Cancelado DESPUÉS de llamada API.");
                        this.isRequestPending = false; resolve(undefined); return;
                    }

                    if (suggestion && suggestion.trim()) {
                        const trimmedSuggestion = suggestion.trimStart(); // Quitar espacios/saltos iniciales
                        Logger.log(`[CompletionProvider] Creando CompletionItem con: "${trimmedSuggestion.substring(0, 80).replace(/\n/g, '\\n')}..."`);
                        const completionItem = new vscode.CompletionItem(trimmedSuggestion, vscode.CompletionItemKind.Snippet);
                        completionItem.insertText = trimmedSuggestion; // Texto a insertar
                        // Ajustar el rango si queremos reemplazar algo (normalmente no para completado)
                        // completionItem.range = new vscode.Range(position, position);
                        completionItem.preselect = true; // Hacer que sea la opción por defecto
                        // completionItem.detail = "AIK-Pilot Suggestion"; // Tooltip corto
                        // completionItem.documentation = new vscode.MarkdownString(`\`\`\`${document.languageId}\n${trimmedSuggestion}\n\`\`\``); // Preview

                        resolve([completionItem]);
                    } else {
                        Logger.log("[CompletionProvider] No se recibió sugerencia válida del LLM.");
                        resolve(undefined);
                    }
                } catch (error) {
                     Logger.error(`[CompletionProvider] ERROR en provideCompletionItems (dentro de timer):`, error);
                    resolve(undefined);
                } finally {
                    this.isRequestPending = false;
                    Logger.log("[CompletionProvider] Petición de completado finalizada.");
                }
            }, debounceMs);
         });
    }
}