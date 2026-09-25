const vscode = acquireVsCodeApi();

const messagesContainer = document.getElementById('messages');
const providerSelect = document.getElementById('provider-select');
const modelInput = document.getElementById('model-input');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const insertButton = document.getElementById('insert-button');

let currentAssistantMessage = null;

// Initialize
vscode.postMessage({ type: 'getProviders' });

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'setProviders':
            providerSelect.innerHTML = '';
            message.providers.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                providerSelect.appendChild(option);
            });
            break;
        case 'streamChunk':
            if (!currentAssistantMessage) {
                currentAssistantMessage = document.createElement('div');
                currentAssistantMessage.className = 'message ai-msg';
                messagesContainer.appendChild(currentAssistantMessage);
            }
            currentAssistantMessage.textContent += message.text;
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            if (message.done) {
                currentAssistantMessage = null;
                sendButton.disabled = false;
            }
            break;
        case 'error':
            const errorMsg = document.createElement('div');
            errorMsg.className = 'message system-msg';
            errorMsg.style.color = 'var(--vscode-errorForeground)';
            errorMsg.textContent = `Error: ${message.message}`;
            messagesContainer.appendChild(errorMsg);
            currentAssistantMessage = null;
            sendButton.disabled = false;
            break;
        case 'populateInput':
            messageInput.value = message.text;
            messageInput.focus();
            break;
    }
});

sendButton.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!text) return;

    // Add user message to UI
    const userMsg = document.createElement('div');
    userMsg.className = 'message user-msg';
    userMsg.textContent = text;
    messagesContainer.appendChild(userMsg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Send to extension
    vscode.postMessage({
        type: 'sendMessage',
        text: text,
        providerId: providerSelect.value,
        modelId: modelInput.value || 'default-model'
    });

    messageInput.value = '';
    sendButton.disabled = true;
});

insertButton.addEventListener('click', () => {
    const assistantMessages = messagesContainer.querySelectorAll('.message.ai-msg');
    if (assistantMessages.length === 0) return;
    
    const lastMessageText = assistantMessages[assistantMessages.length - 1].textContent;
    
    // Extract code block if present
    const codeMatch = lastMessageText.match(/```[a-z]*\n([\s\S]*?)```/);
    const codeToInsert = codeMatch ? codeMatch[1] : lastMessageText;

    vscode.postMessage({
        type: 'insertCode',
        code: codeToInsert
    });
});
