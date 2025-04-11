// src/chat/chatViewProvider.ts

import * as vscode from 'vscode';
import { LlmService } from '../llmService';
import { ConfigManager } from '../utils/configManager';
import * as path from 'path';
import * as os from 'os';

const Logger = console;

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Interfaz para estado de mensaje en progreso (para historial mientras streamea)
interface PendingMessage extends ChatMessage {
    id: string;
    isStreaming?: boolean;
}

const MAX_MEMORY_INTERACTIONS = 5;
const MAX_MESSAGES_TO_SEND = (MAX_MEMORY_INTERACTIONS * 2) + 1;

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aikPilotChatView';

    private _view?: vscode.WebviewView;
    // Modificar historial para poder incluir mensajes en progreso
    private _conversationHistory: (ChatMessage | PendingMessage)[] = [];
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

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        Logger.log(">>> [ChatViewProvider] resolveWebviewView START");
        this._view = webviewView;
        this._disposeCurrentViewListeners();

        webviewView.webview.options = { enableScripts: true, localResourceRoots: [ /*...*/ vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview'), vscode.Uri.joinPath(this._extensionUri, 'media')] };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this.sendInitialDataToWebview(); // Enviar datos iniciales (proveedores)
        this.restoreChatHistoryToWebview(); // Enviar historial existente a la UI

        // Listener de mensajes desde la webview
        const messageListener = webviewView.webview.onDidReceiveMessage(async (message) => {
             Logger.log(`>>> [ChatViewProvider] Mensaje recibido: ${message.command}`);
             switch (message.command) {
                 case 'sendMessage':
                     if (typeof message.text === 'string') await this._handleUserMessage(message.text);
                     break; // Cambiado de return a break
                 case 'clearChat':
                     this._clearChatHistory();
                     this._sendMessageToWebview('clearChat', {});
                     break;
                 case 'exportChat': await this._exportChatToFile(); break;
                 case 'setActiveProvider':
                     if (typeof message.providerId === 'string') await this._configManager.setActiveProviderId(message.providerId);
                     break;
                 case 'openSettings':
                     const extensionId = 'aik-pilot'; // <-- CAMBIA ESTO
                     vscode.commands.executeCommand('workbench.action.openSettings', `${extensionId}`);
                    //  vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${extensionId}`);
                     break;
                 // ... otros cases (log, error) ...
             }
        });
        this._currentViewDisposables.push(messageListener);

        // Listener de dispose
        const disposeListener = webviewView.onDidDispose(() => { /* ... limpiar ... */ });
        this._currentViewDisposables.push(disposeListener);

        Logger.log(">>> [ChatViewProvider] resolveWebviewView FINISHED");
    }

    // Enviar datos iniciales (proveedores)
    public sendInitialDataToWebview() {
        /* ... código existente ... */
        Logger.log(">>> [ChatViewProvider] sendInitialDataToWebview START");
        if (this._view) {
            try {
                const providers = this._configManager.allProvidersConfig;
                const activeProviderId = this._configManager.activeProviderId;
                const providerOptions = Object.entries(providers).map(([id, config]) => ({ id: id, displayName: config.displayName || id }));
                this._sendMessageToWebview('setInitialData', { providers: providerOptions, activeProviderId });
            } catch (error) { Logger.error(">>> Error preparando datos iniciales:", error); }
        }
        Logger.log(">>> [ChatViewProvider] sendInitialDataToWebview FINISHED");
    }

    // Enviar historial al cargar la webview
    private restoreChatHistoryToWebview() {
        if (this._view) {
            Logger.log(`[ChatViewProvider] Restaurando ${this._conversationHistory.length} mensajes a la UI.`);
            this._sendMessageToWebview('clearChat', {}); // Limpiar UI primero
            this._conversationHistory.forEach(msg => {
                // Si es un mensaje pendiente, tratarlo como bot con su ID
                const id = (msg as PendingMessage).id || null;
                this._sendMessageToWebview('addMessage', {
                    sender: msg.role === 'user' ? 'user' : 'bot', // Asistente o error como bot
                    text: msg.content,
                    messageId: id // Enviar ID si existe
                });
                // Si estaba en streaming, quizás mostrar indicador o reanudar? (complejo)
                if ((msg as PendingMessage).isStreaming) {
                     Logger.warn(`[ChatViewProvider] Mensaje ${id} estaba en streaming al recargar. No se reanuda.`);
                }
            });
        }
    }

    // --- Manejo de Mensajes y Streaming ---
    private async _handleUserMessage(text: string) {
        if (!text || !this._view) return;
        Logger.log(`[ChatViewProvider] Handling user message: "${text.substring(0, 50)}..."`);

        // 1. Añadir mensaje de usuario al historial
        const userMessage: ChatMessage = { role: 'user', content: text };
        this._conversationHistory.push(userMessage);
        // La UI añade el mensaje de usuario inmediatamente

        // 2. Preparar contexto para LLM (solo mensajes completos)
        const messagesToSend = this._conversationHistory
            .filter(msg => !(msg as PendingMessage).isStreaming) // Excluir mensajes aún en streaming
            .slice(-MAX_MESSAGES_TO_SEND) as ChatMessage[]; // Asegurar tipo ChatMessage
        Logger.log(`[ChatViewProvider] Enviando ${messagesToSend.length} mensajes (contexto) a LLM para streaming.`);

        // 3. Crear placeholder para respuesta del bot en historial y UI
        const botMessageId = `bot-msg-${Date.now()}-${Math.random().toString(16).substring(2)}`;
        const pendingBotMessage: PendingMessage = {
            id: botMessageId,
            role: 'assistant',
            content: '', // Inicia vacío
            isStreaming: true
        };
        this._conversationHistory.push(pendingBotMessage);
        this._sendMessageToWebview('addMessage', { sender: 'bot', text: '', messageId: botMessageId });
        this._sendMessageToWebview('showThinking', { thinking: true });

        // 4. Definir Callbacks y llamar al servicio LLM
        const handleChunk = (chunk: string) => {
            // Actualizar placeholder en historial
            pendingBotMessage.content += chunk;
            // Enviar chunk a la webview
            this._sendMessageToWebview('updateMessageStream', { messageId: botMessageId, chunk });
        };

        const handleEnd = (error?: Error) => {
            this._sendMessageToWebview('showThinking', { thinking: false });
            pendingBotMessage.isStreaming = false; // Marcar como completado

            if (error) {
                Logger.error(`[ChatViewProvider] Error en stream LLM (ID: ${botMessageId}): ${error}`);
                pendingBotMessage.content += `\n\n**Error en stream:** ${error.message}`; // Añadir error al contenido
                pendingBotMessage.role = 'assistant'; // O un rol 'error' si lo manejas diferente
                this._sendMessageToWebview('showError', { text: `Stream error: ${error.message}`, messageId: botMessageId });
            } else {
                Logger.log(`[ChatViewProvider] Stream finalizado (ID: ${botMessageId}). Respuesta completa (${pendingBotMessage.content.length} chars).`);
                // Opcional: enviar mensaje de finalización para que la UI haga el renderizado final con formato
                this._sendMessageToWebview('streamComplete', { messageId: botMessageId });
            }
            // Actualizar estado de VS Code (opcional, para persistencia entre sesiones)
            // vscode.setState(...)
        };

        // 5. Llamar al LlmService (asume que getChatCompletion ahora acepta callbacks)
        try {
            await this._llmService.getChatCompletion(messagesToSend, handleChunk, handleEnd);
        } catch (initialError) {
            // Error al iniciar la llamada (antes de que el stream empiece)
            Logger.error(`[ChatViewProvider] Error inicial al llamar a getChatCompletion (stream): ${initialError}`);
            pendingBotMessage.isStreaming = false; // Marcar como no en streaming
            pendingBotMessage.content = `**Error iniciando stream:** ${initialError instanceof Error ? initialError.message : String(initialError)}`;
            this._sendMessageToWebview('showThinking', { thinking: false });
            this._sendMessageToWebview('showError', { text: `Failed to start stream: ${pendingBotMessage.content}`, messageId: botMessageId });
        }
    }

    // Limpiar historial y UI
    private _clearChatHistory() {
        this._conversationHistory = [];
        Logger.log('[ChatViewProvider] Internal conversation history cleared.');
        // El mensaje 'clearChat' a la UI se envía desde el manejador
    }

    // Exportar chat
    private async _exportChatToFile(): Promise<void> {
         /* ... código de exportación existente ... */
          if (this._conversationHistory.length === 0) {
            vscode.window.showInformationMessage("Chat history is empty."); return;
        }
        Logger.log('[ChatViewProvider] Starting chat export...');
        let markdownContent = `# AIK-Pilot Chat Export\n\n`;
        try {
            const activeProvider = this._configManager.getActiveProviderConfig();
            markdownContent += `*Provider: ${activeProvider?.displayName || this._configManager.activeProviderId}*\n`;
        } catch (e) { /* Ignorar */ }
        markdownContent += `*Date: ${new Date().toLocaleString()}*\n\n---\n\n`;
        // Filtrar mensajes incompletos si no se quieren exportar
        this._conversationHistory.filter(msg => !(msg as PendingMessage).isStreaming).forEach(message => {
            markdownContent += `**${message.role === 'user' ? 'You' : 'AIK-Pilot'}:**\n${message.content}\n\n`;
        });
        // ... (resto del código para guardar archivo) ...
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         const suggestedFilename = `aik-pilot-chat-${timestamp}.md`;
         const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
             ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, suggestedFilename)
             : vscode.Uri.file(path.join(os.homedir(), suggestedFilename));
         try {
             const uri = await vscode.window.showSaveDialog({ defaultUri, filters: { 'Markdown': ['md'] }, title: "Export Chat" });
             if (uri) {
                 await vscode.workspace.fs.writeFile(uri, Buffer.from(markdownContent, 'utf8'));
                 vscode.window.showInformationMessage(`Chat exported to ${path.basename(uri.fsPath)}`);
             }
         } catch (error) { Logger.error(`[ChatViewProvider] Error exporting chat: ${error}`); vscode.window.showErrorMessage(`Failed to export chat.`); }
    }

    // Envío de mensajes a la webview (con logging mejorado)
    private _sendMessageToWebview(command: string, data: any) {
        /* ... código _sendMessageToWebview con logging mejorado de respuesta anterior ... */
         Logger.log(`>>> [ChatViewProvider] Intentando enviar a webview: Comando='${command}', Datos=${JSON.stringify(data).substring(0, 100)}...`);
         if (this._view?.webview) {
             this._view.webview.postMessage({ command, ...data })
                 .then(
                     (success) => {
                          if (!success) Logger.warn(`>>> [ChatViewProvider] postMessage para '${command}' devolvió false.`);
                          // else Logger.log(`>>> [ChatViewProvider] postMessage para '${command}' aparentemente exitoso.`);
                      },
                      (error) => { Logger.error(`>>> [ChatViewProvider] ERROR al ejecutar postMessage para '${command}':`, error); }
                  );
         } else {
             Logger.warn(`>>> [ChatViewProvider] No se puede enviar comando '${command}', _view o webview no están definidos.`);
         }
    }

    // Generación de HTML
    private _getHtmlForWebview(webview: vscode.Webview): string {
        /* ... código _getHtmlForWebview existente con el botón de ajustes ... */
          const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview', 'style.css'));
          const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview', 'main.js'));
          const nonce = getNonce();

          return `<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource}; connect-src 'none';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="${styleUri}">
      <title>AIK-Pilot Chat</title>
      <style>
          /* Estilos inline mínimos o copia de los relevantes de style.css si es necesario */
          #controls-area { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-editorGroup-border)); flex-wrap: wrap; }
          #settings-button { margin-left: auto; padding: 2px 6px; font-size: 1.2em; background-color: transparent; border: none; color: var(--vscode-icon-foreground); cursor: pointer; }
          #settings-button:hover { background-color: var(--vscode-toolbar-hoverBackground); }
          .control-button { /* Estilos generales para otros botones */ }
      </style>
  </head>
  <body>
      <div id="chat-container">
          <div id="controls-area">
              <label for="provider-selector">Provider:</label>
              <select id="provider-selector"><option value="">Loading...</option></select>
              <button id="new-chat-button" class="control-button" title="Start New Chat">New</button>
              <button id="export-chat-button" class="control-button" title="Export Chat History">Export</button>
              <button id="settings-button" class="control-button" title="Abrir Ajustes de AIK-Pilot">⚙️</button>
          </div>
          <div id="message-list"></div>
          <div id="input-area">
              <textarea id="user-input" rows="3" placeholder="Ask AIK-Pilot..."></textarea>
              <button id="send-button">Send</button>
          </div>
          <div id="status-area" style="display: none;">Thinking...</div>
      </div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
    }

     // --- Limpieza ---
    private _disposeCurrentViewListeners() {
        Logger.log(`[ChatViewProvider] Limpiando ${this._currentViewDisposables.length} listeners.`);
        vscode.Disposable.from(...this._currentViewDisposables).dispose();
        this._currentViewDisposables = [];
    }

} // Fin de la clase ChatViewProvider

// Función auxiliar Nonce
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}