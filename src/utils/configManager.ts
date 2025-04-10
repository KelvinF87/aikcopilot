import * as vscode from 'vscode';

// Interfaz para la configuración de un proveedor individual
interface ProviderConfig {
    displayName: string;
    endpointUrl: string;
    modelName: string;
    apiKey: string | null; // Puede ser null si no se requiere
    customHeaders?: { [key: string]: string } | null; // Añadido para encabezados (ej. OpenRouter)
}

// Interfaz para el objeto completo de proveedores
interface ProvidersConfig {
    [providerId: string]: ProviderConfig;
}

export class ConfigManager {
    constructor() {
         console.log(">>> ConfigManager constructor CALLED");
    }

    private getConfig() {
        // Asegúrate que el prefijo sea el correcto para tu extensión
        return vscode.workspace.getConfiguration('aik-pilot');
    }

    // --- Nuevos métodos para manejar proveedores ---

    /** Obtiene el ID del proveedor activo (ej. 'ollama', 'openai'). */
    public get activeProviderId(): string {
        return this.getConfig().get<string>('activeProvider', 'ollama');
    }

    /** Obtiene el objeto completo con la configuración de todos los proveedores definidos. */
    public get allProvidersConfig(): ProvidersConfig {
         // Lee la configuración 'providers' o usa un valor por defecto robusto
         return this.getConfig().get<ProvidersConfig>('providers', {
             ollama: {
                 displayName: "Ollama (Local)",
                 endpointUrl: "http://localhost:11434/v1",
                 modelName: "llama3", // Modelo común para Ollama
                 apiKey: null,
                 customHeaders: null // Ollama no usa encabezados personalizados por defecto
             },
             openai: {
                 displayName: "OpenAI",
                 endpointUrl: "https://api.openai.com/v1",
                 modelName: "gpt-4o-mini", // Modelo económico y rápido de OpenAI
                 apiKey: "", // El usuario debe rellenar esto
                 customHeaders: null // OpenAI no usa estos encabezados personalizados por defecto
             },
             openrouter: {
                 displayName: "OpenRouter",
                 endpointUrl: "https://openrouter.ai/api/v1",
                 modelName: "mistralai/mistral-7b-instruct", // Modelo popular en OpenRouter
                 apiKey: "", // El usuario debe rellenar esto
                 customHeaders: { // Encabezados específicos de OpenRouter
                   "HTTP-Referer": "", // El usuario PUEDE rellenar esto (opcional)
                   "X-Title": "AIK-Pilot" // Nombre de tu extensión (opcional)
                 }
             }
         });
    }

    /** Obtiene la configuración específica del proveedor actualmente activo. */
    public getActiveProviderConfig(): ProviderConfig | undefined {
        const activeId = this.activeProviderId;
        const allConfigs = this.allProvidersConfig;
        // Comprobar si la configuración para el ID activo realmente existe
        if (allConfigs && Object.prototype.hasOwnProperty.call(allConfigs, activeId)) {
             return allConfigs[activeId];
        }
        console.warn(`[ConfigManager] Configuration for active provider ID "${activeId}" not found. Falling back to defaults.`);
        // Podrías devolver un default aquí o undefined
        return undefined;
    }

    /** Actualiza la configuración global para establecer el proveedor activo. */
    public async setActiveProviderId(providerId: string): Promise<void> {
        const allConfigs = this.allProvidersConfig;
        // Validación: Solo actualiza si el ID de proveedor existe en la configuración
        if (allConfigs && Object.prototype.hasOwnProperty.call(allConfigs, providerId)) {
            try {
                await this.getConfig().update('activeProvider', providerId, vscode.ConfigurationTarget.Global);
                console.log(`[ConfigManager] Active provider updated to: ${providerId}`);
                // Notificar a otros componentes si es necesario (ej. con un EventEmitter)
                // vscode.commands.executeCommand('aik-pilot.configChanged'); // Ejemplo
            } catch (error) {
                 console.error(`[ConfigManager] Failed to update active provider setting:`, error);
                 vscode.window.showErrorMessage(`Failed to save active LLM provider setting.`);
            }
        } else {
             console.error(`[ConfigManager] Attempted to set invalid provider ID: ${providerId}`);
             vscode.window.showWarningMessage(`Provider ID "${providerId}" is not recognized.`);
        }
    }

    // --- Métodos existentes ahora usan la configuración activa ---
     // *** NUEVO GETTER para System Prompt ***
    /**
     * Obtiene el system prompt configurado por el usuario.
     * Devuelve una cadena vacía si no está configurado o es null,
     * lo que efectivamente lo deshabilita.
     */
    get systemPrompt(): string {
        const prompt = this.getConfig().get<string | null>('systemPrompt');
        // Considerar null o undefined como cadena vacía (deshabilitado)
        return prompt?.trim() || '';
    }

    /** Obtiene la URL del endpoint para el proveedor activo. */
    get endpointUrl(): string {
        return this.getActiveProviderConfig()?.endpointUrl || 'http://localhost:11434/v1'; // Fallback seguro
    }

    /** Obtiene la API Key para el proveedor activo (devuelve string vacío si es null). */
    get apiKey(): string {
        return this.getActiveProviderConfig()?.apiKey || '';
    }

    /** Obtiene el nombre del modelo para el proveedor activo. */
    get modelName(): string {
        return this.getActiveProviderConfig()?.modelName || 'unknown'; // Fallback
    }

    /** Obtiene los encabezados personalizados para el proveedor activo. */
    get customHeaders(): { [key: string]: string } | null | undefined {
        return this.getActiveProviderConfig()?.customHeaders;
    }


    // --- Los demás getters (globales por ahora) ---
    /** Temperatura para la generación (global). */
    get temperature(): number {
        return this.getConfig().get<number>('temperature', 0.7);
    }

    /** Máximo de tokens a generar (global). */
    get maxTokens(): number {
        return this.getConfig().get<number>('maxTokens', 512);
    }

    /** Indica si el autocompletado está habilitado (global). */
    get isCompletionEnabled(): boolean {
        return this.getConfig().get<boolean>('completion.enabled', true);
    }

    /** Delay (ms) para el debounce del autocompletado (global). */
    get completionDebounceMs(): number {
        const value = this.getConfig().get<number>('completion.debounceMs', 300);
        return Math.max(50, value); // Asegurar un mínimo de 50ms
    }
}