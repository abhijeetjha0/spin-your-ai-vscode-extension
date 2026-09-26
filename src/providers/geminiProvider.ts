import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';

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

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Gemini API key not found'); }

        const baseUrl = this.getBaseUrl();
        const tools = await McpService.getActiveTools();
        
        const contents: any[] = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        
        const systemInstruction = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const currentContents: any[] = [...contents];

        while (true) {
            const body: any = { contents: currentContents };
            if (systemInstruction) {
                body.systemInstruction = { parts: [{ text: systemInstruction }] };
            }

            if (tools.length > 0) {
                const sanitizeSchema = (schema: any): any => {
                    if (!schema || typeof schema !== 'object') { return schema; }
                    if (Array.isArray(schema)) { return schema.map(s => sanitizeSchema(s)); }
                    const clean: any = {};
                    const allowed = ['type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'items'];
                    for (const k of allowed) {
                        if (schema[k] !== undefined) {
                            clean[k] = (k === 'properties' || k === 'items') ? sanitizeSchema(schema[k]) : schema[k];
                        }
                    }
                    return clean;
                };

                body.tools = [{
                    functionDeclarations: tools.map(t => ({
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

            for await (const data of stream) {
                try {
                    const parsed = JSON.parse(data);
                    const parts = parsed.candidates?.[0]?.content?.parts || [];
                    for (const part of parts) {
                        if (part.text) {
                            yield { text: part.text, done: false };
                        }
                        if (part.functionCall) {
                            functionCalls.push(part.functionCall);
                        }
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }

            if (functionCalls.length > 0) {
                for (const call of functionCalls) {
                    yield { text: `\n\n> ⚙️ *Executing MCP tool \`${call.name}\`...*\n\n`, done: false };
                    let result: any;
                    try {
                        result = await McpService.executeTool(call.name, call.args || {});
                    } catch (err: any) {
                        result = { error: err.message };
                    }

                    currentContents.push({
                        role: 'model',
                        parts: [{ functionCall: call }]
                    });

                    currentContents.push({
                        role: 'user',
                        parts: [{
                            functionResponse: {
                                name: call.name,
                                response: { content: result }
                            }
                        }]
                    });
                }
                continue;
            }

            break;
        }

        yield { text: '', done: true };
    }
}
