// src/llmService.ts

import axios, { AxiosError } from 'axios';
import * as vscode from 'vscode';
import { ConfigManager } from './utils/configManager';
import { PassThrough } from 'stream'; // Importar PassThrough

const Logger = console;

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

// Interfaces simplificadas para respuestas
interface StreamDelta {
    content?: string | null;
}
interface StreamChoice {
    delta: StreamDelta;
    finish_reason?: string | null;
    index: number;
}
interface StreamResponseChunk {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices: StreamChoice[];
}
interface NonStreamChoice {
    message?: { content: string | null; };
    text?: string | null; // Legacy
    finish_reason?: string;
    index: number;
}
interface NonStreamResponse {
     id?: string;
     object?: string;
     created?: number;
     model?: string;
    choices: NonStreamChoice[];
    // usage?: {...}
}


export class LlmService {
    private config: ConfigManager;

    constructor(configManager: ConfigManager) {
        this.config = configManager;
        Logger.log("[LlmService] Construido.");
    }

    // --- Headers ---
    private getHeaders(): Record<string, string> {
        // ... (código existente para getHeaders) ...
        const activeConfig = this.config.getActiveProviderConfig();
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }; // Aceptar SSE
        const apiKey = activeConfig?.apiKey;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const customHeaders = activeConfig?.customHeaders;
        if (customHeaders) Object.entries(customHeaders).forEach(([k, v]) => { if (v) headers[k] = v; });
        return headers;
    }

    // --- Chat Completion (AHORA CON STREAMING) ---
    async getChatCompletion(
        messages: ChatMessage[],
        onStreamChunk: (chunk: string) => void,
        onStreamEnd: (error?: Error) => void
    ): Promise<void> { // Devuelve Promise<void>
        const activeConfig = this.config.getActiveProviderConfig();
        if (!activeConfig) {
            onStreamEnd(new Error("No hay configuración de proveedor LLM activa."));
            return;
        }

        const endpoint = activeConfig.endpointUrl;
        // Asegurarse de que el endpoint sea el correcto para chat (usualmente termina en /v1)
        const chatEndpoint = endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`;
        Logger.log(`>>> [LlmService] POST STREAM Chat a: ${chatEndpoint}`);

        const systemPromptText = this.config.systemPrompt;
        let messagesToSend: ChatMessage[] = systemPromptText ? [{ role: 'system', content: systemPromptText }, ...messages] : [...messages];

        const payload = {
             model: activeConfig.modelName,
             messages: messagesToSend,
             temperature: this.config.temperature,
             max_tokens: this.config.maxTokens, // El servidor puede ignorarlo en stream, pero lo enviamos
             stream: true // <-- ACTIVAR STREAMING
        };
        Logger.log(`>>> [LlmService] Payload Stream Chat (modelo: ${payload.model}, mensajes: ${messagesToSend.length})`);

        let responseStream: PassThrough | null = null; // Variable para mantener el stream

        try {
            const response = await axios.post<PassThrough>(
                 chatEndpoint,
                 payload,
                 {
                     headers: this.getHeaders(),
                     responseType: 'stream', // <-- INDICAR TIPO STREAM
                     timeout: 120000 // Timeout más largo para streams (2 minutos)
                 }
            );

            responseStream = response.data;
            let buffer = ''; // Buffer para datos parciales SSE

            responseStream.on('data', (chunk) => {
                buffer += chunk.toString('utf-8');
                // Logger.log("RAW CHUNK:", buffer); // Depuración intensa

                let boundary = buffer.indexOf('\n\n');
                while (boundary >= 0) {
                    const message = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2); // Consumir mensaje + delimitador

                    if (message.startsWith('data: ')) {
                        const dataString = message.substring(6);
                        if (dataString === '[DONE]') {
                            // Logger.log("[LlmService] Stream [DONE] marker received.");
                            // No finalizar aquí, esperar evento 'end'
                            continue;
                        }
                        try {
                            const parsed: StreamResponseChunk = JSON.parse(dataString);
                            const deltaContent = parsed.choices?.[0]?.delta?.content;
                            if (typeof deltaContent === 'string') {
                                onStreamChunk(deltaContent); // Enviar trozo válido
                            }
                            // Opcional: verificar finish_reason si es necesario
                            // if (parsed.choices?.[0]?.finish_reason) {
                            //     Logger.log("[LlmService] Finish reason received:", parsed.choices[0].finish_reason);
                            // }
                        } catch (parseError) {
                            Logger.error('[LlmService] Error parseando JSON del stream:', dataString, parseError);
                        }
                    } else if (message.trim()) {
                        // Ignorar líneas vacías o comentarios SSE (si los hubiera)
                        // Logger.warn("[LlmService] Received non-data line in stream:", message);
                    }
                    boundary = buffer.indexOf('\n\n'); // Buscar siguiente delimitador
                }
            });

            responseStream.on('end', () => {
                Logger.log("[LlmService] Stream finalizado (evento 'end').");
                if (buffer.trim()) { // Procesar cualquier dato restante en el buffer
                    Logger.warn("[LlmService] Procesando datos restantes en buffer al finalizar stream:", buffer);
                     if (buffer.startsWith('data: ')) { /* ... lógica de parseo similar a 'on data' ... */ }
                }
                onStreamEnd(); // Señalar fin exitoso
            });

            responseStream.on('error', (streamError) => {
                Logger.error("[LlmService] Error durante el stream:", streamError);
                onStreamEnd(streamError instanceof Error ? streamError : new Error('Error desconocido en stream'));
            });

        } catch (error) {
             Logger.error(">>> [LlmService] ERROR iniciando petición de stream Chat");
             if (!responseStream) { // Si el error fue ANTES de obtener el stream
                 this.handleApiError(error, 'Chat Completion (Stream Init)', true); // Mostrar error al usuario
                 onStreamEnd(error instanceof Error ? error : new Error('Fallo al iniciar stream'));
             } else { // Si el error es de Axios pero el stream ya estaba (raro)
                 this.handleApiError(error, 'Chat Completion (Stream Request)', true);
                 // El evento 'error' del stream probablemente ya llamó a onStreamEnd
             }
        }
    }


    // --- Code Completion (NO STREAMING por ahora) ---
    async getCodeCompletion(prompt: string): Promise<string> {
         // ... (Código existente de getCodeCompletion, optimizado para velocidad) ...
        const activeConfig = this.config.getActiveProviderConfig();
        if (!this.config.isCompletionEnabled || !activeConfig) {
            Logger.log("[LlmService] Autocompletado desactivado o sin proveedor.");
            return '';
        }

        const endpoint = activeConfig.endpointUrl;
        // Usar Chat endpoint como default, es más probable que funcione con modelos modernos
        let completionEndpoint = endpoint.endsWith('/') ? `${endpoint}chat/completions` : `${endpoint}/chat/completions`;
        let useChatFormat = true;

        const maxCompletionTokens = 100;
        const stopSequences = ["\n\n", "\n```", "\n//", "\n#", "\n/*", "\n<!--", "});", "/>"];

        let payload: any;
        if (useChatFormat) {
            payload = {
                 model: activeConfig.modelName,
                 messages: [{ role: 'user', content: prompt }], // Prompt adaptado
                 temperature: Math.max(0, Math.min(1, this.config.temperature - 0.2)),
                 max_tokens: maxCompletionTokens,
                 stop: stopSequences,
                 stream: false // NO hacer stream para completado
            };
        } else { /* ... payload legacy ... */ }

        Logger.log(`>>> [LlmService] POST Completado a: ${completionEndpoint}`);
         try {
             const response = await axios.post<NonStreamResponse>( // Espera respuesta no-stream
                 completionEndpoint,
                 payload,
                 { headers: this.getHeaders(), timeout: 15000 } // Timeout corto
             );
             const choice = response?.data?.choices?.[0];
             const text = useChatFormat ? choice?.message?.content : choice?.text;
             if (typeof text === 'string') return text;
             else { Logger.warn("[LlmService] Respuesta inválida de API Completado."); return ''; }
         } catch (error) {
             Logger.warn(`[LlmService] Error en petición de completado a ${completionEndpoint}`);
             this.handleApiError(error, 'Code Completion', false); // No mostrar error a usuario
             return '';
         }
    }

    // --- Manejo de Errores ---
    private handleApiError(error: any, context: string, showUserError: boolean = true): void {
        // ... (código existente de handleApiError) ...
         let errorMessage = `Error durante ${context}: `;
         const activeConfig = this.config.getActiveProviderConfig();
         const providerName = activeConfig?.displayName || 'LLM';

         if (axios.isAxiosError(error)) {
             const requestUrl = error.config?.url || 'N/A';
             if (error.response) errorMessage += `API Error ${error.response.status} desde ${requestUrl}. Data: ${JSON.stringify(error.response.data)}`;
             else if (error.request) errorMessage += `Error de Red/Timeout para ${requestUrl}.`;
             else errorMessage += `Error configurando petición: ${error.message}`;
         } else if (error instanceof Error) errorMessage += `${error.name}: ${error.message}`;
         else errorMessage += String(error);

         Logger.error(errorMessage); // Loguear siempre

         if (showUserError) {
             vscode.window.showErrorMessage(`AIK-Pilot (${providerName}): Fallo en ${context.toLowerCase()}. Revisa Output > AIK-Pilot.`);
         }
    }
}