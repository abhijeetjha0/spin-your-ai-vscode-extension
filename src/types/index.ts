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
}

export interface StreamChunk {
    text: string;
    done: boolean;
}
