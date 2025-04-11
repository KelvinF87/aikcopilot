// src/chat/webview/main.js (CORREGIDO)

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    // const previousState = vscode.getState() || { messages: [] }; // Descomentar si implementas guardado de estado
    console.log('[Webview] main.js iniciado.');

    // --- Referencias DOM ---
    const messageList = document.getElementById('message-list');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const statusArea = document.getElementById('status-area');
    const providerSelector = document.getElementById('provider-selector');
    const newChatButton = document.getElementById('new-chat-button');
    const exportChatButton = document.getElementById('export-chat-button');
    const settingsButton = document.getElementById('settings-button');

    // --- Verificación DOM ---
    if (!messageList || !userInput || !sendButton || !statusArea || !providerSelector || !newChatButton || !exportChatButton || !settingsButton) {
        console.error('[Webview] ERROR CRÍTICO: Faltan elementos DOM esenciales.');
        if (messageList) messageList.innerHTML = '<p style="color: red; font-weight: bold;">Error: UI no inicializada.</p>';
        return;
    }
    console.log('[Webview] Elementos DOM esenciales encontrados.');

    // --- Funciones Auxiliares ---

    function escapeHtml(unsafe) { /* ... tu función escapeHtml ... */
        if (!unsafe) return '';
        return unsafe
             .replace(/&/g, "&") // Debe ir primero
             .replace(/</g, "<")
             .replace(/>/g, ">")
             .replace(/"/g, "\"")
             .replace(/'/g, "'");
     }

    function renderMessageContent(container, text) { /* ... tu función renderMessageContent ... */
        container.innerHTML = '';
        const parts = text.split(/(```[\s\S]*?```)/g);
        parts.forEach(part => {
            if (part && part.startsWith('```') && part.endsWith('```')) {
                const codeContent = part.substring(3, part.length - 3);
                let language = '';
                let actualCode = codeContent.trimStart();
                const firstLineEnd = actualCode.indexOf('\n');
                let potentialLang = (firstLineEnd !== -1) ? actualCode.substring(0, firstLineEnd).trim() : actualCode.trim();
                if (potentialLang && !potentialLang.includes(' ') && potentialLang.length < 20) {
                    language = potentialLang.toLowerCase();
                    actualCode = (firstLineEnd !== -1) ? actualCode.substring(firstLineEnd + 1) : (potentialLang === actualCode ? '' : actualCode);
                }
                const codeWrapper = document.createElement('div');
                codeWrapper.className = 'code-block-wrapper';
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                if (language) code.className = `language-${language}`;
                code.textContent = actualCode;
                pre.appendChild(code);
                const copyButton = document.createElement('button');
                copyButton.textContent = 'Copiar';
                copyButton.className = 'copy-code-button';
                copyButton.title = 'Copiar código';
                copyButton.dataset.code = actualCode;
                codeWrapper.appendChild(pre);
                codeWrapper.appendChild(copyButton);
                container.appendChild(codeWrapper);
            } else if (part && part.trim()) {
                const p = document.createElement('p');
                p.innerHTML = escapeHtml(part.trim()).replace(/\n/g, '<br>');
                container.appendChild(p);
            }
        });
     }

    function upsertMessageUI(sender, text, messageId = null, chunk = null) { /* ... tu función upsertMessageUI ... */
        if (!messageList) return;
        let messageDiv = messageId ? document.getElementById(messageId) : null;

        if (messageDiv && chunk !== null) {
            // Actualizar Stream
            let lastContentElement = messageDiv.querySelector('p:last-of-type, pre:last-of-type code');
            if (!lastContentElement) {
                 // Si el mensaje bot se creó vacío, añadir un párrafo para el primer chunk
                 lastContentElement = document.createElement('p');
                 messageDiv.appendChild(lastContentElement);
            }
             // Escapar el chunk si es necesario antes de añadirlo
             // lastContentElement.textContent += escapeHtml(chunk); // O simplemente chunk si confías en la fuente
             lastContentElement.textContent += chunk;
             // console.log(`[Webview] Chunk añadido a mensaje ID: ${messageId}`); // Log verboso

        } else if (!messageDiv && messageId && sender === 'bot') {
             // Crear Placeholder Bot
             messageDiv = document.createElement('div');
             messageDiv.id = messageId;
             messageDiv.className = 'message bot-message';
             renderMessageContent(messageDiv, text); // Renderizar texto inicial (vacío)
             messageList.appendChild(messageDiv);
             // console.log(`[Webview] Mensaje BOT (placeholder) creado con ID: ${messageId}`);

        } else if (sender === 'user') {
            // Crear Mensaje Usuario
            messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.textContent = text; // Usuario es texto plano
            messageList.appendChild(messageDiv);
            console.log(`[Webview] Mensaje USER añadido a la UI.`);

        } else if (sender === 'error') {
             // Crear Mensaje Error
            messageDiv = document.createElement('div');
            if (messageId) messageDiv.id = messageId;
            messageDiv.className = 'message bot-message error-message'; // Añadir clase error
            messageDiv.style.color = 'var(--vscode-errorForeground)';
            // Podrías usar renderMessageContent si los errores pueden tener formato
            messageDiv.textContent = `Error: ${text}`;
            messageList.appendChild(messageDiv);
            console.log(`[Webview] Mensaje ERROR añadido a la UI.`);
        }

        if (messageDiv || chunk) {
           messageList.scrollTo({ top: messageList.scrollHeight, behavior: 'smooth' });
        }
    }

    function showThinkingIndicator(isThinking) { /* ... tu función showThinkingIndicator ... */
        if (!statusArea) return;
        statusArea.style.display = isThinking ? 'block' : 'none';
     }

    // --- Event Listeners ---
    if (sendButton) { /* ... listener existente ... */
        sendButton.addEventListener('click', () => {
            const text = userInput?.value?.trim();
            if (text) { upsertMessageUI('user', text); vscode.postMessage({ command: 'sendMessage', text: text }); if (userInput instanceof HTMLTextAreaElement) { userInput.value = ''; userInput.focus(); } }
        });
     }
    if (userInput instanceof HTMLTextAreaElement) { /* ... listener existente ... */
        userInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendButton?.click(); } });
     }
    if (providerSelector instanceof HTMLSelectElement) { /* ... listener existente ... */
        providerSelector.addEventListener('change', (event) => { const id = event.target.value; if(id) vscode.postMessage({ command: 'setActiveProvider', providerId: id }); });
     }
    if (newChatButton) { /* ... listener existente ... */
        newChatButton.addEventListener('click', () => vscode.postMessage({ command: 'clearChat' }));
     }
    if (exportChatButton) { /* ... listener existente ... */
        exportChatButton.addEventListener('click', () => vscode.postMessage({ command: 'exportChat' }));
     }
    if (settingsButton) { /* ... listener existente ... */
        settingsButton.addEventListener('click', () => vscode.postMessage({ command: 'openSettings' }));
     }
    if (messageList) { /* ... listener de copia existente ... */
        messageList.addEventListener('click', (event) => {
            const target = event.target;
            if (target && target.classList.contains('copy-code-button') && target.dataset.code) {
                navigator.clipboard.writeText(target.dataset.code).then(() => {
                    target.textContent = 'Copiado!'; target.disabled = true;
                    setTimeout(() => { target.textContent = 'Copiar'; target.disabled = false; }, 1500);
                }).catch(err => { target.textContent = 'Error'; setTimeout(() => { target.textContent = 'Copiar'; }, 2000);});
            }
        });
     }

    // --- Listener Mensajes desde Extensión ---
    window.addEventListener('message', event => {
        const message = event.data;
        console.log(`[Webview] ====> Mensaje recibido: Comando='${message.command}'`, message);

        switch (message.command) {
            case 'addMessage':
                console.log(`[Webview] Procesando 'addMessage'. Sender: ${message.sender}, ID: ${message.messageId}`);
                upsertMessageUI(message.sender, message.text, message.messageId);
                break;

            case 'updateMessageStream':
                // console.log(`[Webview] Procesando 'updateMessageStream' para ID: ${message.messageId}`); // Log verboso
                if (message.messageId && typeof message.chunk === 'string') {
                     upsertMessageUI('bot', '', message.messageId, message.chunk);
                } else { console.warn('[Webview] Comando updateMessageStream incompleto:', message); }
                break;

            case 'streamComplete':
                 console.log(`[Webview] Procesando 'streamComplete' para ID: ${message.messageId}`);
                 const finalMessageDiv = document.getElementById(message.messageId);
                 if (finalMessageDiv) {
                     // Extraer texto acumulado (estrategia simple)
                     let accumulatedText = '';
                     // Iterar sobre los nodos hijos para construir el texto (un poco más robusto)
                     finalMessageDiv.childNodes.forEach(node => {
                         if (node.nodeType === Node.TEXT_NODE) {
                             accumulatedText += node.textContent;
                         } else if (node.nodeName === 'P') {
                             accumulatedText += node.textContent + '\n'; // Añadir salto de línea entre párrafos
                         } else if (node.classList && node.classList.contains('code-block-wrapper')) {
                             const codeEl = node.querySelector('pre code');
                             const lang = codeEl?.className.replace('language-', '') || '';
                             accumulatedText += `\n\`\`\`${lang}\n${codeEl?.textContent || ''}\n\`\`\`\n`;
                         }
                     });
                     console.log("[Webview] Re-renderizando contenido final del mensaje stream...");
                     renderMessageContent(finalMessageDiv, accumulatedText.trim()); // Re-renderizar con formato
                 }
                 break;

            case 'showThinking': if (typeof message.thinking === 'boolean') showThinkingIndicator(message.thinking); break;
            case 'showError': if (typeof message.text === 'string') upsertMessageUI('error', message.text, message.messageId); showThinkingIndicator(false); break;
            case 'clearChat': if (messageList) messageList.innerHTML = ''; console.log('[Webview] UI Chat limpiada.'); break;

            // ***** LÓGICA CORREGIDA PARA SETINITIALDATA *****
            case 'setInitialData':
                console.log(`[Webview] Procesando comando 'setInitialData'. Mensaje completo recibido:`, message);
                console.log(`[Webview]   > message.providers:`, message.providers);
                console.log(`[Webview]   > Array.isArray(message.providers):`, Array.isArray(message.providers));
                console.log(`[Webview]   > message.activeProviderId:`, message.activeProviderId);
                console.log(`[Webview]   > providerSelector es HTMLSelectElement:`, providerSelector instanceof HTMLSelectElement);

                // Comprobar explícitamente las condiciones
                const isValidSelector = providerSelector instanceof HTMLSelectElement;
                const hasValidProviders = message.providers && Array.isArray(message.providers);

                if (isValidSelector && hasValidProviders) {
                    console.log("[Webview] Condición IF para poblar selector es TRUE.");
                    // Limpiar opciones (excepto si hubiera una opción placeholder intencional)
                    while (providerSelector.options.length > 0) {
                        providerSelector.remove(0);
                    }
                    console.log("[Webview] Opciones previas limpiadas.");

                    // Añadir nuevas opciones
                    if (message.providers.length === 0) {
                        console.warn("[Webview] La lista de proveedores recibida está vacía.");
                        // Opcional: añadir una opción indicando que no hay proveedores
                        const option = document.createElement('option');
                        option.value = "";
                        option.textContent = "No providers configured";
                        option.disabled = true;
                        providerSelector.appendChild(option);
                    } else {
                        message.providers.forEach(provider => {
                            if (provider && provider.id) { // Verificar que el provider y su ID existen
                                console.log(`[Webview] Añadiendo opción: ID=${provider.id}, Display=${provider.displayName || provider.id}`);
                                const option = document.createElement('option');
                                option.value = provider.id;
                                option.textContent = provider.displayName || provider.id; // Usar ID si no hay displayName
                                providerSelector.appendChild(option);
                            } else {
                                console.warn("[Webview] Proveedor inválido encontrado en la lista:", provider);
                            }
                        });
                    }

                    // Establecer la opción activa
                    if (message.activeProviderId && providerSelector.options.length > 0) {
                         // Intentar seleccionar por valor
                         providerSelector.value = message.activeProviderId;
                         // Verificar si la selección funcionó (si el value existe en las options)
                         if (providerSelector.value !== message.activeProviderId && providerSelector.options.length > 0) {
                             console.warn(`[Webview] ID activo '${message.activeProviderId}' no encontrado en las opciones. Seleccionando el primero.`);
                              providerSelector.selectedIndex = 0; // Fallback a la primera opción
                         } else {
                             console.log(`[Webview] Intentando setear activo: ${message.activeProviderId} (Resultado: ${providerSelector.value})`);
                         }
                    } else if (providerSelector.options.length > 0) {
                        console.log("[Webview] No hay ID activo válido, seleccionando primero.");
                        providerSelector.selectedIndex = 0; // Seleccionar el primero si no hay ID activo
                    }
                    console.log(`[Webview] Selector poblado. Opciones: ${providerSelector.options.length}. Valor actual: ${providerSelector.value}`);
                } else {
                    console.warn('[Webview] Condición IF para poblar selector es FALSE. No se poblará.');
                    console.warn('   Detalles:', {
                        isValidSelector: isValidSelector,
                        hasProviders: !!message.providers,
                        isArray: Array.isArray(message.providers)
                    });
                    // Opcional: Mostrar un estado de error en el selector si falla
                    providerSelector.innerHTML = '<option value="" disabled>Error loading providers</option>';
                }
                break;
            // ***** FIN LÓGICA CORREGIDA *****

            default: console.warn(`[Webview] Comando DESCONOCIDO recibido:`, message); break;
        }
         console.log(`[Webview] <==== Procesamiento del comando '${message.command}' finalizado.`);
    });

    // --- Inicialización ---
    if (userInput) userInput.focus();
    console.log('[Webview] Listeners configurados y listo.');

})();