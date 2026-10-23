import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';
import { SubagentService } from '../services/subagentService';
import { CacheMetricsService } from '../services/cacheMetricsService';
import { ToolCacheService } from '../services/toolCacheService';

export class GeminiProvider extends BaseProvider {
    constructor() {
        super({
            id: 'gemini',
            name: 'Google Gemini',
            type: 'cloud',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return [];
        }

        try {
            const baseUrl = this.getBaseUrl();
            const response = await HttpService.fetch(`${baseUrl}/models?key=${apiKey}`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as any;
            return (data.models || [])
                .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
                .map((m: any) => {
                    const id = m.name.replace('models/', '');
                    return {
                        id,
                        name: m.displayName || id
                    };
                });
        } catch {
            return [];
        }
    }

    async *streamChat(
        messages: Message[], 
        modelId: string, 
        signal?: AbortSignal, 
        options?: { isSubagent?: boolean; maxToolTurns?: number }
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Gemini API key not found'); }

        const baseUrl = this.getBaseUrl();
        const isSubagent = !!options?.isSubagent || SubagentService.isInsideSubagent();
        const allTools = await McpService.getActiveTools({ isSubagent });
        const maxToolTurns = options?.maxToolTurns ?? (isSubagent ? 12 : 35);
        const contents: any[] = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        
        const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const currentContents: any[] = [...contents];
        let toolCallCount = 0;
        let totalGeneratedContent = 0;
        let lastUsageMetadata: any = undefined;
        const startTime = Date.now();

        while (true) {
            const canSpin = !isSubagent && SubagentService.getTurnSubagentCount() < SubagentService.MAX_SUBAGENTS_PER_TURN;
            const turnTools = (canSpin ? allTools : allTools.filter(t => t.function.name !== 'spin_subagent'))
                .sort((a, b) => a.function.name.localeCompare(b.function.name));

            const body: any = { contents: currentContents };
            if (systemInstruction) {
                body.systemInstruction = { parts: [{ text: systemInstruction }] };
            }

            if (turnTools.length > 0) {
                const sanitizeSchema = (schema: any): any => {
                    if (!schema || typeof schema !== 'object') { return schema; }
                    if (Array.isArray(schema)) { return schema.map((s: any) => sanitizeSchema(s)); }

                    const clean: any = {};
                    const allowed = ['type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'items'];

                    for (const k of allowed) {
                        if (schema[k] === undefined) { continue; }

                        if (k === 'properties') {
                            // Recurse into each named property individually
                            clean.properties = {};
                            for (const [propName, propVal] of Object.entries(schema[k])) {
                                clean.properties[propName] = sanitizeSchema(propVal);
                            }
                        } else if (k === 'items') {
                            clean.items = sanitizeSchema(schema[k]);
                        } else if (k === 'required') {
                            // Only keep required entries that actually exist in properties
                            const definedProps = Object.keys(schema.properties || {});
                            const filtered = (schema[k] as string[]).filter((r: string) => definedProps.includes(r));
                            if (filtered.length > 0) { clean.required = filtered; }
                        } else {
                            clean[k] = schema[k];
                        }
                    }

                    // Gemini requires uppercase type strings (e.g. "STRING" not "string")
                    if (clean.type) {
                        if (Array.isArray(clean.type)) {
                            const nonNull = clean.type.find((t: any) => typeof t === 'string' && t.toLowerCase() !== 'null');
                            if (clean.type.some((t: any) => typeof t === 'string' && t.toLowerCase() === 'null')) {
                                clean.nullable = true;
                            }
                            clean.type = nonNull ? nonNull.toUpperCase() : 'STRING';
                        } else if (typeof clean.type === 'string') {
                            clean.type = clean.type.toUpperCase();
                        }
                    }

                    return clean;
                };

                body.tools = [{
                    function_declarations: turnTools.map(t => ({
                        name: t.function.name,
                        description: t.function.description || 'Tool function',
                        parameters: sanitizeSchema(t.function.parameters)
                    }))
                }];
            }

            const stream = HttpService.streamServerSentEvents(`${baseUrl}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal
            });

            const functionCalls: any[] = [];
            const modelParts: any[] = [];

            for await (const data of stream) {
                let parsed: any;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    // Ignore parse errors on malformed SSE chunks
                    continue;
                }

                if (parsed.error) {
                    const errMsg = parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
                    throw new Error(errMsg);
                }

                if (parsed.usageMetadata) {
                    lastUsageMetadata = parsed.usageMetadata;
                }

                const parts = parsed.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    // Preserve exact parts (including thought_signature) for multi-turn echo
                    modelParts.push(part);
                    if (part.text) {
                        totalGeneratedContent += part.text.length;
                        yield { text: part.text, done: false };
                    }
                    if (part.functionCall) {
                        functionCalls.push(part.functionCall);
                    }
                }
            }

            if (functionCalls.length > 0) {
                toolCallCount++;
                if (toolCallCount > maxToolTurns) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#f59e0b">warning</span> *Reached sequential tool call safety limit (${maxToolTurns} turns). Stopping autonomous loop.*`, done: false };
                    break;
                }

                // Echo the model's exact generated parts back (required by Gemini multi-turn API)
                currentContents.push({
                    role: 'model',
                    parts: modelParts
                });

                for (const call of functionCalls) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#a78bfa">settings</span> *Executing tool \`${call.name}\`...*\n\n`, done: false };
                }

                const functionResponses = await Promise.all(
                    functionCalls.map(async (call) => {
                        let result: any;
                        try {
                            result = await McpService.executeTool(call.name, call.args || {});
                        } catch (err: any) {
                            result = { error: err.message };
                        }

                        let responsePayload = typeof result === 'object' && result !== null ? result : { result };
                        const strRep = JSON.stringify(responsePayload);
                        if (strRep.length > 8000) {
                            responsePayload = {
                                result: ToolCacheService.smartTruncate(
                                    typeof result === 'string' ? result : strRep,
                                    8000
                                )
                            };
                        }

                        return {
                            functionResponse: {
                                name: call.name,
                                response: responsePayload
                            }
                        };
                    })
                );

                // Tool results go back as a single 'user' turn (Gemini requirement)
                currentContents.push({
                    role: 'user',
                    parts: functionResponses
                });

                continue;
            }

            break;
        }

        if (toolCallCount > 0 && totalGeneratedContent === 0) {
            yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#94a3b8">info</span> *Completed ${toolCallCount} tool execution(s). Model finished without additional commentary.*`, done: false };
        }

        const durationMs = Date.now() - startTime;
        const normalizedUsage = CacheMetricsService.normalizeUsage(lastUsageMetadata, 'gemini', durationMs);
        yield { text: '', done: true, usage: normalizedUsage };
    }
}
