// main.js (WebView-side script)

(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    console.log('[Webview] main.js script started executing.');

    // --- Referencias DOM ---
    const messageList = document.getElementById('message-list');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const statusArea = document.getElementById('status-area');
    const providerSelector = document.getElementById('provider-selector');

    // --- Verificación DOM ---
    if (!messageList || !userInput || !sendButton || !statusArea || !providerSelector) {
        console.error('[Webview] CRITICAL ERROR: Could not find essential DOM elements.');
        if (messageList) {
           messageList.innerHTML = '<p style="color: red;">Error: UI elements missing.</p>';
        }
        return;
    }
    console.log('[Webview] Essential DOM elements found.');


    // --- Función para añadir mensajes a la lista en la UI ---
    // ***** MODIFICADA para formatear código y añadir botón *****
    function addMessageToUI(sender, text) {
        if (!messageList) return;

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        if (sender === 'user') {
            messageDiv.classList.add('user-message');
            messageDiv.textContent = text; // Seguro para user input
        } else if (sender === 'bot') {
            messageDiv.classList.add('bot-message');
            // Procesar texto para bloques de código Markdown
            const parts = text.split(/(```[\s\S]*?```)/g); // Separa por bloques de código ```
            parts.forEach(part => {
                if (part.startsWith('```') && part.endsWith('```')) {
                    const codeWrapper = document.createElement('div');
                    codeWrapper.classList.add('code-block-wrapper');

                    const pre = document.createElement('pre');
                    const code = document.createElement('code');

                    // Extraer lenguaje (opcional) y código limpio
                    const lines = part.substring(3, part.length - 3).split('\n');
                    let language = '';
                    let codeContent = part.substring(3, part.length - 3); // Default si no hay lenguaje

                    if (lines.length > 0 && lines[0].trim().length > 0 && !lines[0].includes(' ')) {
                        // Asume que la primera línea es el lenguaje si no tiene espacios
                        language = lines[0].trim();
                        codeContent = lines.slice(1).join('\n');
                         if(language){ // Añadir clase de lenguaje si existe
                             code.classList.add(`language-${language}`);
                         }
                    }

                    code.textContent = codeContent; // Asignar código limpio
                    pre.appendChild(code);

                    // Crear botón de copia
                    const copyButton = document.createElement('button');
                    copyButton.textContent = 'Copy';
                    copyButton.className = 'copy-code-button';
                    // Guardar el código a copiar en un atributo data-*
                    copyButton.dataset.code = codeContent;

                    codeWrapper.appendChild(pre);
                    codeWrapper.appendChild(copyButton);
                    messageDiv.appendChild(codeWrapper); // Añadir wrapper al mensaje

                } else if (part.trim()) {
                    // Parte de texto normal
                    const textNode = document.createElement('p'); // Usar párrafos para texto normal
                    textNode.style.margin = '0 0 5px 0'; // Añadir algo de margen
                    textNode.textContent = part;
                    messageDiv.appendChild(textNode);
                }
            });
        } else if (sender === 'error') {
            messageDiv.classList.add('bot-message');
            messageDiv.style.color = 'var(--vscode-errorForeground)';
            messageDiv.textContent = `Error: ${text}`;
        }

        messageList.appendChild(messageDiv);
        messageList.scrollTop = messageList.scrollHeight;
        console.log(`[Webview] Added ${sender} message to UI (processed code blocks).`);
    }

    // --- Función para mostrar/ocultar el indicador "Thinking..." ---
    function showThinkingIndicator(isThinking) { /* ... sin cambios ... */
         if (!statusArea) return;
         statusArea.style.display = isThinking ? 'block' : 'none';
         console.log(`[Webview] Thinking indicator set to: ${isThinking}`);
     }

    // --- Listener Botón Enviar ---
    if (sendButton) { /* ... sin cambios ... */
        sendButton.addEventListener('click', () => {
            const text = userInput?.value?.trim();
            console.log('[Webview] Send button clicked.');
            if (text) {
                console.log(`[Webview] Sending message: "${text}"`);
                vscode.postMessage({ command: 'sendMessage', text: text });
                if (userInput instanceof HTMLTextAreaElement) {
                   userInput.value = '';
                   userInput.focus();
                }
            } else {
                console.log('[Webview] User input was empty, not sending.');
            }
       });
    }

    // --- Listener Tecla Enter ---
    if (userInput instanceof HTMLElement) { /* ... sin cambios ... */
        userInput.addEventListener('keydown', (event) => {
            if (event.target === userInput && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (sendButton) { sendButton.click(); }
            }
        });
     }

    // --- Listener Cambio de Proveedor ---
    if (providerSelector instanceof HTMLSelectElement) { /* ... sin cambios ... */
        providerSelector.addEventListener('change', (event) => {
            const selectElement = event.target; // No necesita 'as'
            const newProviderId = selectElement.value;
            if (newProviderId) {
                console.log(`[Webview] Provider selection changed to: ${newProviderId}. Sending to extension.`);
                vscode.postMessage({ command: 'setActiveProvider', providerId: newProviderId });
            }
        });
    }

    // ***** NUEVO: Listener para botones de Copia (usando delegación) *****
    messageList.addEventListener('click', (event) => {
        // Comprobar si el clic fue en un botón de copia
        const target = event.target;
        if (target && target.classList.contains('copy-code-button')) {
            const codeToCopy = target.dataset.code;
            if (codeToCopy) {
                navigator.clipboard.writeText(codeToCopy)
                    .then(() => {
                        console.log('[Webview] Code copied to clipboard.');
                        target.textContent = 'Copied!'; // Feedback visual
                        target.classList.add('copied');
                        // Volver al texto original después de un tiempo
                        setTimeout(() => {
                            target.textContent = 'Copy';
                            target.classList.remove('copied');
                        }, 1500); // 1.5 segundos
                    })
                    .catch(err => {
                        console.error('[Webview] Failed to copy code:', err);
                        target.textContent = 'Error'; // Indicar error
                         setTimeout(() => { target.textContent = 'Copy'; }, 1500);
                    });
            } else {
                console.warn('[Webview] Copy button clicked, but no code found in data attribute.');
            }
        }
    });


    // --- Listener Mensajes desde Extensión ---
    window.addEventListener('message', event => { /* ... sin cambios ... */
        const message = event.data;
         console.log('[Webview] Received message from extension:', message);
         switch (message.command) {
             case 'addMessage':
                 if (message.sender && typeof message.sender === 'string' && message.text && typeof message.text === 'string') {
                      addMessageToUI(message.sender, message.text); // LLAMAR A LA NUEVA FUNCIÓN
                 } else { console.warn('[Webview] Received incomplete addMessage command:', message); }
                 break;
             case 'showThinking':
                 showThinkingIndicator(message.thinking);
                 break;
             case 'showError':
                  if (message.text && typeof message.text === 'string') { addMessageToUI('error', message.text); }
                  else { console.warn('[Webview] Received incomplete showError command:', message); }
                 break;
             case 'clearChat':
                  if (messageList) { messageList.innerHTML = ''; console.log('[Webview] Chat UI cleared.'); }
                 break;
             case 'setInitialData':
                  console.log('[Webview] Setting initial data:', message);
                  if (providerSelector instanceof HTMLSelectElement) { /* ... código existente para llenar el select ... */
                     while (providerSelector.options.length > 1) { providerSelector.remove(1); }
                     if(providerSelector.options[0]?.value === "") { providerSelector.remove(0); }
                     if (message.providers && Array.isArray(message.providers)) {
                         message.providers.forEach((provider) => {
                             const option = document.createElement('option');
                             option.value = provider.id;
                             option.textContent = provider.displayName;
                             providerSelector.appendChild(option);
                         });
                     }
                     if (message.activeProviderId) { providerSelector.value = message.activeProviderId; }
                  }
                 break;
             case 'providerChanged':
                 console.log(`[Webview] Extension confirmed provider changed to: ${message.newProviderId}`);
                break;
             default:
                 console.warn('[Webview] Received unknown command:', message);
                 break;
         }
    });

    // --- Inicialización ---
    if (userInput instanceof HTMLElement) { userInput.focus(); }
    console.log('[Webview] Event listeners set up.');

})();