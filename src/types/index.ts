export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ModelInfo {
    id: string;
    name: string;
    description?: string;
    contextWindow?: number;
}

export interface ProviderConfig {
    id: string;
    name: string;
    type: 'local' | 'cloud' | 'aggregator' | 'platform' | 'mcp';
    baseUrl?: string;
    apiKeyRequired: boolean;
    supportsTools?: boolean;
}

export interface TokenUsageMetrics {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    savingsPercent?: number;
    durationMs?: number;
}

export interface StreamChunk {
    text: string;
    done: boolean;
    usage?: TokenUsageMetrics;
}
