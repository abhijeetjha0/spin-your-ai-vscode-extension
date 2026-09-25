import { Logger } from './logger';

export interface HttpOptions extends RequestInit {
    timeout?: number;
}

export class HttpService {
    public static async fetch(url: string, options: HttpOptions = {}): Promise<Response> {
        const { timeout = 30000, ...fetchOptions } = options;
        
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (err) {
            clearTimeout(id);
            Logger.error(`HTTP request to ${url} failed`, err);
            throw err;
        }
    }

    public static async *streamServerSentEvents(url: string, options: HttpOptions = {}): AsyncGenerator<string, void, unknown> {
        const response = await this.fetch(url, options);

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP Error ${response.status}: ${text}`);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last partial line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            return;
                        }
                        yield data;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
