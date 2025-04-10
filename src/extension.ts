import * as vscode from 'vscode'; // Asegurar import de vscode
import { ChatViewProvider } from './chat/chatViewProvider'; // Importar ChatViewProvider
import { CompletionProvider } from './providers/completionProvider'; // Importar CompletionProvider (asegura que el archivo exista)
import { LlmService } from './llmService'; // Importar LlmService
import { ConfigManager } from './utils/configManager'; // Importar ConfigManager
// Asegúrate de tener un logger o usa console.log/error
// import { Logger } from './utils/logger';
const Logger = console; // Usar console como fallback

// ***** SÓLO UNA FUNCIÓN ACTIVATE *****
export function activate(context: vscode.ExtensionContext) {
    Logger.log('!!! activate STARTING !!!');

    // Logger.init(); // Si usas logger propio

    // --- Instanciación en orden correcto ---
    Logger.log('Attempting to create ConfigManager...');
    // Usa el nombre de la CLASE para instanciar
    const configManager = new ConfigManager();
    Logger.log('ConfigManager instance CREATED.');

    Logger.log('Attempting to create LlmService...');
     // Usa el nombre de la CLASE para instanciar, pasa la instancia configManager
    const llmService = new LlmService(configManager);
    Logger.log('LlmService instance CREATED.');

    Logger.log('Attempting to create ChatViewProvider...');
    // Usa el nombre de la CLASE para instanciar
    const chatProvider = new ChatViewProvider(context.extensionUri, llmService, configManager);
    Logger.log('ChatViewProvider instance CREATED.');

    Logger.log('Attempting to create CompletionProvider...');
    // Usa el nombre de la CLASE para instanciar
    const completionProvider = new CompletionProvider(llmService, configManager);
    Logger.log('CompletionProvider instance CREATED.');
    // --- Fin Instanciación ---


    // --- Registro de Proveedores y Comandos ---
    Logger.log(`>>> Registering WebviewViewProvider for viewType: '${ChatViewProvider.viewType}'`);
    try {
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                 // Usa la propiedad estática de la CLASE importada
                ChatViewProvider.viewType,
                chatProvider // Pasa la INSTANCIA
            )
        );
        Logger.log(`>>> registerWebviewViewProvider call SUCCEEDED for '${ChatViewProvider.viewType}'`);
    } catch (error) {
        Logger.error(`>>> registerWebviewViewProvider call FAILED for '${ChatViewProvider.viewType}':`, error);
    }

    Logger.log(">>> Registering CompletionProvider...");
    try {
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                 { scheme: 'file' }, // Aplicar a archivos
                 completionProvider, // Pasa la INSTANCIA
                 '.' // Trigger character (opcional)
            )
        );
         Logger.log(">>> CompletionProvider registered.");
    } catch (error) {
         Logger.error(`>>> CompletionProvider registration FAILED:`, error);
    }


    Logger.log(">>> Registering 'aik-pilot.helloWorld' command...");
    try {
        let helloWorldCommand = vscode.commands.registerCommand('aik-pilot.helloWorld', () => {
           vscode.window.showInformationMessage('Hello World from AIK-Pilot!');
       });
       context.subscriptions.push(helloWorldCommand);
       Logger.log(">>> 'aik-pilot.helloWorld' command registered.");
    } catch (error) {
        Logger.error(`>>> 'aik-pilot.helloWorld' command registration FAILED:`, error);
    }
    // --- Fin Registro ---

    Logger.log('!!! activate FINISHED !!!');
}
// ***** FIN FUNCIÓN ACTIVATE *****


// Función deactivate (opcional pero buena práctica)
export function deactivate() {
    Logger.log('!!! deactivate CALLED !!!');
}