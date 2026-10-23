const vscode = acquireVsCodeApi();

const chatContainer = document.getElementById('chat-container');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const optionsBtn = document.getElementById('options-btn');
const helpBtn = document.getElementById('help-btn');
const exportChatBtn = document.getElementById('export-chat-btn');
const compactBtn = document.getElementById('compact-btn');
const reloadModelsBtn = document.getElementById('reload-models-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const contextToggle = document.getElementById('include-page-context');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');
const agentPermissionBtn = document.getElementById('agent-permission-btn');
const agentModeModal = document.getElementById('agent-mode-modal');
const closeAgentModeBtn = document.getElementById('close-agent-mode-btn');
const saveAgentModeBtn = document.getElementById('save-agent-mode-btn');
const rememberAgentMode = document.getElementById('remember-agent-mode');
let currentAgentMode = 'prompt';

// Slash commands elements & state
const slashPopover = document.getElementById('slash-commands-popover');
const slashList = document.getElementById('slash-commands-list');
let activeSlashIndex = 0;
let currentMatchingSlashCommands = [];
let currentSlashQueryMeta = null;
let lastSlashRequestId = 0;

const BASE_SLASH_COMMANDS = [
    { name: 'plan', command: '/plan', label: 'Plan', icon: 'architecture', category: 'Prompt', description: 'Generate a detailed, step-by-step implementation plan for a task', type: 'prompt', template: 'Please outline a comprehensive, step-by-step implementation plan for: ' },
    { name: 'explain', command: '/explain', label: 'Explain', icon: 'psychology', category: 'Prompt', description: 'Explain active selection, code, or context in depth', type: 'prompt', template: 'Please explain the following code and concepts in detail:\n\n' },
    { name: 'refactor', command: '/refactor', label: 'Refactor', icon: 'auto_fix_high', category: 'Prompt', description: 'Refactor code for better readability, structure, and performance', type: 'prompt', template: 'Please refactor the following code for better readability and performance:\n\n' },
    { name: 'fix', command: '/fix', label: 'Fix', icon: 'bug_report', category: 'Prompt', description: 'Diagnose syntax, logic, or runtime issues and provide verified solutions', type: 'prompt', template: 'Please diagnose and fix the issue in the following:\n\n' },
    { name: 'test', command: '/test', label: 'Test', icon: 'science', category: 'Prompt', description: 'Generate comprehensive unit tests, edge cases, and assertion suites', type: 'prompt', template: 'Please write comprehensive unit tests and edge cases for the following:\n\n' },
    { name: 'summarize', command: '/summarize', label: 'Summarize', icon: 'summarize', category: 'Prompt', description: 'Summarize the active document, file, or discussion concisely', type: 'prompt', template: 'Please provide a concise, structured summary of the current context:\n\n' },
    { name: 'search', command: '/search', label: 'Search', icon: 'search', category: 'Prompt', description: 'Search workspace files, code symbols, or context', type: 'prompt', template: 'Please search the workspace for: ' },
    { name: 'subagent', command: '/subagent', label: 'Subagent', icon: 'account_tree', category: 'Multi-Agent', description: 'Spin specialized autonomous sub-agent(s) with dedicated roles and tasks', type: 'prompt', template: 'Can you spin up specialized sub-agents from different perspectives to analyze: ' },
    { name: 'file', command: '/file', label: 'File Scope', icon: 'draft', category: 'Scope', description: 'Focus and attach active file content', type: 'prompt', template: '@file ' },
    { name: 'workspace', command: '/workspace', label: 'Workspace Scope', icon: 'folder', category: 'Scope', description: 'Inject workspace file structure and project context', type: 'prompt', template: '@workspace ' },
    { name: 'history', command: '/history', label: 'Chat History', icon: 'history', category: 'Action', description: 'Open chat sessions and conversation history', type: 'action', actionId: 'history' },
    { name: 'compact', command: '/compact', label: 'Compact Context', icon: 'compress', category: 'Action', description: 'Trigger manual context compaction to compress history and save tokens', type: 'action', actionId: 'compact' },
    { name: 'refresh', command: '/refresh', label: 'Refresh Models & Skills', icon: 'refresh', category: 'Action', description: 'Reload AI models and refresh workspace skills', type: 'action', actionId: 'refresh' },
    { name: 'clear', command: '/clear', label: 'Clear Chat', icon: 'delete_sweep', category: 'Action', description: 'Reset conversation history and clear active sub-agents', type: 'action', actionId: 'clear' },
    { name: 'help', command: '/help', label: 'Help', icon: 'help', category: 'Action', description: 'Display commands reference manual and keyboard shortcuts', type: 'action', actionId: 'help' }
];

let dynamicWorkspaceSkills = [];

function extractSlashQuery(text, cursorPos) {
    if (typeof text !== 'string' || cursorPos <= 0) {
        return { isMatch: false };
    }
    const textBeforeCursor = text.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (!match) return { isMatch: false };
    const query = match[1];
    const slashIndex = textBeforeCursor.lastIndexOf('/' + query);
    return { isMatch: true, query, slashIndex, endIndex: cursorPos };
}

function deduplicateCommands(commands) {
    if (!Array.isArray(commands)) return [];
    const seen = new Set();
    const result = [];
    for (const cmd of commands) {
        if (!cmd || !cmd.command) continue;
        const key = cmd.command.toLowerCase().trim();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(cmd);
        }
    }
    return result;
}

function filterLocalSlashCommands(query) {
    const all = deduplicateCommands([...BASE_SLASH_COMMANDS, ...dynamicWorkspaceSkills]);
    const normalized = (query || '').replace(/^\//, '').trim().toLowerCase();
    if (!normalized) return all;

    const matches = all.filter(cmd =>
        (cmd.name && cmd.name.toLowerCase().includes(normalized)) ||
        (cmd.command && cmd.command.toLowerCase().includes(normalized)) ||
        (cmd.label && cmd.label.toLowerCase().includes(normalized)) ||
        (cmd.description && cmd.description.toLowerCase().includes(normalized)) ||
        (cmd.category && cmd.category.toLowerCase().includes(normalized))
    );

    return matches.sort((a, b) => {
        const aCmd = (a.command || '').toLowerCase().replace(/^\//, '');
        const bCmd = (b.command || '').toLowerCase().replace(/^\//, '');
        const aExact = aCmd === normalized ? 0 : 1;
        const bExact = bCmd === normalized ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        const aStarts = aCmd.startsWith(normalized) ? 0 : 1;
        const bStarts = bCmd.startsWith(normalized) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;

        return aCmd.localeCompare(bCmd);
    });
}

function renderSlashPopover(commands) {
    if (!slashList || !slashPopover) return;
    currentMatchingSlashCommands = deduplicateCommands(commands);
    slashList.innerHTML = '';

    if (currentMatchingSlashCommands.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'slash-command-item';
        emptyItem.style.color = 'var(--text-muted, #94a3b8)';
        emptyItem.style.cursor = 'default';
        emptyItem.style.padding = '8px 10px';
        emptyItem.textContent = 'No matching commands or skills';
        slashList.appendChild(emptyItem);
        slashPopover.classList.remove('hidden');
        return;
    }

    if (activeSlashIndex >= currentMatchingSlashCommands.length) {
        activeSlashIndex = 0;
    }

    currentMatchingSlashCommands.forEach((cmd, idx) => {
        const item = document.createElement('div');
        item.className = `slash-command-item ${idx === activeSlashIndex ? 'active' : ''}`;
        item.dataset.index = idx;

        const catClass = cmd.category === 'Skill' ? 'cat-skill' : (cmd.category === 'Action' ? 'cat-action' : '');

        item.innerHTML = `
            <span class="material-symbols-outlined slash-command-icon">${cmd.icon || 'terminal'}</span>
            <div class="slash-command-info">
                <div class="slash-command-title">
                    <span>${cmd.command}</span>
                    <span class="slash-command-badge ${catClass}">${cmd.category}</span>
                </div>
                <div class="slash-command-desc">${cmd.description || ''}</div>
            </div>
        `;

        item.addEventListener('mouseenter', () => {
            activeSlashIndex = idx;
            updateSlashSelection();
        });

        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            executeSlashCommand(cmd);
        });

        slashList.appendChild(item);
    });

    slashPopover.classList.remove('hidden');
    scrollSlashActiveIntoView();
}

function updateSlashSelection() {
    if (!slashList) return;
    const items = slashList.querySelectorAll('.slash-command-item');
    items.forEach((item, idx) => {
        if (idx === activeSlashIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    scrollSlashActiveIntoView();
}

function scrollSlashActiveIntoView() {
    if (!slashList) return;
    const activeItem = slashList.children[activeSlashIndex];
    if (activeItem && activeItem.scrollIntoView) {
        activeItem.scrollIntoView({ block: 'nearest' });
    }
}

function hideSlashPopover() {
    if (slashPopover) {
        slashPopover.classList.add('hidden');
    }
    currentMatchingSlashCommands = [];
    currentSlashQueryMeta = null;
    activeSlashIndex = 0;
}

function executeSlashCommand(cmd) {
    if (!cmd) return;

    if (cmd.type === 'action') {
        if (currentSlashQueryMeta && currentSlashQueryMeta.isMatch) {
            const val = chatInput.value;
            const prefix = val.slice(0, currentSlashQueryMeta.slashIndex);
            const suffix = val.slice(currentSlashQueryMeta.endIndex);
            chatInput.value = (prefix + suffix).trim();
        } else {
            chatInput.value = '';
        }
        chatInput.style.height = 'auto';
        hideSlashPopover();

        const [providerId, modelId] = (selectedModelValue || '').split('::');
        vscode.postMessage({
            type: 'executeSlashAction',
            actionId: cmd.actionId,
            providerId,
            modelId
        });
        chatInput.focus();
        return;
    }

    const templateToInsert = cmd.template || `${cmd.command} `;
    if (currentSlashQueryMeta && currentSlashQueryMeta.isMatch) {
        const val = chatInput.value;
        const prefix = val.slice(0, currentSlashQueryMeta.slashIndex);
        const suffix = val.slice(currentSlashQueryMeta.endIndex);
        chatInput.value = prefix + templateToInsert + suffix;
        const newCursorPos = (prefix + templateToInsert).length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);
    } else {
        chatInput.value = templateToInsert;
    }

    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    hideSlashPopover();
    chatInput.focus();
}

// Sub-agents monitor elements & state
const subagentsStatusBtn = document.getElementById('subagents-status-btn');
const subagentsCountText = document.getElementById('subagents-count-text');
const subagentsModal = document.getElementById('subagents-modal');
const closeSubagentsBtn = document.getElementById('close-subagents-btn');
const clearSubagentsBtn = document.getElementById('clear-subagents-btn');
const subagentsListContainer = document.getElementById('subagents-list-container');
let currentSubagents = [];
let activeSubagentsCount = 0;

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
let currentAiUsage = null;
let pendingAttachments = [];

const sessionsBtn = document.getElementById('sessions-btn');
const sessionsModal = document.getElementById('sessions-modal');
const closeSessionsBtn = document.getElementById('close-sessions-btn');
const sessionsList = document.getElementById('sessions-list');

let allSessions = [];
let currentSessionId = null;

// Combobox state
let allModels = [];         // [{providerId, providerName, modelId, modelName, value}]
let selectedModelValue = null; // 'providerId::modelId'
let thinkingInterval = null;

// ── Terminal Tooltip Engine ──────────────────────────────────────────
let tooltipEl = null;
let tooltipShowTimeout = null;
let currentTooltipTarget = null;

function hideTooltip() {
    if (tooltipShowTimeout) {
        clearTimeout(tooltipShowTimeout);
        tooltipShowTimeout = null;
    }
    if (tooltipEl) {
        tooltipEl.classList.remove('visible');
    }
    currentTooltipTarget = null;
}

function showTooltip(target) {
    const text = target.getAttribute('data-tooltip') || target.getAttribute('title');
    if (!text || !text.trim()) return;

    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'terminal-global-tooltip';
        tooltipEl.className = 'terminal-tooltip';
        document.body.appendChild(tooltipEl);
    }

    // Suppress native title popup to avoid duplicate/delayed glitches
    if (target.hasAttribute('title')) {
        target.setAttribute('data-tooltip', text);
        target.removeAttribute('title');
    }

    tooltipEl.textContent = text;

    // Measure element bounding box
    const targetRect = target.getBoundingClientRect();
    const tooltipWidth = tooltipEl.offsetWidth;
    const tooltipHeight = tooltipEl.offsetHeight;

    // Center horizontally, clamped to viewport edges
    const margin = 6;
    let left = targetRect.left + (targetRect.width / 2) - (tooltipWidth / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));

    // Position vertically: above if element is in lower half of screen, below otherwise
    let top;
    if (targetRect.top > window.innerHeight / 2) {
        top = targetRect.top - tooltipHeight - 6;
    } else {
        top = targetRect.bottom + 6;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
    tooltipEl.classList.add('visible');
}

function initTooltips() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'terminal-global-tooltip';
        tooltipEl.className = 'terminal-tooltip';
        document.body.appendChild(tooltipEl);
    }

    // Sync any existing title attributes to data-tooltip
    document.querySelectorAll('[title]').forEach(el => {
        if (!el.hasAttribute('data-tooltip')) {
            el.setAttribute('data-tooltip', el.getAttribute('title'));
        }
    });

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip], [title]');
        if (!target) return;
        if (target === currentTooltipTarget) return;

        const wasVisible = tooltipEl && tooltipEl.classList.contains('visible');
        currentTooltipTarget = target;
        if (tooltipShowTimeout) {
            clearTimeout(tooltipShowTimeout);
        }

        // Fast response: 0ms if already browsing tooltips, 80ms initially
        const delay = wasVisible ? 0 : 80;
        tooltipShowTimeout = setTimeout(() => {
            if (currentTooltipTarget === target) {
                showTooltip(target);
            }
        }, delay);
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip], [title]');
        if (target && target === currentTooltipTarget) {
            if (e.relatedTarget && target.contains(e.relatedTarget)) {
                return;
            }
            hideTooltip();
        }
    });

    document.addEventListener('mousedown', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
}

let isInitialized = false;

// Initialize
function init() {
    if (isInitialized) return;
    isInitialized = true;

    initTooltips();
    vscode.postMessage({ type: 'getModels' });
    vscode.postMessage({ type: 'getHistory' });
    vscode.postMessage({ type: 'getSubagents' });
    vscode.postMessage({ type: 'getSlashCommands' });

    // Delegated event handling for interactive Subagent UI inside Mid-Process Analysis
    chatContainer?.addEventListener('click', (e) => {
        // 1. Toggle context viewer
        const toggleBtn = e.target.closest('.subagent-context-toggle');
        if (toggleBtn) {
            const card = toggleBtn.closest('.subagent-card');
            const viewer = card?.querySelector('.subagent-context-viewer');
            if (viewer) {
                const isHidden = viewer.classList.toggle('hidden');
                toggleBtn.textContent = isHidden ? 'View Context' : 'Hide Context';
            }
            return;
        }

        // 2. Terminate subagent
        const termBtn = e.target.closest('.subagent-terminate-btn');
        if (termBtn) {
            const subagentId = termBtn.dataset.subagentId;
            if (subagentId) {
                termBtn.disabled = true;
                termBtn.textContent = 'Stopping...';
                vscode.postMessage({
                    type: 'terminateSubagent',
                    subagentId
                });
            }
            return;
        }

        // 3. Reset inactive subagents
        const resetBtn = e.target.closest('.subagent-reset-btn');
        if (resetBtn) {
            resetBtn.disabled = true;
            vscode.postMessage({ type: 'clearSubagents' });
            vscode.postMessage({ type: 'getSubagents' });
            return;
        }
    });

    subagentsStatusBtn?.addEventListener('click', () => {
        subagentsModal?.classList.remove('hidden');
        renderSubagentsList();
    });

    closeSubagentsBtn?.addEventListener('click', () => {
        subagentsModal?.classList.add('hidden');
    });

    clearSubagentsBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearSubagents' });
        vscode.postMessage({ type: 'getSubagents' });
    });

    optionsBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    helpBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openHelp' });
    });

    exportChatBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'exportChat' });
    });

    compactBtn?.addEventListener('click', () => {
        if (isGenerating) return;
        const [providerId, modelId] = (selectedModelValue || '').split('::');
        vscode.postMessage({
            type: 'compactContext',
            providerId,
            modelId
        });
    });

    reloadModelsBtn?.addEventListener('click', () => {
        vscode.postMessage({ type: 'getModels' });
        
        // Visual feedback
        const icon = reloadModelsBtn.querySelector('.material-symbols-outlined');
        if (icon) {
            icon.style.animation = 'spin 1s linear infinite';
            setTimeout(() => icon.style.animation = '', 1000);
        }
    });

    newChatBtn?.addEventListener('click', clearChat);

    chatInput.addEventListener('keydown', (e) => {
        if (slashPopover && !slashPopover.classList.contains('hidden') && currentMatchingSlashCommands.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeSlashIndex = (activeSlashIndex + 1) % currentMatchingSlashCommands.length;
                updateSlashSelection();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeSlashIndex = (activeSlashIndex - 1 + currentMatchingSlashCommands.length) % currentMatchingSlashCommands.length;
                updateSlashSelection();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                executeSlashCommand(currentMatchingSlashCommands[activeSlashIndex]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                hideSlashPopover();
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';

        const cursorPos = chatInput.selectionStart;
        const queryMeta = extractSlashQuery(chatInput.value, cursorPos);
        if (queryMeta.isMatch) {
            currentSlashQueryMeta = queryMeta;
            activeSlashIndex = 0;
            // Render locally immediately for zero-latency feel
            renderSlashPopover(filterLocalSlashCommands(queryMeta.query));
            lastSlashRequestId++;
            vscode.postMessage({
                type: 'getSlashCommands',
                query: queryMeta.query,
                requestId: lastSlashRequestId
            });
        } else {
            hideSlashPopover();
        }
    });

    document.addEventListener('click', (e) => {
        if (slashPopover && !slashPopover.contains(e.target) && e.target !== chatInput) {
            hideSlashPopover();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    // Attach file button
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    stopBtn.addEventListener('click', () => {
        if (isGenerating) {
            vscode.postMessage({ type: 'stopGeneration' });
            // Do not call finishGeneration() here. 
            // We wait for the backend to abort the request and send back { done: true }
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
        if (modelCombobox && !modelCombobox.contains(e.target)) closeDropdown();
    });

    sessionsBtn?.addEventListener('click', () => {
        sessionsModal.classList.remove('hidden');
        renderSessionsList();
    });
    
    closeSessionsBtn?.addEventListener('click', () => {
        sessionsModal.classList.add('hidden');
    });
    
    sessionsModal?.addEventListener('click', (e) => {
        if (e.target === sessionsModal) {
            sessionsModal.classList.add('hidden');
        }
    });

    // Kebab overflow menu toggle
    const moreBtn = document.getElementById('more-btn');
    const kebabMenu = document.getElementById('kebab-menu');
    moreBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        kebabMenu?.classList.toggle('hidden');
    });
    kebabMenu?.addEventListener('click', () => kebabMenu.classList.add('hidden'));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            kebabMenu?.classList.add('hidden');
            agentModeModal?.classList.add('hidden');
        }
    });
    document.addEventListener('click', (e) => {
        if (kebabMenu && !kebabMenu.classList.contains('hidden') && !moreBtn?.contains(e.target)) {
            kebabMenu.classList.add('hidden');
        }
    });

    // Agent permission mode modal
    function showAgentModeModal() {
        // Sync radio to current mode
        const radio = agentModeModal?.querySelector(`input[value="${currentAgentMode}"]`);
        if (radio) radio.checked = true;
        agentModeModal?.classList.remove('hidden');
    }
    function hideAgentModeModal() {
        agentModeModal?.classList.add('hidden');
    }
    function saveAgentPermissionMode() {
        const selected = agentModeModal?.querySelector('input[name="workspace-agent-mode"]:checked');
        if (!selected) return;
        currentAgentMode = selected.value;
        const remember = rememberAgentMode?.checked !== false;
        vscode.postMessage({ type: 'setAgentPermissionMode', mode: currentAgentMode, remember });
        updatePermissionBtnLabel();
        hideAgentModeModal();
    }
    function updatePermissionBtnLabel() {
        if (agentPermissionBtn) {
            agentPermissionBtn.title = `Workspace Agent Permissions: ${currentAgentMode}`;
            agentPermissionBtn.setAttribute('data-tooltip', agentPermissionBtn.title);
        }
    }

    agentPermissionBtn?.addEventListener('click', showAgentModeModal);
    closeAgentModeBtn?.addEventListener('click', hideAgentModeModal);
    saveAgentModeBtn?.addEventListener('click', saveAgentPermissionMode);
    agentModeModal?.addEventListener('click', (e) => {
        if (e.target === agentModeModal) hideAgentModeModal();
    });

    // Load persisted mode
    vscode.postMessage({ type: 'getAgentPermissionMode' });
}

let pendingAutoSend = false;

// Handle messages from VS Code extension backend
window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'setModels':
            loadModels(msg.providers, msg.activeModel);
            if (pendingAutoSend) {
                pendingAutoSend = false;
                sendMessage();
            }
            break;
        case 'restoreHistory':
            if (isGenerating && msg.isGenerating !== false) {
                // If generation is actively running and backend indicates it is still generating,
                // do not wipe chatContainer or reset the in-flight DOM.
                if (msg.sessions) {
                    allSessions = msg.sessions;
                    currentSessionId = msg.currentSessionId;
                    renderSessionsList();
                }
                break;
            }
            if (isGenerating && msg.isGenerating === false) {
                finishGeneration();
            }
            if (msg.sessions) {
                allSessions = msg.sessions;
                currentSessionId = msg.currentSessionId;
                renderSessionsList();
            }
            renderHistory(msg.history);
            if (msg.compactedCount) {
                renderCompactedBadge(msg.compactedCount, msg.savedTokens, true);
            }
            break;
        case 'syncActiveStream':
            if (msg.isGenerating && !isGenerating) {
                // Rehydrate if webview was freshly initialized/reloaded while streaming
                if (msg.history) {
                    renderHistory(msg.history);
                }
                isGenerating = true;
                chatInput.disabled = true;
                attachBtn.disabled = true;
                chatInput.placeholder = "Processing...";
                sendBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');
                currentMessageId = Date.now().toString();
                const aiMsgEl = appendMessage('AI', '', 'ai-msg', currentMessageId);
                currentAiText = msg.text || '';
                if (currentAiText) {
                    aiMsgEl.innerHTML = renderMarkdown(currentAiText, {
                        subagents: msg.subagents || [],
                        activeCount: msg.activeCount || 0
                    });
                } else {
                    aiMsgEl.innerHTML = '<span class="typing-indicator" style="color:#a78bfa;font-style:italic">Synthesizing data...</span>';
                }
                if (typeof msg.activeCount === 'number') {
                    updateSubagentsUI(msg.activeCount, msg.subagents || []);
                }
            } else if (isGenerating) {
                if (currentMessageId) {
                    const msgEl = document.getElementById(`msg-${currentMessageId}`);
                    if (msgEl) {
                        if (msg.text && msg.text !== currentAiText) {
                            if (thinkingInterval) {
                                clearInterval(thinkingInterval);
                                thinkingInterval = null;
                            }
                            currentAiText = msg.text;
                            msgEl.innerHTML = renderMarkdown(currentAiText, {
                                subagents: currentSubagents,
                                activeCount: activeSubagentsCount
                            });
                            const threshold = 150;
                            const isNearBottom = chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop < threshold;
                            if (isNearBottom) {
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            }
                        }
                    }
                }
                if (typeof msg.activeCount === 'number') {
                    updateSubagentsUI(msg.activeCount, msg.subagents || []);
                }
            }
            break;
        case 'contextCompacted':
            renderCompactedBadge(msg.compactedCount, msg.savedTokens);
            break;
        case 'slashCommandsResult':
            if (Array.isArray(msg.commands)) {
                const backendSkills = deduplicateCommands(msg.commands.filter(c => c.category === 'Skill'));
                if (backendSkills.length > 0) {
                    dynamicWorkspaceSkills = backendSkills;
                }
            }
            if (msg.requestId === lastSlashRequestId && currentSlashQueryMeta?.isMatch) {
                renderSlashPopover(msg.commands && msg.commands.length > 0 ? deduplicateCommands(msg.commands) : filterLocalSlashCommands(currentSlashQueryMeta.query));
            }
            break;
        case 'openHistoryModal':
            sessionsModal?.classList.remove('hidden');
            break;
        case 'toast':
            showToast(msg.message);
            break;
        case 'updateSessions':
            allSessions = msg.sessions || [];
            currentSessionId = msg.currentSessionId;
            renderSessionsList();
            break;
        case 'streamChunk':
            handleStreamChunk(msg.text, msg.done, msg.error, msg.usage);
            break;
        case 'error':
            handleStreamChunk('', true, msg.message);
            break;
        case 'toolPermissionRequest':
            handleToolPermissionRequest(msg.request);
            break;
        case 'subagentStatus':
            updateSubagentsUI(msg.activeCount, msg.subagents);
            break;
        case 'populateInput':
            chatInput.value = msg.text;
            chatInput.focus();
            chatInput.dispatchEvent(new Event('input'));
            if (msg.autoSend) {
                if (selectedModelValue) {
                    sendMessage();
                } else {
                    pendingAutoSend = true;
                }
            }
            break;
        case 'agentPermissionMode': {
            currentAgentMode = msg.mode || 'prompt';
            if (agentPermissionBtn) {
                agentPermissionBtn.title = `Workspace Agent Permissions: ${currentAgentMode}`;
                agentPermissionBtn.setAttribute('data-tooltip', agentPermissionBtn.title);
            }
            break;
        }
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
            const footer = createMessageFooter(item.text, item.usage);
            aiEl.appendChild(footer);
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

function formatCompactNumber(n) {
    if (!n || isNaN(n)) return '0';
    if (n < 1000) return n.toString();
    const k = n / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
}

function createMessageFooter(rawText, usage) {
    const footer = document.createElement('div');
    footer.className = 'message-meta-footer';

    if (usage && (usage.totalTokens > 0 || usage.cachedTokens > 0)) {
        const badge = document.createElement('span');
        badge.className = 'cache-badge';

        let label = '';
        if (usage.cachedTokens && usage.cachedTokens > 0) {
            const cachedStr = formatCompactNumber(usage.cachedTokens);
            const savingsStr = usage.savingsPercent ? ` (${usage.savingsPercent}% saved)` : '';
            label = `${cachedStr} cached${savingsStr}`;
        } else {
            label = `${formatCompactNumber(usage.totalTokens)} tokens`;
        }

        const tooltipParts = [
            `Input: ${(usage.inputTokens || 0).toLocaleString()}`,
            `Cached: ${(usage.cachedTokens || 0).toLocaleString()}`,
            `Output: ${(usage.outputTokens || 0).toLocaleString()}`
        ];
        if (usage.durationMs) {
            tooltipParts.push(`Latency: ${usage.durationMs}ms`);
        }
        badge.title = tooltipParts.join(' | ');

        badge.innerHTML = `
            <span class="material-symbols-outlined">bolt</span>
            <span class="cache-text">${label}</span>
        `;
        footer.appendChild(badge);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn icon-btn';
    copyBtn.title = 'Copy Message';
    copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(rawText).catch(() => {});
        }
        vscode.postMessage({ type: 'copyToClipboard', text: rawText });
        copyBtn.innerHTML = '<span class="material-symbols-outlined">check</span>';
        showToast('Copied to clipboard');
        setTimeout(() => {
            copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
        }, 1500);
    });
    footer.appendChild(copyBtn);

    return footer;
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

function handleToolPermissionRequest(req) {
    if (!req) return;

    const card = document.createElement('div');
    card.className = 'permission-prompt-card';
    card.id = `perm-${req.requestId}`;

    const diffHtml = formatDiffForDisplay(req.diffText);

    card.innerHTML = `
        <div class="perm-header">
            <span class="material-symbols-outlined perm-icon">security</span>
            <span class="perm-title">PERMISSION REQUEST: ${req.toolName}</span>
        </div>
        <div class="perm-body">
            <div class="perm-meta">
                <span class="perm-file-badge">${req.isNew ? 'CREATE' : 'MODIFY'}</span>
                <span class="perm-file-path">${req.filePath}</span>
            </div>
            <div class="perm-diff-container">
                <pre><code>${diffHtml}</code></pre>
            </div>
        </div>
        <div class="perm-actions">
            <button class="perm-btn perm-reject-btn" data-req-id="${req.requestId}">
                <span class="material-symbols-outlined">close</span> Reject
            </button>
            <button class="perm-btn perm-approve-btn" data-req-id="${req.requestId}">
                <span class="material-symbols-outlined">check</span> Approve
            </button>
        </div>
    `;

    chatContainer.appendChild(card);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    const approveBtn = card.querySelector('.perm-approve-btn');
    const rejectBtn = card.querySelector('.perm-reject-btn');
    const actionsDiv = card.querySelector('.perm-actions');

    const respond = (approved) => {
        card.classList.add('perm-resolved');
        approveBtn.disabled = true;
        rejectBtn.disabled = true;

        actionsDiv.innerHTML = approved
            ? '<span class="perm-status-badge perm-status-approved"><span class="material-symbols-outlined">check_circle</span> Approved by user</span>'
            : '<span class="perm-status-badge perm-status-rejected"><span class="material-symbols-outlined">cancel</span> Rejected by user</span>';

        vscode.postMessage({
            type: 'toolPermissionResponse',
            requestId: req.requestId,
            approved
        });
    };

    approveBtn.addEventListener('click', () => respond(true));
    rejectBtn.addEventListener('click', () => respond(false));
}

function formatDiffForDisplay(diffText) {
    if (!diffText) return '';
    const lines = diffText.split('\n');
    return lines.map(line => {
        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (line.startsWith('+')) {
            return `<span class="diff-line-add">${escaped}</span>`;
        } else if (line.startsWith('-')) {
            return `<span class="diff-line-del">${escaped}</span>`;
        } else if (line.startsWith('@')) {
            return `<span class="diff-line-hunk">${escaped}</span>`;
        } else {
            return `<span class="diff-line-ctx">${escaped}</span>`;
        }
    }).join('');
}

function renderCompactedBadge(compactedCount, savedTokens, isRestoring = false) {
    const existing = document.getElementById('compact-badge');
    if (existing) {
        existing.remove();
    }

    const badge = document.createElement('div');
    badge.id = 'compact-badge';
    badge.className = 'context-compact-badge';
    badge.innerHTML = `
        <span class="material-symbols-outlined compact-icon">compress</span>
        <span class="compact-text">Context Compacted: Condensed ${compactedCount} earlier turns (Saved ~${savedTokens} tokens)</span>
    `;

    chatContainer.appendChild(badge);
    if (!isRestoring) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function showToast(message) {
    let toast = document.getElementById('chat-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'chat-toast';
        toast.className = 'chat-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
}

function handleStreamChunk(chunk, done, error, usage) {
    if (!isGenerating) return;

    const msgEl = document.getElementById(`msg-${currentMessageId}`);
    if (!msgEl) return;

    if (error) {
        msgEl.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;color:#ef4444">warning</span> Error: ${error}`;
        msgEl.style.color = '#ef4444';
        finishGeneration();
        return;
    }

    if (usage) {
        currentAiUsage = usage;
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
        msgEl.innerHTML = renderMarkdown(currentAiText, {
            subagents: currentSubagents,
            activeCount: activeSubagentsCount
        });
        
        // Smart scroll: only auto-scroll if user is near the bottom
        const threshold = 150;
        const isNearBottom = chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop < threshold;
        if (isNearBottom) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    if (done) {
        if (msgEl && !msgEl.querySelector('.message-meta-footer')) {
            const footer = createMessageFooter(currentAiText, currentAiUsage);
            msgEl.appendChild(footer);
        }
        finishGeneration();
    }
}

function finishGeneration() {
    if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = null;
    }
    isGenerating = false;
    currentAiUsage = null;
    chatInput.disabled = false;
    attachBtn.disabled = false;
    chatInput.placeholder = "/ for commands & skills...";
    currentMessageId = null;
    currentAiText = '';
    stopBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');

    setTimeout(() => chatInput.focus(), 100);
}

function clearChat() {
    chatContainer.innerHTML = '<div class="message system-msg">Welcome to Spin Your AI! Select a model and start chatting.</div>';
    vscode.postMessage({ type: 'clearHistory' });
    currentSubagents = [];
    activeSubagentsCount = 0;
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
            <button class="remove-attachment" data-index="${i}" title="Remove attachment" data-tooltip="Remove attachment"><span class="material-symbols-outlined">close</span></button>
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

function escapeSubagentHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function generateSubagentsHtml(subagents, activeCount = 0) {
    if (!subagents || subagents.length === 0) return '';

    const isWorking = activeCount > 0;
    const countLabel = isWorking ? `${activeCount} Working` : `${subagents.length} Agent${subagents.length === 1 ? '' : 's'}`;
    const pulseHtml = isWorking ? '<span class="subagent-pulse-dot"></span>' : '';

    const cardsHtml = subagents.map(sa => {
        const statusClass = sa.status || 'completed';
        const isWorkingSa = statusClass === 'working';
        const turns = sa.turnsCount || (sa.history ? sa.history.filter(h => h.role === 'assistant').length : 0);
        const idShort = (sa.id || '').length > 18 ? `${sa.id.slice(0, 18)}...` : sa.id;

        let contextContent = '';
        if (sa.history && sa.history.length > 0) {
            contextContent = sa.history
                .map(h => `[${(h.role || 'unknown').toUpperCase()}]\n${typeof h.content === 'string' ? h.content : JSON.stringify(h.content, null, 2)}`)
                .join('\n\n---\n\n');
        } else if (sa.result) {
            contextContent = `[RESULT]\n${sa.result}`;
        } else {
            contextContent = '(No context turns recorded)';
        }

        const termBtnHtml = isWorkingSa 
            ? `<button type="button" class="subagent-terminate-btn" data-subagent-id="${escapeSubagentHtml(sa.id)}" title="Terminate Sub-Agent" data-tooltip="Terminate Sub-Agent">Terminate</button>` 
            : '';

        return `
            <div class="subagent-card ${statusClass}">
                <div class="subagent-card-header">
                    <span class="subagent-role">${escapeSubagentHtml(sa.role || 'Specialist')}</span>
                    <span class="subagent-status-tag ${statusClass}">${statusClass}</span>
                </div>
                <div class="subagent-task">${escapeSubagentHtml(sa.task || '')}</div>
                <div class="subagent-meta">
                    <span>ID: <code>${escapeSubagentHtml(idShort)}</code> | Turns: ${turns}</span>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" class="subagent-context-toggle" title="Toggle Context View" data-tooltip="Toggle Context View">View Context</button>
                        ${termBtnHtml}
                    </div>
                </div>
                <div class="subagent-context-viewer hidden">${escapeSubagentHtml(contextContent)}</div>
            </div>
        `;
    }).join('');

    return `
        <div class="midprocess-subagents-block">
            <div class="midprocess-subagents-header">
                <div class="subagents-title-group">
                    <span class="material-symbols-outlined" style="font-size:16px;color:var(--text-ai,#7dd3fc);vertical-align:middle;margin-right:6px;">hub</span>
                    <strong>Autonomous Sub-Agents</strong>
                    <span class="subagents-count-badge ${isWorking ? 'working' : ''}">${countLabel}</span>
                    ${pulseHtml}
                </div>
                <button type="button" class="subagent-reset-btn" title="Reset Inactive Sub-Agents" data-tooltip="Reset Inactive Sub-Agents">
                    <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">delete_sweep</span> Reset
                </button>
            </div>
            <div class="midprocess-subagents-list">
                ${cardsHtml}
            </div>
        </div>
    `;
}

// Markdown renderer
function renderMarkdown(text, options = {}) {
    const subagents = options?.subagents || [];
    const activeSubagentsCount = options?.activeCount || 0;

    if (!text && (!subagents || subagents.length === 0)) return '';
    text = text || '';

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

    let midProcessItems = [];
    let hasOpenStream = false;

    // 1. Extract closed <think> tags
    text = text.replace(/<(think|thinking)>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
        const escapedContent = content.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        midProcessItems.push(`<div style="margin-bottom: 8px;"><strong>Thought Process:</strong><br>${escapedContent}</div>`);
        return '';
    });

    // 2. Extract unclosed <think> tag
    text = text.replace(/<(think|thinking)>([\s\S]*)$/i, (match, tag, content) => {
        hasOpenStream = true;
        const escapedContent = content.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        midProcessItems.push(`<div style="margin-bottom: 8px;"><strong>Thinking...</strong><br>${escapedContent}</div>`);
        return '';
    });

    // 3. Extract Tool logs (MCP and Workspace Agent tools)
    text = text.replace(/(?:\n\n)?>\s*<span[^>]*>settings<\/span>\s*\*Executing (?:MCP )?tool `([^`]+)`\.\.\.\*(?:\n\n)?/gi, (match, toolName) => {
        if (toolName === 'spin_subagent') {
            if (!subagents || subagents.length === 0) {
                midProcessItems.push(`<div style="margin-bottom: 4px;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;color:var(--text-ai,#7dd3fc);">hub</span>Executing Tool: <code>spin_subagent</code></div>`);
            }
        } else {
            const isAgent = toolName.startsWith('workspace_');
            const icon = isAgent ? 'folder_open' : 'build';
            const label = isAgent ? 'Executing Workspace Tool' : 'Executing MCP Tool';
            midProcessItems.push(`<div style="margin-bottom: 4px;"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;">${icon}</span>${label}: <code>${toolName}</code></div>`);
        }
        return '';
    });

    // 4. Inject Sub-Agents block into Mid-Process Analysis if subagents are present
    if (subagents && subagents.length > 0) {
        if (activeSubagentsCount > 0) {
            hasOpenStream = true;
        }
        midProcessItems.push(generateSubagentsHtml(subagents, activeSubagentsCount));
    }

    if (midProcessItems.length > 0) {
        const combinedContent = midProcessItems.join('<hr style="border-color: #333; margin: 8px 0;">');
        const openAttr = hasOpenStream ? 'open' : '';
        const detailsHtml = `<details class="thinking-details" ${openAttr} style="margin: 0 0 16px 0; border: 1px solid var(--border-color); background: #000; padding: 8px;"><summary style="cursor: pointer; color: var(--text-muted); font-size: 0.9em; user-select: none; font-weight: bold;"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:6px;">psychology</span>Mid-Process Analysis (${midProcessItems.length})</summary><div class="details-content" style="padding-top:12px; font-size:0.9em; color:var(--text-muted);">${combinedContent}</div></details>`;
        
        const idx = protectedBlocks.length;
        protectedBlocks.push(detailsHtml);
        text = `\x00BLOCK${idx}\x00\n\n` + text.trimStart();
    }

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

function renderSessionsList() {
    if (!sessionsList) return;
    sessionsList.innerHTML = '';
    if (allSessions.length === 0) {
        sessionsList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">No sessions yet</div>';
        return;
    }
    
    // Sort by createdAt desc
    const sorted = [...allSessions].sort((a, b) => b.createdAt - a.createdAt);
    
    sorted.forEach(session => {
        const item = document.createElement('div');
        item.className = 'model-item' + (session.id === currentSessionId ? ' selected' : '');
        item.style = 'display: flex; justify-content: space-between; align-items: center;';
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = session.title || 'Chat Session';
        titleSpan.style = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px;';
        
        item.appendChild(titleSpan);
        
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'material-symbols-outlined';
        deleteBtn.textContent = 'delete';
        deleteBtn.style = 'font-size: 16px; cursor: pointer; color: var(--text-muted); padding: 2px;';
        deleteBtn.title = 'Reset Session';
        deleteBtn.dataset.tooltip = 'Reset Session';
        
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteSession', sessionId: session.id });
        });
        
        deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = 'rgba(255, 0, 0, 0.2)');
        deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'transparent');
        
        item.appendChild(deleteBtn);
        
        item.addEventListener('click', () => {
            vscode.postMessage({ type: 'switchSession', sessionId: session.id });
            sessionsModal.classList.add('hidden');
        });
        
        sessionsList.appendChild(item);
    });
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    init();
}

// ── Sub-Agents UI & Monitor ────────────────────────────────────────

function updateSubagentsUI(activeCount, subagents) {
    activeSubagentsCount = activeCount || 0;
    currentSubagents = subagents || [];

    // Update Mid-Process Analysis in current or latest AI message
    const targetMsgEl = currentMessageId 
        ? document.getElementById(`msg-${currentMessageId}`)
        : chatContainer.querySelector('.message.ai-msg:last-of-type');

    if (targetMsgEl && currentAiText) {
        targetMsgEl.innerHTML = renderMarkdown(currentAiText, {
            subagents: currentSubagents,
            activeCount: activeSubagentsCount
        });
    }

    if (subagentsStatusBtn && subagentsCountText) {
        if (activeSubagentsCount > 0) {
            subagentsStatusBtn.classList.remove('hidden');
            subagentsStatusBtn.classList.add('working');
            subagentsCountText.textContent = `${activeSubagentsCount} Working`;
        } else if (currentSubagents.length > 0) {
            subagentsStatusBtn.classList.remove('hidden');
            subagentsStatusBtn.classList.remove('working');
            subagentsCountText.textContent = `${currentSubagents.length} Sub-Agent${currentSubagents.length === 1 ? '' : 's'}`;
        } else {
            subagentsStatusBtn.classList.add('hidden');
            subagentsStatusBtn.classList.remove('working');
        }
    }

    if (subagentsModal && !subagentsModal.classList.contains('hidden')) {
        renderSubagentsList();
    }
}

function renderSubagentsList() {
    if (!subagentsListContainer) return;
    subagentsListContainer.innerHTML = '';

    if (currentSubagents.length === 0) {
        subagentsListContainer.innerHTML = '<div class="subagents-empty">No sub-agents currently spawned.</div>';
        return;
    }

    const sorted = [...currentSubagents].sort((a, b) => {
        if (a.status === 'working' && b.status !== 'working') return -1;
        if (b.status === 'working' && a.status !== 'working') return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    for (const sa of sorted) {
        const card = document.createElement('div');
        card.className = `subagent-card ${sa.status}`;

        const header = document.createElement('div');
        header.className = 'subagent-card-header';

        const role = document.createElement('span');
        role.className = 'subagent-role';
        role.textContent = sa.role || 'Specialist';

        const statusTag = document.createElement('span');
        statusTag.className = `subagent-status-tag ${sa.status}`;
        statusTag.textContent = sa.status;

        header.appendChild(role);
        header.appendChild(statusTag);
        card.appendChild(header);

        const task = document.createElement('div');
        task.className = 'subagent-task';
        task.textContent = sa.task;
        card.appendChild(task);

        const meta = document.createElement('div');
        meta.className = 'subagent-meta';

        const turnsInfo = document.createElement('span');
        turnsInfo.textContent = `ID: ${sa.id.slice(0, 16)}... | Turns: ${sa.turnsCount || 0}`;
        meta.appendChild(turnsInfo);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '6px';

        const toggleContextBtn = document.createElement('button');
        toggleContextBtn.className = 'subagent-context-toggle';
        toggleContextBtn.textContent = 'View Context';
        toggleContextBtn.title = 'Toggle Context View';
        toggleContextBtn.dataset.tooltip = 'Toggle Context View';
        actions.appendChild(toggleContextBtn);

        if (sa.status === 'working') {
            const termBtn = document.createElement('button');
            termBtn.className = 'subagent-terminate-btn';
            termBtn.textContent = 'Terminate';
            termBtn.title = 'Terminate Sub-Agent';
            termBtn.dataset.tooltip = 'Terminate Sub-Agent';
            termBtn.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'terminateSubagent',
                    subagentId: sa.id
                });
            });
            actions.appendChild(termBtn);
        }

        meta.appendChild(actions);
        card.appendChild(meta);

        const contextViewer = document.createElement('div');
        contextViewer.className = 'subagent-context-viewer hidden';

        const contextContent = (sa.history || [])
            .map(h => `[${(h.role || 'unknown').toUpperCase()}]\n${typeof h.content === 'string' ? h.content : JSON.stringify(h.content, null, 2)}`)
            .join('\n\n---\n\n');
        contextViewer.textContent = contextContent || '(No context turns recorded)';
        card.appendChild(contextViewer);

        toggleContextBtn.addEventListener('click', () => {
            const isHidden = contextViewer.classList.toggle('hidden');
            toggleContextBtn.textContent = isHidden ? 'View Context' : 'Hide Context';
        });

        subagentsListContainer.appendChild(card);
    }
}

