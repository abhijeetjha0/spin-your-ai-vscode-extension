const vscode = acquireVsCodeApi();

const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const optionsBtn = document.getElementById('options-btn');
const helpBtn = document.getElementById('help-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const contextToggle = document.getElementById('include-page-context');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');

// Combobox elements
const modelCombobox = document.getElementById('model-combobox');
const modelTrigger = document.getElementById('model-trigger');
const modelDropdown = document.getElementById('model-dropdown');
const modelSearch = document.getElementById('model-search');
const modelList = document.getElementById('model-list');
const modelDisplayName = document.getElementById('model-display-name');

let isGenerating = false;
let currentMessageId = null;
let currentAiText = '';
let pendingAttachments = [];

// Combobox state
let allModels = [];         // [{providerId, providerName, modelId, modelName, value}]
let selectedModelValue = null; // 'providerId::modelId'
let thinkingInterval = null;

// Initialize
function init() {
    vscode.postMessage({ type: 'getModels' });
    vscode.postMessage({ type: 'getHistory' });

    optionsBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    helpBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openHelp' });
    });

    newChatBtn?.addEventListener('click', clearChat);

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    });

    sendBtn.addEventListener('click', sendMessage);

    // Attach file button
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    stopBtn.addEventListener('click', () => {
        if (isGenerating) {
            vscode.postMessage({ type: 'stopGeneration' });
            finishGeneration();
        }
    });

    // Combobox trigger
    modelTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        modelDropdown.classList.contains('hidden') ? openDropdown() : closeDropdown();
    });

    modelSearch.addEventListener('input', () => renderModelList(modelSearch.value));

    modelSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDropdown();
        if (e.key === 'Enter') {
            const firstItem = modelList.querySelector('.model-item');
            if (firstItem) {
                firstItem.click();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!modelCombobox.contains(e.target)) closeDropdown();
    });
}

// Handle messages from VS Code extension backend
window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'setModels':
            loadModels(msg.providers, msg.activeModel);
            break;
        case 'restoreHistory':
            renderHistory(msg.history);
            break;
        case 'streamChunk':
            handleStreamChunk(msg.text, msg.done, msg.error);
            break;
        case 'error':
            handleStreamChunk('', true, msg.message);
            break;
        case 'populateInput':
            chatInput.value = msg.text;
            chatInput.focus();
            chatInput.dispatchEvent(new Event('input'));
            break;
    }
});

function renderHistory(history) {
    if (!history || history.length === 0) {
        chatContainer.innerHTML = '<div class="message system-msg">Welcome to Spin Your AI! Select a model and start chatting.</div>';
        return;
    }

    chatContainer.innerHTML = '';
    for (const item of history) {
        if (item.role === 'user') {
            let userMsgHtml = '';
            if (item.attachments && item.attachments.length > 0) {
                userMsgHtml += '<div class="msg-attachments">';
                for (const att of item.attachments) {
                    if (att.type.startsWith('image/')) {
                        userMsgHtml += `<img src="data:${att.type};base64,${att.data}" alt="${att.name}">`;
                    } else {
                        const icon = getFileIcon(att.type);
                        userMsgHtml += `<span class="file-badge"><span class="material-symbols-outlined">${icon}</span> ${att.name}</span>`;
                    }
                }
                userMsgHtml += '</div>';
            }
            userMsgHtml += renderMarkdown(item.text);
            const userEl = appendMessage('You', '', 'user-msg');
            userEl.innerHTML = userMsgHtml;
        } else if (item.role === 'assistant') {
            const aiEl = appendMessage('AI', item.text, 'ai-msg');
            aiEl.innerHTML = renderMarkdown(item.text);
        } else {
            appendMessage('System', item.text, 'system-msg');
        }
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function loadModels(providers, activeModel) {
    allModels = [];
    if (providers) {
        for (const [providerId, data] of Object.entries(providers)) {
            if (data.models && data.models.length > 0) {
                const sorted = [...data.models].sort((a, b) => a.name.localeCompare(b.name));
                for (const m of sorted) {
                    allModels.push({
                        providerId,
                        providerName: data.name || providerId,
                        modelId: m.id,
                        modelName: m.name,
                        value: `${providerId}::${m.id}`
                    });
                }
            }
        }
    }

    let match = null;
    if (activeModel && activeModel.providerId && activeModel.modelId) {
        const val = `${activeModel.providerId}::${activeModel.modelId}`;
        match = allModels.find(m => m.value === val);
        if (!match) {
            match = allModels.find(m => m.modelId === activeModel.modelId) ||
                    allModels.find(m => m.providerId === activeModel.providerId);
        }
    }

    if (!match && selectedModelValue) {
        match = allModels.find(m => m.value === selectedModelValue);
    }

    if (match) {
        selectModel(match, false);
    } else if (allModels.length > 0) {
        selectModel(allModels[0], false);
    } else {
        selectedModelValue = null;
        modelDisplayName.textContent = 'No models available';
    }

    renderModelList('');
}

function renderModelList(query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = allModels.filter(m =>
        m.modelName.toLowerCase().includes(q) ||
        m.providerName.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q)
    );

    if (filtered.length === 0) {
        if (q) {
            modelList.innerHTML = `
                <div class="model-item custom-model" data-custom="${q}">
                    <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;">add</span>
                    Use custom: <strong>${q}</strong>
                </div>
            `;
            const customEl = modelList.querySelector('.custom-model');
            customEl?.addEventListener('click', () => {
                const currentProvider = selectedModelValue ? selectedModelValue.split('::')[0] : 'ollama';
                const customModel = {
                    providerId: currentProvider,
                    providerName: currentProvider.toUpperCase(),
                    modelId: q,
                    modelName: q,
                    value: `${currentProvider}::${q}`
                };
                allModels.unshift(customModel);
                selectModel(customModel, true);
                closeDropdown();
            });
            return;
        }
        modelList.innerHTML = '<div class="model-no-results">No models available.<br><small style="color:#666">Start Ollama or set an API key.</small></div>';
        return;
    }

    // Group by provider
    const groups = {};
    for (const m of filtered) {
        if (!groups[m.providerName]) groups[m.providerName] = [];
        groups[m.providerName].push(m);
    }

    let html = '';
    for (const [providerName, models] of Object.entries(groups)) {
        html += `<div class="model-group-label">${providerName}</div>`;
        for (const m of models) {
            const isSelected = m.value === selectedModelValue;
            html += `<div class="model-item${isSelected ? ' selected' : ''}" data-value="${m.value}" data-name="${m.modelName}" title="${m.modelId}">${m.modelName}</div>`;
        }
    }
    modelList.innerHTML = html;

    modelList.querySelectorAll('.model-item').forEach(el => {
        el.addEventListener('click', () => {
            const m = allModels.find(item => item.value === el.dataset.value);
            if (m) selectModel(m, true);
            closeDropdown();
        });
    });
}

function selectModel(m, notify) {
    selectedModelValue = m.value;
    modelDisplayName.textContent = m.modelName;
    if (notify) {
        const [providerId, ...rest] = m.value.split('::');
        const modelId = rest.join('::');
        vscode.postMessage({
            type: 'setActiveModel',
            providerId,
            modelId
        });
    }
}

function openDropdown() {
    modelDropdown.classList.remove('hidden');
    modelTrigger.classList.add('open');
    modelSearch.value = '';
    renderModelList('');
    modelSearch.focus();
}

function closeDropdown() {
    modelDropdown.classList.add('hidden');
    modelTrigger.classList.remove('open');
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isGenerating) return;

    if (!selectedModelValue) {
        appendMessage('System', 'Please select a model first (or configure an API key).', 'system-msg');
        return;
    }

    const [providerId, ...rest] = selectedModelValue.split('::');
    const modelId = rest.join('::');

    chatInput.value = '';
    chatInput.style.height = 'auto';

    const attachments = [...pendingAttachments];
    clearAttachments();

    // Render user message in chat
    let userMsgHtml = '';
    if (attachments.length > 0) {
        userMsgHtml += '<div class="msg-attachments">';
        for (const att of attachments) {
            if (att.type.startsWith('image/')) {
                userMsgHtml += `<img src="data:${att.type};base64,${att.data}" alt="${att.name}">`;
            } else {
                const icon = getFileIcon(att.type);
                userMsgHtml += `<span class="file-badge"><span class="material-symbols-outlined">${icon}</span> ${att.name}</span>`;
            }
        }
        userMsgHtml += '</div>';
    }
    userMsgHtml += renderMarkdown(text);

    const userEl = appendMessage('You', '', 'user-msg');
    userEl.innerHTML = userMsgHtml;

    // Create empty AI message container
    currentMessageId = Date.now().toString();
    currentAiText = '';
    const aiMsgEl = appendMessage('AI', '', 'ai-msg', currentMessageId);
    aiMsgEl.innerHTML = '<span class="typing-indicator" style="color:#a78bfa;font-style:italic">Establishing uplink...</span>';

    const THINKING_PHRASES = [
        "Analyzing context...",
        "Synthesizing data...",
        "Compiling token stream...",
        "Querying local provider...",
        "Parsing AST structures...",
        "Calculating inference vectors...",
        "Accessing knowledge graph...",
        "Optimizing heuristics...",
        "Executing neural model..."
    ];

    if (thinkingInterval) clearInterval(thinkingInterval);
    thinkingInterval = setInterval(() => {
        const indicator = aiMsgEl.querySelector('.typing-indicator');
        if (indicator) {
            indicator.textContent = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
        } else {
            clearInterval(thinkingInterval);
        }
    }, 600);

    isGenerating = true;
    chatInput.disabled = true;
    attachBtn.disabled = true;
    chatInput.placeholder = "Processing...";
    sendBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    vscode.postMessage({
        type: 'sendMessage',
        text: text,
        providerId: providerId,
        modelId: modelId,
        includeContext: contextToggle.checked,
        attachments: attachments
    });
}

function appendMessage(sender, text, className, id = null) {
    const div = document.createElement('div');
    div.className = `message ${className}`;
    if (id) div.id = `msg-${id}`;
    div.innerHTML = text ? renderMarkdown(text) : '';
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return div;
}

function handleStreamChunk(chunk, done, error) {
    if (!isGenerating) return;

    const msgEl = document.getElementById(`msg-${currentMessageId}`);
    if (!msgEl) return;

    if (error) {
        msgEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;color:#ef4444">warning</span> Error: ${error}`;
        msgEl.style.color = '#ef4444';
        finishGeneration();
        return;
    }

    if (chunk) {
        if (thinkingInterval) {
            clearInterval(thinkingInterval);
            thinkingInterval = null;
        }
        if (currentAiText === '') {
            msgEl.innerHTML = '';
        }
        currentAiText += chunk;
        msgEl.innerHTML = renderMarkdown(currentAiText);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    if (done) {
        finishGeneration();
    }
}

function finishGeneration() {
    if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = null;
    }
    isGenerating = false;
    chatInput.disabled = false;
    attachBtn.disabled = false;
    chatInput.placeholder = "Ask anything...";
    currentMessageId = null;
    currentAiText = '';
    stopBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');

    setTimeout(() => chatInput.focus(), 100);
}

function clearChat() {
    chatContainer.innerHTML = '<div class="message system-msg">Welcome to Spin Your AI! Select a model and start chatting.</div>';
    vscode.postMessage({ type: 'clearHistory' });
    isGenerating = false;
    currentMessageId = null;
    currentAiText = '';
    stopBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    clearAttachments();
}

// File attachment handling
function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            pendingAttachments.push({
                name: file.name,
                type: file.type || 'application/octet-stream',
                data: base64
            });
            renderAttachmentPreviews();
        };
        reader.readAsDataURL(file);
    }
    fileInput.value = '';
}

function renderAttachmentPreviews() {
    if (pendingAttachments.length === 0) {
        attachmentPreview.classList.add('hidden');
        attachmentPreview.innerHTML = '';
        return;
    }
    attachmentPreview.classList.remove('hidden');
    attachmentPreview.innerHTML = pendingAttachments.map((att, i) => {
        const icon = getFileIcon(att.type);
        const thumb = att.type.startsWith('image/')
            ? `<img class="thumb" src="data:${att.type};base64,${att.data}" alt="${att.name}">`
            : `<span class="material-symbols-outlined">${icon}</span>`;
        return `<div class="attachment-chip">
            ${thumb}
            <span class="file-name">${att.name}</span>
            <button class="remove-attachment" data-index="${i}"><span class="material-symbols-outlined">close</span></button>
        </div>`;
    }).join('');

    attachmentPreview.querySelectorAll('.remove-attachment').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.index);
            pendingAttachments.splice(idx, 1);
            renderAttachmentPreviews();
        });
    });
}

function clearAttachments() {
    pendingAttachments = [];
    attachmentPreview.classList.add('hidden');
    attachmentPreview.innerHTML = '';
}

function getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio_file';
    if (mimeType.startsWith('video/')) return 'video_file';
    if (mimeType === 'application/pdf') return 'picture_as_pdf';
    if (mimeType.startsWith('text/html')) return 'html';
    if (mimeType.startsWith('text/css')) return 'css';
    return 'draft';
}

// Markdown renderer
function renderMarkdown(text) {
    if (!text) return '';

    const protectedBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const idx = protectedBlocks.length;
        protectedBlocks.push(`<pre><code class="language-${lang || 'plaintext'}">${escaped}</code></pre>`);
        return `\x00BLOCK${idx}\x00`;
    });

    text = text.replace(/<span class="material-symbols-outlined"(.*?)>([^<]+)<\/span>/g, (match, attrs, content) => {
        const idx = protectedBlocks.length;
        protectedBlocks.push(`<span class="material-symbols-outlined"${attrs}>${content}</span>`);
        return `\x00BLOCK${idx}\x00`;
    });

    text = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    const lines = text.split('\n');
    const output = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (/^(\*\*\*|---|___)$/.test(line.trim())) {
            output.push('<hr>');
            i++; continue;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            output.push(`<h${level}>${processInline(headingMatch[2])}</h${level}>`);
            i++; continue;
        }

        if (line.startsWith('&gt;')) {
            const quoteLines = [];
            while (i < lines.length && lines[i].startsWith('&gt;')) {
                quoteLines.push(lines[i].slice(4).trim());
                i++;
            }
            output.push(`<blockquote>${processInline(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-: |]+\|$/.test(lines[i + 1])) {
            const headers = line.split('|').slice(1, -1).map(h => `<th>${processInline(h.trim())}</th>`).join('');
            i += 2;
            const rows = [];
            while (i < lines.length && /^\|.+\|/.test(lines[i])) {
                const cells = lines[i].split('|').slice(1, -1).map(c => `<td>${processInline(c.trim())}</td>`).join('');
                rows.push(`<tr>${cells}</tr>`);
                i++;
            }
            output.push(`<table><thead><tr>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
            continue;
        }

        if (/^[-*+]\s/.test(line)) {
            const listItems = [];
            while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
                listItems.push(`<li>${processInline(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
                i++;
            }
            output.push(`<ul>${listItems.join('')}</ul>`);
            continue;
        }

        if (/^\d+\.\s/.test(line)) {
            const listItems = [];
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                listItems.push(`<li>${processInline(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
                i++;
            }
            output.push(`<ol>${listItems.join('')}</ol>`);
            continue;
        }

        if (line.trim() === '') {
            output.push('<br>');
            i++; continue;
        }

        output.push(`<p>${processInline(line)}</p>`);
        i++;
    }

    let html = output.join('');
    html = html.replace(/\x00BLOCK(\d+)\x00/g, (_, idx) => protectedBlocks[idx]);
    return html;
}

function processInline(text) {
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return text;
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
}
