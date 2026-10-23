import * as assert from 'assert';
import { CacheMetricsService } from '../services/cacheMetricsService';

describe('CacheMetricsService', () => {
    it('normalizes OpenAI format with cached_tokens', () => {
        const raw = {
            prompt_tokens: 3000,
            completion_tokens: 500,
            total_tokens: 3500,
            prompt_tokens_details: {
                cached_tokens: 2500
            }
        };

        const metrics = CacheMetricsService.normalizeUsage(raw, 'openai', 320);
        assert.ok(metrics);
        assert.strictEqual(metrics.inputTokens, 3000);
        assert.strictEqual(metrics.outputTokens, 500);
        assert.strictEqual(metrics.totalTokens, 3500);
        assert.strictEqual(metrics.cachedTokens, 2500);
        assert.strictEqual(metrics.savingsPercent, 83); // Math.round((2500/3000)*100) = 83
        assert.strictEqual(metrics.durationMs, 320);

        const label = CacheMetricsService.formatCacheLabel(metrics);
        assert.strictEqual(label, '2.5k cached (83% saved)');

        const tooltip = CacheMetricsService.formatTooltip(metrics);
        assert.ok(tooltip.includes('Input: 3,000'));
        assert.ok(tooltip.includes('Cached: 2,500'));
        assert.ok(tooltip.includes('Output: 500'));
        assert.ok(tooltip.includes('Latency: 320ms'));
    });

    it('normalizes Anthropic format with cache_read and cache_creation', () => {
        const raw = {
            input_tokens: 4000,
            output_tokens: 600,
            cache_read_input_tokens: 3600,
            cache_creation_input_tokens: 400
        };

        const metrics = CacheMetricsService.normalizeUsage(raw, 'anthropic', 450);
        assert.ok(metrics);
        assert.strictEqual(metrics.inputTokens, 4000);
        assert.strictEqual(metrics.outputTokens, 600);
        assert.strictEqual(metrics.cachedTokens, 3600);
        assert.strictEqual(metrics.cacheReadTokens, 3600);
        assert.strictEqual(metrics.cacheCreationTokens, 400);
        // (3600 / 4000) * 90 = 81
        assert.strictEqual(metrics.savingsPercent, 81);

        const label = CacheMetricsService.formatCacheLabel(metrics);
        assert.strictEqual(label, '3.6k cached (81% saved)');

        const tooltip = CacheMetricsService.formatTooltip(metrics);
        assert.ok(tooltip.includes('Cache Write: 400'));
    });

    it('normalizes Gemini format with cachedContentTokenCount', () => {
        const raw = {
            promptTokenCount: 2000,
            candidatesTokenCount: 300,
            totalTokenCount: 2300,
            cachedContentTokenCount: 1500
        };

        const metrics = CacheMetricsService.normalizeUsage(raw, 'gemini');
        assert.ok(metrics);
        assert.strictEqual(metrics.inputTokens, 2000);
        assert.strictEqual(metrics.outputTokens, 300);
        assert.strictEqual(metrics.cachedTokens, 1500);
        assert.strictEqual(metrics.savingsPercent, 75);

        const label = CacheMetricsService.formatCacheLabel(metrics);
        assert.strictEqual(label, '1.5k cached (75% saved)');
    });

    it('normalizes OpenRouter with native_tokens_cached fallback', () => {
        const raw = {
            prompt_tokens: 1200,
            completion_tokens: 200,
            total_tokens: 1400,
            native_tokens_cached: 1000
        };

        const metrics = CacheMetricsService.normalizeUsage(raw, 'openrouter');
        assert.ok(metrics);
        assert.strictEqual(metrics.cachedTokens, 1000);
        assert.strictEqual(metrics.savingsPercent, 83);
    });

    it('handles zero cached tokens and formats total tokens label', () => {
        const raw = {
            prompt_tokens: 450,
            completion_tokens: 50,
            total_tokens: 500
        };

        const metrics = CacheMetricsService.normalizeUsage(raw, 'openai');
        assert.ok(metrics);
        assert.strictEqual(metrics.cachedTokens, 0);
        assert.strictEqual(metrics.savingsPercent, undefined);

        const label = CacheMetricsService.formatCacheLabel(metrics);
        assert.strictEqual(label, '500 tokens');
    });

    it('handles invalid or empty raw usage payloads gracefully', () => {
        assert.strictEqual(CacheMetricsService.normalizeUsage(null, 'openai'), undefined);
        assert.strictEqual(CacheMetricsService.normalizeUsage(undefined, 'anthropic'), undefined);
        assert.strictEqual(CacheMetricsService.normalizeUsage('string', 'gemini'), undefined);
        assert.strictEqual(CacheMetricsService.normalizeUsage({}, 'openai'), undefined);
    });

    it('formats numbers compactly', () => {
        assert.strictEqual(CacheMetricsService.formatNumber(350), '350');
        assert.strictEqual(CacheMetricsService.formatNumber(1000), '1k');
        assert.strictEqual(CacheMetricsService.formatNumber(2400), '2.4k');
        assert.strictEqual(CacheMetricsService.formatNumber(12500), '13k');
    });
});
