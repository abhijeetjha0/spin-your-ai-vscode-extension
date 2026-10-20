import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { Message } from '../types';

export interface SubagentTurn {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export interface SubagentInfo {
    id: string;
    role: string;
    task: string;
    status: 'working' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
    completedAt: number | null;
    history: SubagentTurn[];
    result: string | null;
    error: string | null;
    turnsCount: number;
}

export interface SubagentExecutionOptions {
    role?: string;
    task: string;
    context?: string;
    subagentId?: string;
    provider?: any;
    modelId?: string;
    attachments?: Array<{ name: string; type: string; data: string }>;
}

export interface SubagentStatusPayload {
    activeCount: number;
    subagents: SubagentInfo[];
}

export type SubagentStatusListener = (payload: SubagentStatusPayload) => void;

export class SubagentService {
    public static readonly MAX_SUBAGENTS_PER_TURN = 5;

    private static subagents = new Map<string, SubagentInfo>();
    private static activeControllers = new Map<string, AbortController>();
    private static statusListeners = new Set<SubagentStatusListener>();
    private static turnSubagentCount = 0;
    private static subagentRunningDepth = 0;
    private static activeTurnContext: {
        provider?: any;
        modelId?: string;
        attachments?: Array<{ name: string; type: string; data: string }>;
        defaultContext?: string;
    } = {};

    /**
     * Subscribe to sub-agent status changes.
     */
    public static onStatusChange(listener: SubagentStatusListener): () => void {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    /**
     * Set active chat turn context (current provider, model, attachments, defaultContext) for sub-agent execution.
     */
    public static setActiveTurnContext(ctx: {
        provider?: any;
        modelId?: string;
        attachments?: Array<{ name: string; type: string; data: string }>;
        defaultContext?: string;
    }) {
        this.activeTurnContext = { ...this.activeTurnContext, ...ctx };
    }

    /**
     * Resets sub-agent count at the start of each user prompt turn.
     */
    public static resetTurnSubagentCount() {
        this.turnSubagentCount = 0;
    }

    public static getTurnSubagentCount(): number {
        return this.turnSubagentCount;
    }

    public static incrementTurnSubagentCount(): number {
        this.turnSubagentCount++;
        return this.turnSubagentCount;
    }

    /**
     * Indicates whether execution is currently inside a sub-agent.
     */
    public static isInsideSubagent(): boolean {
        return this.subagentRunningDepth > 0;
    }

    /**
     * Broadcast status updates to all registered listeners.
     */
    public static notifyStatus() {
        const payload: SubagentStatusPayload = {
            activeCount: this.getActiveCount(),
            subagents: this.getSubagents()
        };
        for (const listener of this.statusListeners) {
            try {
                listener(payload);
            } catch (err) {
                Logger.error('SubagentService listener error:', err);
            }
        }
    }

    /**
     * Returns all sub-agents with turn counts.
     */
    public static getSubagents(): SubagentInfo[] {
        return Array.from(this.subagents.values()).map(sa => ({
            ...sa,
            turnsCount: sa.history.filter(h => h.role === 'assistant').length,
            history: [...sa.history]
        }));
    }

    /**
     * Returns count of currently active (working) sub-agents.
     */
    public static getActiveCount(): number {
        let count = 0;
        for (const sa of this.subagents.values()) {
            if (sa.status === 'working') {
                count++;
            }
        }
        return count;
    }

    /**
     * Returns a specific sub-agent by ID.
     */
    public static getSubagent(id: string): SubagentInfo | null {
        return this.subagents.get(id) || null;
    }

    /**
     * Abort and cancel a running sub-agent by ID.
     */
    public static terminateSubagent(id: string): boolean {
        const controller = this.activeControllers.get(id);
        if (controller) {
            controller.abort();
            this.activeControllers.delete(id);
        }
        const sa = this.subagents.get(id);
        if (sa && sa.status === 'working') {
            sa.status = 'cancelled';
            sa.completedAt = Date.now();
            sa.result = sa.result || '[Terminated by user]';
            this.notifyStatus();
            return true;
        }
        return false;
    }

    /**
     * Terminates all currently active (working) sub-agents.
     */
    public static terminateAllActive(): number {
        let count = 0;
        for (const [id, sa] of this.subagents.entries()) {
            if (sa.status === 'working') {
                this.terminateSubagent(id);
                count++;
            }
        }
        return count;
    }

    /**
     * Clear all completed, failed, or cancelled sub-agents.
     */
    public static clearSubagents() {
        for (const [id, sa] of this.subagents.entries()) {
            if (sa.status !== 'working') {
                this.subagents.delete(id);
            }
        }
        this.notifyStatus();
    }

    /**
     * Reset everything (mainly for unit tests).
     */
    public static resetForTest() {
        for (const controller of this.activeControllers.values()) {
            controller.abort();
        }
        this.activeControllers.clear();
        this.subagents.clear();
        this.statusListeners.clear();
        this.activeTurnContext = {};
        this.turnSubagentCount = 0;
        this.subagentRunningDepth = 0;
    }

    /**
     * Spin up a new sub-agent or continue an existing sub-agent's context.
     */
    public static async spinSubagent(options: SubagentExecutionOptions): Promise<any> {
        const {
            role = 'Specialized Agent',
            task,
            context = '',
            subagentId
        } = options;

        if (!task || !task.trim()) {
            throw new Error('Sub-agent requires a task description.');
        }

        this.subagentRunningDepth++;

        const provider = options.provider || this.activeTurnContext.provider;
        const modelId = options.modelId || this.activeTurnContext.modelId || 'default';
        const attachments = options.attachments || this.activeTurnContext.attachments || [];
        let inheritedContext = context || this.activeTurnContext.defaultContext || '';

        // Context token savings & active editor fallback
        if (!inheritedContext) {
            try {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document) {
                    const codeContent = editor.document.getText();
                    if (codeContent && codeContent.trim()) {
                        inheritedContext = `\n\n--- Active File: ${editor.document.fileName} ---\n\`\`\`\n${codeContent}\n\`\`\`\n--- End File ---`;
                    }
                }
            } catch {
                // Ignore if vscode is unavailable
            }
        }

        // Cap inherited context to protect sub-agent context window and token budget (12,000 chars ~ 3,000 tokens)
        if (inheritedContext.length > 12000) {
            inheritedContext = inheritedContext.substring(0, 12000) + '\n... [Context truncated for sub-agent token efficiency]';
        }

        let subagent: SubagentInfo;
        const isResumed = !!subagentId && this.subagents.has(subagentId);

        if (isResumed && subagentId) {
            subagent = this.subagents.get(subagentId)!;
            subagent.role = role || subagent.role;
            subagent.task = task;
            subagent.status = 'working';
            subagent.error = null;
        } else {
            const id = subagentId || `subagent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            subagent = {
                id,
                role: role.trim() || 'General Specialist',
                task,
                status: 'working',
                createdAt: Date.now(),
                completedAt: null,
                history: [],
                result: null,
                error: null,
                turnsCount: 0
            };
            this.subagents.set(id, subagent);

            // Seed initial system context
            let systemPrompt = `You are an autonomous specialized sub-agent for Spin Your AI. Role: ${subagent.role}.\nYour task is: ${subagent.task}.\nFocus strictly on your assigned task and provide a concise, accurate outcome.`;
            if (inheritedContext && !context) {
                systemPrompt += `\n\n--- Inherited Context ---\n${inheritedContext}\n--- End Context ---`;
            }
            subagent.history.push({
                role: 'system',
                content: systemPrompt,
                timestamp: Date.now()
            });
        }

        const controller = new AbortController();
        this.activeControllers.set(subagent.id, controller);
        this.notifyStatus();

        try {
            // Build user prompt for this sub-agent turn
            let userPrompt = `Task: ${task}`;
            if (context) {
                userPrompt += `\n\n--- Context ---\n${context}\n--- End Context ---`;
            } else if (inheritedContext) {
                userPrompt += `\n\n--- Inherited Context ---\n${inheritedContext}\n--- End Context ---`;
            }

            // Append multimodal attachments if present
            if (attachments.length > 0) {
                for (const att of attachments) {
                    if (att.type?.startsWith('text/') || att.name.match(/\.(ts|js|json|py|md|html|css|txt|sh)$/i)) {
                        try {
                            const decoded = Buffer.from(att.data, 'base64').toString('utf8');
                            userPrompt += `\n\n--- Attached File: ${att.name} ---\n\`\`\`\n${decoded}\n\`\`\`\n`;
                        } catch {
                            userPrompt += `\n\n[Attached File: ${att.name}]`;
                        }
                    } else {
                        userPrompt += `\n\n[Attached Image/Media: ${att.name} (${att.type})]`;
                    }
                }
            }

            subagent.history.push({
                role: 'user',
                content: userPrompt,
                timestamp: Date.now()
            });

            const messagesPayload: Message[] = subagent.history.map(h => ({
                role: h.role,
                content: h.content
            }));

            let fullResponseText = '';

            if (provider && typeof provider.streamChat === 'function') {
                const stream = provider.streamChat(messagesPayload, modelId, controller.signal, { isSubagent: true });
                for await (const chunk of stream) {
                    if (controller.signal.aborted) break;
                    fullResponseText += chunk.text;
                }
            } else {
                fullResponseText = `[Sub-agent "${subagent.role}" (${subagent.id}) completed task: "${task}"]`;
            }

            if (controller.signal.aborted) {
                subagent.status = 'cancelled';
                subagent.result = fullResponseText || '[Aborted by user]';
            } else {
                subagent.status = 'completed';
                subagent.result = fullResponseText;
            }

            subagent.completedAt = Date.now();
            subagent.history.push({
                role: 'assistant',
                content: subagent.result,
                timestamp: Date.now()
            });

            this.activeControllers.delete(subagent.id);
            this.notifyStatus();

            return {
                subagent_id: subagent.id,
                role: subagent.role,
                status: subagent.status,
                result: subagent.result,
                turns_completed: subagent.history.filter(h => h.role === 'assistant').length
            };
        } catch (err: any) {
            this.activeControllers.delete(subagent.id);
            subagent.status = 'failed';
            subagent.error = err?.message || 'Unknown error';
            subagent.completedAt = Date.now();
            this.notifyStatus();

            return {
                subagent_id: subagent.id,
                role: subagent.role,
                status: 'failed',
                error: subagent.error
            };
        } finally {
            this.subagentRunningDepth = Math.max(0, this.subagentRunningDepth - 1);
        }
    }
}
