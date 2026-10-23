import { TokenUsageMetrics } from '../types';

export class CacheMetricsService {
    /**
     * Normalizes heterogeneous usage payloads from different providers into a standard TokenUsageMetrics object.
     */
    public static normalizeUsage(rawUsage: any, providerId: string, durationMs?: number): TokenUsageMetrics | undefined {
        if (!rawUsage || typeof rawUsage !== 'object') {
            return undefined;
        }

        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;
        let cachedTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;

        // 1. Anthropic format
        if ('input_tokens' in rawUsage || 'output_tokens' in rawUsage) {
            inputTokens = Number(rawUsage.input_tokens) || 0;
            outputTokens = Number(rawUsage.output_tokens) || 0;
            cacheCreationTokens = Number(rawUsage.cache_creation_input_tokens) || 0;
            cacheReadTokens = Number(rawUsage.cache_read_input_tokens) || 0;
            cachedTokens = cacheReadTokens;
            totalTokens = inputTokens + outputTokens + cacheCreationTokens;
        }
        // 2. Gemini format
        else if ('promptTokenCount' in rawUsage || 'candidatesTokenCount' in rawUsage) {
            inputTokens = Number(rawUsage.promptTokenCount) || 0;
            outputTokens = Number(rawUsage.candidatesTokenCount) || 0;
            totalTokens = Number(rawUsage.totalTokenCount) || (inputTokens + outputTokens);
            cachedTokens = Number(rawUsage.cachedContentTokenCount) || 0;
        }
        // 3. OpenAI / OpenRouter / Ollama Cloud format
        else if ('prompt_tokens' in rawUsage || 'completion_tokens' in rawUsage) {
            inputTokens = Number(rawUsage.prompt_tokens) || 0;
            outputTokens = Number(rawUsage.completion_tokens) || 0;
            totalTokens = Number(rawUsage.total_tokens) || (inputTokens + outputTokens);

            if (rawUsage.prompt_tokens_details && typeof rawUsage.prompt_tokens_details === 'object') {
                cachedTokens = Number(rawUsage.prompt_tokens_details.cached_tokens) || 0;
            } else if (rawUsage.native_tokens_cached) {
                cachedTokens = Number(rawUsage.native_tokens_cached) || 0;
            }
        } else {
            return undefined;
        }

        // Calculate estimated savings percentage
        let savingsPercent = 0;
        if (cachedTokens > 0 && inputTokens > 0) {
            if (providerId === 'anthropic') {
                // Anthropic cache reads are discounted by ~90%
                savingsPercent = Math.min(90, Math.round((cachedTokens / inputTokens) * 90));
            } else {
                // Standard prompt cache proportion (e.g. OpenAI/OpenRouter/Ollama)
                savingsPercent = Math.min(100, Math.round((cachedTokens / inputTokens) * 100));
            }
        }

        return {
            inputTokens,
            outputTokens,
            totalTokens,
            cachedTokens,
            cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
            cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
            savingsPercent: savingsPercent > 0 ? savingsPercent : undefined,
            durationMs
        };
    }

    /**
     * Formats a number compactly (e.g. 1420 -> "1.4k").
     */
    public static formatNumber(n: number): string {
        if (n < 1000) {
            return n.toString();
        }
        const k = n / 1000;
        return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
    }

    /**
     * Returns a concise terminal-style badge text for the UI.
     */
    public static formatCacheLabel(usage: TokenUsageMetrics): string {
        if (usage.cachedTokens && usage.cachedTokens > 0) {
            const cachedStr = this.formatNumber(usage.cachedTokens);
            const savingsStr = usage.savingsPercent ? ` (${usage.savingsPercent}% saved)` : '';
            return `${cachedStr} cached${savingsStr}`;
        }
        return `${this.formatNumber(usage.totalTokens)} tokens`;
    }

    /**
     * Generates a detailed tooltip string for cache and token breakdown.
     */
    public static formatTooltip(usage: TokenUsageMetrics): string {
        const parts = [
            `Input: ${usage.inputTokens.toLocaleString()}`,
            `Cached: ${(usage.cachedTokens || 0).toLocaleString()}`,
            `Output: ${usage.outputTokens.toLocaleString()}`
        ];
        if (usage.cacheCreationTokens) {
            parts.push(`Cache Write: ${usage.cacheCreationTokens.toLocaleString()}`);
        }
        if (usage.durationMs && usage.durationMs > 0) {
            parts.push(`Latency: ${usage.durationMs}ms`);
        }
        return parts.join(' | ');
    }
}
