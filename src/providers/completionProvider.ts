import * as vscode from 'vscode';
import { LlmService } from '../llmService'; // Ajusta ruta
import { ConfigManager } from '../utils/configManager'; // Ajusta ruta
import { Logger } from '../utils/logger'; // Ajusta ruta

export class CompletionProvider implements vscode.CompletionItemProvider {

    private llmService: LlmService;
    private configManager: ConfigManager;
    private debounceTimer: NodeJS.Timeout | undefined;
    private lastRequestTime: number = 0;

    constructor(llmService: LlmService, configManager: ConfigManager) {
        this.llmService = llmService;
        this.configManager = configManager;
        Logger.log("[CompletionProvider] Constructed.");
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | undefined> {

        Logger.log(`[CompletionProvider] Triggered. Reason: ${context.triggerKind}`);

        if (!this.configManager.isCompletionEnabled) {
             Logger.log("[CompletionProvider] Autocompletion disabled in settings.");
            return undefined;
        }

        // --- Debouncing Simple ---
        const debounceMs = this.configManager.completionDebounceMs;
        const now = Date.now();
        if (now - this.lastRequestTime < debounceMs) {
             Logger.log(`[CompletionProvider] Debounced. Time since last request: ${now - this.lastRequestTime}ms`);
             return undefined; // Demasiado pronto desde la última petición
        }
        // Clear cualquier timer previo si existe (podría ser de otra llamada)
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        // --- Fin Debouncing ---


        const linePrefix = document.lineAt(position).text.substring(0, position.character);

         // Evitar completar si no hay nada útil antes del cursor o si es espacio en blanco
        if (!linePrefix.trim()) {
             Logger.log("[CompletionProvider] Line prefix is empty or whitespace.");
            return undefined;
        }

        // Podrías añadir lógica para obtener más contexto (líneas anteriores)
         // Limitaremos el contexto por simplicidad ahora
         const maxContextLines = 10; // Cuántas líneas anteriores mirar
         const startLine = Math.max(0, position.line - maxContextLines);
         const range = new vscode.Range(startLine, 0, position.line, position.character);
         const prefixContext = document.getText(range);


         // Construir el prompt para el modelo (esto puede variar mucho)
         // Ejemplo simple para modelos instruct/chat:
         // (Para modelos `completion` puros, solo pasarías prefixContext)
         const prompt = `Complete the following code snippet:\n\`\`\`${document.languageId}\n${prefixContext}\n\`\`\``;
        // Alternativa simple: const prompt = prefixContext;


        Logger.log("[CompletionProvider] Requesting completion...");

        return new Promise((resolve) => {
            // Usar setTimeout para el debounce efectivo antes de la llamada API
            this.debounceTimer = setTimeout(async () => {
                 this.lastRequestTime = Date.now(); // Marcar tiempo antes de la llamada
                try {
                    // Verificar token de cancelación antes de la llamada costosa
                    if (token.isCancellationRequested) {
                         Logger.log("[CompletionProvider] Request cancelled before API call.");
                        resolve(undefined);
                        return;
                    }

                     // Usar getCodeCompletion o adaptar getChatCompletion
                     // Asegúrate que getCodeCompletion exista en LlmService
                    const suggestion = await this.llmService.getCodeCompletion(prompt);

                    if (token.isCancellationRequested) {
                        Logger.log("[CompletionProvider] Request cancelled after API call.");
                        resolve(undefined);
                        return;
                    }

                    if (suggestion) {
                        Logger.log(`[CompletionProvider] Suggestion received: "${suggestion.substring(0, 50)}..."`);
                        const completionItem = new vscode.CompletionItem(suggestion, vscode.CompletionItemKind.Snippet); // O Text
                        // El texto a insertar SÓLO debe ser la sugerencia, no el prefijo
                        completionItem.insertText = suggestion;
                        // Indicar que este texto reemplaza desde donde empezamos a autocompletar
                        // (puede necesitar ajuste si quieres reemplazar más que solo insertar)
                        // completionItem.range = new vscode.Range(position, position);

                        resolve([completionItem]);
                    } else {
                        Logger.log("[CompletionProvider] No suggestion received from LLM.");
                        resolve(undefined);
                    }
                } catch (error) {
                     Logger.error(`[CompletionProvider] Error: ${error}`);
                    resolve(undefined); // No mostrar error al usuario, simplemente no completar
                } finally {
                   this.debounceTimer = undefined; // Limpiar timer
                }
            }, debounceMs); // Esperar el debounce
         });
    }
}