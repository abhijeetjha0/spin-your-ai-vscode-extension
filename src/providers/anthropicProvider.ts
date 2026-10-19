import { BaseProvider } from './baseProvider';
import { Message, ModelInfo, StreamChunk } from '../types';
import { HttpService } from '../utils/http';
import { McpService } from '../services/mcpService';

export class AnthropicProvider extends BaseProvider {
    constructor() {
        super({
            id: 'anthropic',
            name: 'Anthropic',
            type: 'cloud',
            baseUrl: 'https://api.anthropic.com/v1',
            apiKeyRequired: true
        });
    }

    async listModels(): Promise<ModelInfo[]> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { return []; }

        return [
            { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
        ];
    }

    async *streamChat(messages: Message[], modelId: string, signal?: AbortSignal): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = await this.getApiKey();
        if (!apiKey) { throw new Error('Anthropic API key not found'); }

        const baseUrl = this.getBaseUrl();
        const tools = await McpService.getActiveTools();
        
        const systemMessages = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const currentMessages: any[] = messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content
        }));
        let toolCallCount = 0;
        let totalGeneratedContent = 0;

        while (true) {
            const body: any = {
                model: modelId,
                system: systemMessages || undefined,
                messages: currentMessages,
                max_tokens: 4096,
                stream: true
            };

            if (tools.length > 0) {
                body.tools = tools.map(t => ({
                    name: t.function.name,
                    description: t.function.description || 'MCP Tool',
                    input_schema: t.function.parameters || { type: 'object', properties: {} }
                }));
            }

            const stream = HttpService.streamServerSentEvents(`${baseUrl}/messages`, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify(body),
                signal
            });

            const toolCalls: Record<number, { id: string; name: string; inputJson: string }> = {};
            let currentBlockIndex = -1;

            for await (const data of stream) {
                let parsed: any;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    // Ignore parse errors on malformed chunks
                    continue;
                }

                if (parsed.type === 'error' || parsed.error) {
                    const err = parsed.error || parsed;
                    const errMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
                    throw new Error(errMsg);
                }

                if (parsed.type === 'content_block_start') {
                    currentBlockIndex = parsed.index;
                    if (parsed.content_block?.type === 'tool_use') {
                        toolCalls[currentBlockIndex] = {
                            id: parsed.content_block.id,
                            name: parsed.content_block.name,
                            inputJson: ''
                        };
                    }
                } else if (parsed.type === 'content_block_delta') {
                    if (parsed.delta?.text) {
                        totalGeneratedContent += parsed.delta.text.length;
                        yield { text: parsed.delta.text, done: false };
                    } else if (parsed.delta?.partial_json && toolCalls[currentBlockIndex]) {
                        toolCalls[currentBlockIndex].inputJson += parsed.delta.partial_json;
                    }
                }
            }

            const toolCallList = Object.values(toolCalls);
            if (toolCallList.length > 0) {
                toolCallCount++;
                if (toolCallCount > 25) {
                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#f59e0b">warning</span> *Reached sequential tool call safety limit (25 turns). Stopping autonomous loop.*`, done: false };
                    break;
                }

                const assistantContent: any[] = [];
                const toolResults: any[] = [];

                for (const tc of toolCallList) {
                    assistantContent.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.inputJson ? JSON.parse(tc.inputJson) : {}
                    });

                    yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#a78bfa">settings</span> *Executing tool \`${tc.name}\`...*\n\n`, done: false };

                    let result: any;
                    try {
                        const args = tc.inputJson ? JSON.parse(tc.inputJson) : {};
                        result = await McpService.executeTool(tc.name, args);
                    } catch (err: any) {
                        result = `Error: ${err.message}`;
                    }

                    let contentStr = typeof result === 'string' ? result : JSON.stringify(result);
                    if (contentStr.length > 8000) {
                        contentStr = contentStr.substring(0, 8000) + '\n... [Remaining output truncated to protect context window]';
                    }

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tc.id,
                        content: contentStr
                    });
                }

                currentMessages.push({
                    role: 'assistant',
                    content: assistantContent
                });

                currentMessages.push({
                    role: 'user',
                    content: toolResults
                });

                continue;
            }

            break;
        }

        if (toolCallCount > 0 && totalGeneratedContent === 0) {
            yield { text: `\n\n> <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#94a3b8">info</span> *Completed ${toolCallCount} tool execution(s). Model finished without additional commentary.*`, done: false };
        }
        
        yield { text: '', done: true };
    }
}
