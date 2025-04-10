import axios, { AxiosError } from 'axios'; // No necesitas AxiosResponse explícitamente aquí
import * as vscode from 'vscode';
import { ConfigManager } from './utils/configManager';
// Asegúrate de tener un logger funcional o usa console
// import { Logger } from './utils/logger';
const Logger = console; // Usar console como fallback

// Interfaz simplificada para mensajes de chat (estilo OpenAI)
interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// --- Interfaces para las Respuestas de la API (Simplificadas) ---
// (Puedes mantener las detalladas si las usas en otro lugar, pero para extraer
// el contenido, estas son suficientes)
interface ChatCompletionResponse {
    choices: {
        message?: { // message puede no estar siempre presente
            content: string | null;
        };
    }[];
}

interface CodeCompletionResponse {
    choices: {
        text: string | null;
    }[];
}
// --- FIN Interfaces Simplificadas ---


export class LlmService {
    private config: ConfigManager;

    constructor(configManager: ConfigManager) {
        this.config = configManager;
        Logger.log("[LlmService] Constructed.");
    }

    public onConfigUpdated(): void {
        Logger.log('[LlmService] Notified of config update.');
        // Podrías añadir lógica aquí para recargar algo si es necesario
    }

    /** Genera los encabezados HTTP necesarios para la API activa. */
    private getHeaders(): Record<string, string> {
        const activeConfig = this.config.getActiveProviderConfig();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        const apiKey = activeConfig?.apiKey;
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const customHeaders = activeConfig?.customHeaders;
        if (customHeaders) {
            Object.entries(customHeaders).forEach(([key, value]) => {
                if (value) { // Solo añadir si el valor no es vacío/null/undefined
                    headers[key] = value;
                }
            });
        }

        // Usar console.log aquí si reemplazaste Logger
        Logger.log(`>>> [LlmService] Generated Headers: ${JSON.stringify(headers)}`);
        return headers;
    }

    /** Obtiene una completación de chat desde el LLM activo. */
    async getChatCompletion(messages: ChatMessage[]): Promise<string> {
        const activeConfig = this.config.getActiveProviderConfig();
        if (!activeConfig) {
             Logger.error("[LlmService] No active LLM provider configuration found for chat completion.");
             throw new Error("No active LLM provider configuration found.");
        }

        const endpoint = activeConfig.endpointUrl;
        // Asume que todos usan /chat/completions para chat
        const chatEndpoint = endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`;

        // Preparar mensajes, incluyendo system prompt si existe
        const systemPromptText = this.config.systemPrompt;
        let messagesToSend: ChatMessage[] = [];
        if (systemPromptText) {
            messagesToSend = [{ role: 'system', content: systemPromptText }, ...messages];
            Logger.log(`[LlmService] Prepended system prompt.`);
        } else {
            messagesToSend = [...messages];
            Logger.log(`[LlmService] No system prompt configured.`);
        }

        // Preparar el payload final
        const payload = {
             model: activeConfig.modelName,
             messages: messagesToSend,
             temperature: this.config.temperature,
             max_tokens: this.config.maxTokens,
             // stream: false, // Descomenta si quieres forzar no streaming explícitamente
        };

        Logger.log(`>>> [LlmService] Attempting POST to: ${chatEndpoint}`);
        Logger.log(`>>> [LlmService] Sending chat request with model: ${payload.model}, messages: ${messagesToSend.length}`);
        // Loguear el payload completo (puede ser muy verboso, útil para debug)
        Logger.log(`>>> [LlmService] Payload being sent: ${JSON.stringify(payload)}`); // Sin indentación para menos espacio

        try {
            Logger.log(">>> [LlmService] BEFORE await axios.post");
            const response = await axios.post<ChatCompletionResponse>(
                 chatEndpoint,
                 payload,
                 {
                     headers: this.getHeaders(),
                     timeout: this.config.maxTokens > 512 ? 90000 : 60000 // Aumenta timeout si se piden muchos tokens
                 }
            );
            Logger.log(`>>> [LlmService] AFTER await axios.post. Status: ${response?.status}`);
            Logger.log(`>>> [LlmService] Type of response.data: ${typeof response.data}`);
            Logger.log(">>> [LlmService] Attempting to log raw response data safely...");
            Logger.log('Raw response data:', response?.data); // Loguear objeto directamente

            // Procesar la respuesta
            // Usar optional chaining extensivamente para evitar errores
            const content = response?.data?.choices?.[0]?.message?.content;

            if (typeof content === 'string') { // Verifica que content sea un string (no null o undefined)
                 Logger.log(`[LlmService] Received valid chat response content.`);
                 return content.trim();
            } else {
                // Loguear por qué se consideró inválido
                 if (!response?.data?.choices || response.data.choices.length === 0) {
                      Logger.warn("[LlmService] LLM API response missing or empty 'choices' array.");
                 } else if (!response.data.choices[0]?.message) {
                      Logger.warn("[LlmService] LLM API response choice missing 'message' object.");
                 } else {
                      Logger.warn("[LlmService] LLM API response choice message content is null or undefined.");
                 }
                 throw new Error('Invalid response structure from LLM API (content missing)');
            }

        } catch (error) {
             Logger.error(">>> [LlmService] ERROR caught in getChatCompletion"); // Log más específico
             // handleApiError logueará detalles y mostrará mensaje al usuario si es necesario
            this.handleApiError(error, 'Chat Completion');
             throw error; // Re-lanza para que ChatViewProvider lo maneje
        }
        // Esta línea no debería alcanzarse debido a los throws, pero satisface a TS
        // throw new Error("LlmService.getChatCompletion ended unexpectedly.");
    }

    /** Obtiene una completación de código desde el LLM activo. */
    async getCodeCompletion(prompt: string, suffix?: string): Promise<string> {
        const activeConfig = this.config.getActiveProviderConfig();
        if (!this.config.isCompletionEnabled || !activeConfig) {
            Logger.log("[LlmService] Code completion disabled or no active provider.");
            return '';
        }

        const endpoint = activeConfig.endpointUrl;
        // --- Decisión de Endpoint para Completion (REQUIERE AJUSTE PROBABLEMENTE) ---
        // Esto es simplista. Idealmente, decidirías basado en activeConfig.providerId o capacidades del modelo.
        // OpenAI /v1/completions es legacy. Ollama tiene /api/generate. OpenRouter usa /chat/completions.
        // Por ahora, intentaremos /completions y si falla, ¿quizás adaptar para /chat/completions?
        let completionEndpoint = endpoint.endsWith('/') ? `${endpoint}completions` : `${endpoint}/completions`;
        let isChatCompletionFallback = false;

        const payload = {
             model: activeConfig.modelName,
             // Para /completions
             prompt: prompt,
             suffix: suffix,
             // Para /chat/completions (si se usa como fallback)
             // messages: [{ role: 'user', content: `Complete the following code:\n${prompt}` }], // Ejemplo de cómo adaptar
             temperature: this.config.temperature,
             max_tokens: Math.min(this.config.maxTokens, 150), // Limitar tokens para completion
             stop: ["\n\n", "\n\t\n"],
             // stream: false,
         };
        // Eliminar 'messages' si usamos el endpoint /completions
        // delete payload.messages;

        Logger.log(`>>> [LlmService] Attempting Completion POST to: ${completionEndpoint}`);
        Logger.log(`Sending code completion request for model ${payload.model}`);
        Logger.log(`>>> [LlmService] Completion Payload: ${JSON.stringify(payload)}`);

         try {
             const response = await axios.post<CodeCompletionResponse | ChatCompletionResponse>( // Permitir ambos tipos de respuesta
                 completionEndpoint,
                 payload,
                 {
                     headers: this.getHeaders(),
                     timeout: 20000 // Timeout más corto para completion
                 }
             );
              Logger.log(`>>> [LlmService] Raw completion response data: ${JSON.stringify(response.data, null, 2)}`);

             // Intentar extraer 'text' (de /completions) o 'content' (de /chat/completions)
             const completionData = response.data as any; // Usar 'any' temporalmente para flexibilidad
             const text = completionData?.choices?.[0]?.text ?? completionData?.choices?.[0]?.message?.content;

             if (typeof text === 'string') {
                 Logger.log(`[LlmService] Received valid code completion.`);
                 return text.trim();
             } else {
                  Logger.warn("[LlmService] Invalid or empty response structure from LLM API (Completion).");
                  return ''; // Devolver vacío si no hay sugerencia válida
             }

         } catch (error) {
             Logger.warn(`[LlmService] Code completion request to ${completionEndpoint} failed.`);
             // Aquí podrías implementar lógica de fallback para intentar con /chat/completions si el error fue 404
             // if (axios.isAxiosError(error) && error.response?.status === 404) { /* try chat endpoint */ }
             this.handleApiError(error, 'Code Completion', false); // No molestar al usuario por fallos de completion
             return '';
         }
    }

    /** Maneja errores de Axios y otros, loguea detalles y opcionalmente notifica al usuario. */
    private handleApiError(error: any, context: string, showUserError: boolean = true): void {
        let errorMessage = `Error during ${context}: `;
        const activeConfig = this.config.getActiveProviderConfig();
        const endpointUsed = this.config.endpointUrl; // Obtener URL base para contexto

        if (axios.isAxiosError(error)) {
            const requestUrl = error.config?.url || endpointUsed; // URL específica si está disponible
            if (error.response) {
                // Log más detallado para errores con respuesta del servidor
                errorMessage += `API Error ${error.response.status} from ${requestUrl}. Response Data: ${JSON.stringify(error.response.data)}`;
            } else if (error.request) {
                // Error de red (no se recibió respuesta)
                errorMessage += `Network Error or Timeout for ${requestUrl}. Check endpoint URL and connectivity. Is the service running?`;
            } else {
                // Error al configurar la petición
                errorMessage += `Request Setup Error: ${error.message}`;
            }
            // Añadir detalles de la configuración de la petición para depuración
            if (error.config) {
               errorMessage += ` | Request Config: { Method: ${error.config.method}, Headers: ${JSON.stringify(error.config.headers)} }`;
            }
        } else if (error instanceof Error) { // Capturar otros errores de JavaScript
            errorMessage += `${error.name}: ${error.message}`;
            if (error.stack) { // Incluir stack trace si está disponible
                 errorMessage += `\nStack: ${error.stack}`;
            }
        } else { // Caso genérico para otros tipos de errores
            try { // Intentar convertir a string de forma segura
                 errorMessage += JSON.stringify(error);
            } catch {
                 errorMessage += String(error);
            }
        }

        Logger.error(errorMessage); // Usar console.error si reemplazaste Logger

        if (showUserError) {
            const providerName = activeConfig?.displayName || 'LLM';
            // Mostrar notificación genérica en VS Code
            vscode.window.showErrorMessage(`AIK-Pilot (${providerName}): Failed to ${context.toLowerCase()}. Check Output panel (AIK-Pilot / LLM Assistant channel) for details.`);
        }
    }
}