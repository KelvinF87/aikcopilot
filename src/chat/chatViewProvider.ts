import * as vscode from 'vscode';
import { LlmService } from '../llmService'; // Ajusta ruta si es necesario
import { ConfigManager } from '../utils/configManager'; // Ajusta ruta
// Asegúrate de tener un logger funcional o usa console
// import { Logger } from '../utils/logger';
const Logger = console; // Usar console como fallback si Logger no está configurado

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Constantes para la memoria de conversación
const MAX_MEMORY_INTERACTIONS = 5; // Interacciones (user + bot) a recordar
const MAX_MESSAGES_TO_SEND = (MAX_MEMORY_INTERACTIONS * 2) + 1; // Mensajes totales (incluyendo el actual)

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aikPilotChatView'; // Debe coincidir con package.json

    // Propiedades de la instancia
    private _view?: vscode.WebviewView;
    // *** HACER EL HISTORIAL MUTABLE (quitar readonly) ***
    private _conversationHistory: ChatMessage[] = []; // Almacena TODOS los mensajes
    private _currentViewDisposables: vscode.Disposable[] = [];
    private readonly _extensionUri: vscode.Uri;
    private readonly _llmService: LlmService;
    private readonly _configManager: ConfigManager;

    constructor(
        extensionUri: vscode.Uri,
        llmService: LlmService,
        configManager: ConfigManager
    ) {
        this._extensionUri = extensionUri;
        this._llmService = llmService;
        this._configManager = configManager;
        Logger.log("[ChatViewProvider] Constructed.");
    }

    // Método principal llamado por VS Code para inicializar la vista
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        Logger.log(">>> [ChatViewProvider] resolveWebviewView START");
        this._view = webviewView;
        Logger.log(">>> [ChatViewProvider] _view assigned.");

        this._disposeCurrentViewListeners();

        // Configurar opciones de la webview
        try {
            Logger.log(">>> [ChatViewProvider] Setting webview.options...");
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview'),
                    vscode.Uri.joinPath(this._extensionUri, 'media')
                ]
            };
            Logger.log(">>> [ChatViewProvider] webview.options SET successfully.");
        } catch (error) {
            Logger.error(`>>> [ChatViewProvider] ERROR setting webview.options: ${error}`);
            return;
        }

        // Asignar el contenido HTML a la webview
        try {
            Logger.log(">>> [ChatViewProvider] Calling _getHtmlForWebview...");
            const htmlContent = this._getHtmlForWebview(webviewView.webview);
            Logger.log(">>> [ChatViewProvider] _getHtmlForWebview returned.");
            Logger.log(">>> [ChatViewProvider] Assigning webview.html...");
            webviewView.webview.html = htmlContent;
            Logger.log(">>> [ChatViewProvider] webview.html ASSIGNED successfully.");
        } catch (error) {
            Logger.error(`>>> [ChatViewProvider] ERROR getting or assigning HTML: ${error}`);
            return;
        }

        // Enviar los datos iniciales a la webview
        this.sendInitialDataToWebview();

        // Configurar los listeners
        try {
            Logger.log(">>> [ChatViewProvider] Setting up message listener (webview -> extension)...");
            const messageListener = webviewView.webview.onDidReceiveMessage(async (message) => {
                Logger.log(`>>> [ChatViewProvider] Received message from webview: ${message.command}`);
                switch (message.command) {
                    case 'sendMessage':
                        if (typeof message.text === 'string') {
                            await this._handleUserMessage(message.text); // Llamar al método modificado
                        }
                        return;
                    case 'clearChat':
                        // *** CORRECCIÓN: Limpiar historial aquí ***
                        this._conversationHistory.length = 0; // Vaciar el array
                        this._sendMessageToWebview('clearChat', {});
                        Logger.log('[ChatViewProvider] Chat history cleared.');
                        return;
                    case 'setActiveProvider':
                        if (typeof message.providerId === 'string') {
                            await this._configManager.setActiveProviderId(message.providerId);
                            this._sendMessageToWebview('providerChanged', { newProviderId: message.providerId });
                             // Limpiar historial al cambiar de proveedor? (Opcional)
                             // this._conversationHistory.length = 0;
                             // this._sendMessageToWebview('clearChat', {});
                        }
                        return;
                    case 'log':
                        Logger.log(`[Webview Log] ${message.level || 'INFO'}: ${message.message}`);
                        return;
                    case 'error':
                        Logger.error(`[Webview Error] ${message.message}: ${JSON.stringify(message.error)}`);
                        return;
                }
            });
            this._currentViewDisposables.push(messageListener);
            Logger.log(">>> [ChatViewProvider] Message listener SET successfully.");

            Logger.log(">>> [ChatViewProvider] Setting up dispose listener...");
            const disposeListener = webviewView.onDidDispose(() => {
                Logger.log("[ChatViewProvider] ChatView disposed.");
                this._disposeCurrentViewListeners();
                this._view = undefined;
            });
            this._currentViewDisposables.push(disposeListener);
            Logger.log(">>> [ChatViewProvider] Dispose listener SET successfully.");

            Logger.log(">>> [ChatViewProvider] Setting up config change listener...");
            const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('aik-pilot.activeProvider') || e.affectsConfiguration('aik-pilot.providers')) {
                    Logger.log("[ChatViewProvider] Relevant configuration changed, updating webview data...");
                    this.sendInitialDataToWebview();
                }
            });
            this._currentViewDisposables.push(configChangeListener);
            Logger.log(">>> [ChatViewProvider] Config change listener SET successfully.");

        } catch (error) {
            Logger.error(`>>> [ChatViewProvider] ERROR setting up listeners: ${error}`);
        }

        Logger.log(">>> [ChatViewProvider] resolveWebviewView FINISHED");
    }

    // --- Método para enviar los datos iniciales a la Webview ---
    private sendInitialDataToWebview() {
        Logger.log(">>> [ChatViewProvider] sendInitialDataToWebview START");
        if (this._view) {
            try {
                const providers = this._configManager.allProvidersConfig;
                const activeProviderId = this._configManager.activeProviderId;
                const providerOptions = Object.entries(providers).map(([id, config]) => ({
                    id: id,
                    displayName: config.displayName
                }));
                const dataToSend = { providers: providerOptions, activeProviderId: activeProviderId };
                Logger.log(">>> [ChatViewProvider] sendInitialDataToWebview: Data prepared:", dataToSend);
                this._sendMessageToWebview('setInitialData', dataToSend);
            } catch (error) {
                 Logger.error(">>> [ChatViewProvider] sendInitialDataToWebview: ERROR preparing data:", error);
            }
        } else {
            Logger.warn(">>> [ChatViewProvider] sendInitialDataToWebview: Cannot send, _view is undefined.");
        }
        Logger.log(">>> [ChatViewProvider] sendInitialDataToWebview FINISHED");
    }


    // --- Métodos de Lógica Interna y Comunicación ---
    private _disposeCurrentViewListeners() {
        Logger.log(`[ChatViewProvider] Disposing ${this._currentViewDisposables.length} listeners.`);
        while(this._currentViewDisposables.length) {
            const disposable = this._currentViewDisposables.pop();
            if (disposable) { disposable.dispose(); }
        }
    }

    // ***** MÉTODO MODIFICADO PARA USAR MEMORIA *****
    private async _handleUserMessage(text: string) {
        if (!text || !this._view) {
            Logger.warn("[ChatViewProvider] _handleUserMessage called with empty text or no view.");
            return;
        }

        Logger.log(`[ChatViewProvider] Handling user message: "${text}"`);

        // 1. Añadir mensaje actual al HISTORIAL COMPLETO y enviar a UI
        this._addUserMessage(text); // Llama a la función que hace push y postMessage

        // ***** PUNTO CRÍTICO: Verificar el historial DESPUÉS de añadir *****
        Logger.log(`>>> [ChatViewProvider] History AFTER addUserMessage (${this._conversationHistory.length} total): ${JSON.stringify(this._conversationHistory)}`);

        // 2. Preparar el CONTEXTO (MEMORIA) para el LLM
        //    Selecciona los últimos N mensajes del historial completo.
        const messagesToSend = this._conversationHistory.slice(-MAX_MESSAGES_TO_SEND);

        // ***** OTRO LOG CRÍTICO *****
        Logger.log(`>>> [ChatViewProvider] messagesToSend calculated (${messagesToSend.length} slice): ${JSON.stringify(messagesToSend)}`);

        Logger.log(`[ChatViewProvider] Sending last ${messagesToSend.length} messages (max ${MAX_MESSAGES_TO_SEND}) to LLM service.`);

        // 3. Enviar el CONTEXTO SELECCIONADO al LlmService
        try {
            this._sendMessageToWebview('showThinking', { thinking: true });
            // LlmService añadirá el system prompt si está configurado
            const botResponse = await this._llmService.getChatCompletion(messagesToSend); // <-- Pasar la lista limitada
            // 4. Añadir respuesta del bot al HISTORIAL COMPLETO y enviar a UI
            this._addBotMessage(botResponse);
        } catch (error) {
            Logger.error(`[ChatViewProvider] Error received from LLM service: ${error}`);
            this._sendMessageToWebview('showError', {
                text: `Failed to get response: ${error instanceof Error ? error.message : String(error)}`
            });
        } finally {
            this._sendMessageToWebview('showThinking', { thinking: false });
        }
    }
    // ***** FIN MÉTODO MODIFICADO *****


    private _addUserMessage(text: string) {
        const userMessage: ChatMessage = { role: 'user', content: text };
        // *** Asegurar que this._conversationHistory sea modificable ***
        this._conversationHistory.push(userMessage); // Añade al historial completo
        Logger.log(`[ChatViewProvider] Added user message to history. History length: ${this._conversationHistory.length}`);
        this._sendMessageToWebview('addMessage', { sender: 'user', text });
    }

    private _addBotMessage(text: string) {
        if (text?.trim()) {
            const botMessage: ChatMessage = { role: 'assistant', content: text };
             // *** Asegurar que this._conversationHistory sea modificable ***
            this._conversationHistory.push(botMessage); // Añade al historial completo
            Logger.log(`[ChatViewProvider] Added bot message to history. History length: ${this._conversationHistory.length}`);
            this._sendMessageToWebview('addMessage', { sender: 'bot', text });
        } else {
            Logger.warn("[ChatViewProvider] Received empty/whitespace bot message, not adding.");
        }
    }

    // Método centralizado para enviar mensajes a la webview
    private _sendMessageToWebview(command: string, data: any) {
        // Usar console.log aquí si reemplazaste Logger
        Logger.log(`>>> [ChatViewProvider] _sendMessageToWebview: Attempting command '${command}' with data:`, data);
        if (this._view) {
            this._view.webview.postMessage({ command, ...data })
                .then((success) => {
                     if (!success) {
                          Logger.warn(`>>> [ChatViewProvider] _sendMessageToWebview: postMessage for command '${command}' returned false.`);
                     } else {
                           Logger.log(`>>> [ChatViewProvider] _sendMessageToWebview: Message for command '${command}' POSTED successfully.`);
                     }
                 }, (error) => {
                     Logger.error(`>>> [ChatViewProvider] _sendMessageToWebview: Error posting message for command '${command}':`, error);
                 });
        } else {
            Logger.warn(`>>> [ChatViewProvider] _sendMessageToWebview: Cannot send command '${command}', _view is undefined.`);
        }
    }
    // --- Fin Otros Métodos ---


    // --- Método para generar el HTML de la Webview ---
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Obtener URIs seguros
        const styleUri = webview.asWebviewUri(
             vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview', 'style.css')
        );
        const scriptUri = webview.asWebviewUri(
             vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview', 'main.js')
        );
        const nonce = getNonce();

         // Devolver el HTML como una plantilla literal
         return `
             <!DOCTYPE html>
             <html lang="en">
             <head>
                 <meta charset="UTF-8">
                 <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource}; connect-src 'none';">
                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
                 <link rel="stylesheet" href="${styleUri}">
                 <title>AIK-Pilot Chat</title>
                 <style nonce="${nonce}">
                     #provider-selector-area { padding-bottom: 10px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-editorGroup-border)); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
                     #provider-selector { padding: 3px 6px; border: 1px solid var(--vscode-dropdown-border); background-color: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-radius: 3px; flex-grow: 1; }
                     #provider-selector:focus { outline: 1px solid var(--vscode-focusBorder); }
                 </style>
             </head>
             <body>
                 <div id="chat-container">
                     <div id="provider-selector-area">
                          <label for="provider-selector">LLM:</label>
                          <select id="provider-selector"><option value="">Loading...</option></select>
                     </div>
                     <div id="message-list"></div>
                     <div id="input-area">
                        <textarea id="user-input" rows="3" placeholder="Ask something..."></textarea>
                        <button id="send-button">Send</button>
                     </div>
                     <div id="status-area" style="display: none;">Thinking...</div>
                 </div>
                 <script nonce="${nonce}" src="${scriptUri}"></script>
             </body>
             </html>
         `;
    }
} // Fin de la clase ChatViewProvider

// Función auxiliar para generar un nonce aleatorio
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}