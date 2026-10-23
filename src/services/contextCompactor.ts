import { BaseProvider } from '../providers/baseProvider';
import { Logger } from '../utils/logger';

export interface ChatHistoryItem {
    role: 'user' | 'assistant' | 'system';
    text: string;
    attachments?: Array<{ name: string; type: string; data: string }>;
    usage?: any;
}

export interface CompactionResult {
    summary: string;
    compactedCount: number;
    savedTokens: number;
    remainingHistory: ChatHistoryItem[];
}

export class ContextCompactor {
    // Number of recent turns (user + assistant) to preserve verbatim
    public static readonly PRESERVED_RECENT_TURNS = 4;
    // Turn threshold where auto-compaction becomes beneficial
    public static readonly AUTO_COMPACT_MIN_TURNS = 10;
    // Token threshold where auto-compaction triggers automatically
    public static readonly AUTO_COMPACT_TOKEN_THRESHOLD = 6000;

    /**
     * Fast heuristic token estimation (~4 characters per token on average).
     */
    public static estimateTokens(text: string): number {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    }

    /**
     * Estimates total tokens in a chat history array.
     */
    public static estimateHistoryTokens(history: ChatHistoryItem[]): number {
        return history.reduce((sum, item) => sum + this.estimateTokens(item.text), 0);
    }

    /**
     * Compacts older turns in the chat history into a dense, structured context summary.
     * Preserves the most recent N turns verbatim for conversational continuity.
     */
    public static async compactHistory(
        history: ChatHistoryItem[],
        provider?: BaseProvider,
        modelId?: string
    ): Promise<CompactionResult> {
        if (!history || history.length <= this.PRESERVED_RECENT_TURNS) {
            return {
                summary: '',
                compactedCount: 0,
                savedTokens: 0,
                remainingHistory: history
            };
        }

        const splitIndex = history.length - this.PRESERVED_RECENT_TURNS;
        const olderItems = history.slice(0, splitIndex);
        const remainingHistory = history.slice(splitIndex);

        const priorTokens = this.estimateHistoryTokens(olderItems);

        let summary = '';

        // If an active provider is supplied, attempt an AI-generated executive summary
        if (provider && modelId) {
            try {
                summary = await this.generateAiSummary(olderItems, provider, modelId);
            } catch (err: any) {
                Logger.warn('AI-assisted compaction failed; falling back to deterministic compactor: ' + err.message);
                summary = this.generateDeterministicSummary(olderItems);
            }
        } else {
            summary = this.generateDeterministicSummary(olderItems);
        }

        const summaryTokens = this.estimateTokens(summary);
        const savedTokens = Math.max(0, priorTokens - summaryTokens);

        return {
            summary,
            compactedCount: olderItems.length,
            savedTokens,
            remainingHistory
        };
    }

    /**
     * Deterministic, zero-latency offline compactor.
     * Extracts key user questions, files referenced, and assistant takeaways without sending extra LLM requests.
     */
    public static generateDeterministicSummary(items: ChatHistoryItem[]): string {
        const bullets: string[] = [];
        const filesReferenced = new Set<string>();

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const text = item.text || '';

            // Detect active file references or file contexts
            const fileMatches = text.match(/(?:--- Active File: ([^\s-]+) ---|File: `([^`]+)`)/g);
            if (fileMatches) {
                for (const match of fileMatches) {
                    const cleanName = match.replace(/--- Active File:\s*|\s*---|File:\s*`|`/g, '').trim();
                    if (cleanName) filesReferenced.add(cleanName);
                }
            }

            if (item.role === 'user') {
                // Strip raw code blocks to save space
                const cleanUserText = text
                    .replace(/```[\s\S]*?```/g, '[Code snippet provided]')
                    .replace(/--- (?:Active File|Attached File)[\s\S]*?---/g, '')
                    .trim();

                const firstLine = cleanUserText.split('\n')[0].substring(0, 140).trim();
                if (firstLine) {
                    bullets.push(`- User queried/instructed: "${firstLine}${cleanUserText.length > 140 ? '...' : ''}"`);
                }
            } else if (item.role === 'assistant') {
                // Extract headings or first key conclusion
                const headings = text.match(/^#{1,3}\s+(.+)$/gm);
                if (headings && headings.length > 0) {
                    const keyPoints = headings.slice(0, 2).map(h => h.replace(/^#{1,3}\s+/, '').trim()).join('; ');
                    bullets.push(`  - Assistant addressed: ${keyPoints}`);
                } else {
                    const firstNonEmpty = text.split('\n').find(l => l.trim().length > 0 && !l.startsWith('>')) || '';
                    const snippet = firstNonEmpty.substring(0, 120).trim();
                    if (snippet) {
                        bullets.push(`  - Assistant outcome: "${snippet}..."`);
                    }
                }
            }
        }

        let fileSummary = '';
        if (filesReferenced.size > 0) {
            fileSummary = `\nFiles/Contexts referenced earlier: ${Array.from(filesReferenced).map(f => `\`${f}\``).join(', ')}`;
        }

        return `[COMPACTED CONTEXT SUMMARY - ${items.length} EARLIER TURNS]\n` +
            `The following summary condenses earlier turns to minimize tokens while preserving vital background:\n` +
            bullets.join('\n') +
            fileSummary +
            `\n[END COMPACTED CONTEXT SUMMARY]`;
    }

    /**
     * AI-generated summary using the active provider.
     */
    private static async generateAiSummary(
        items: ChatHistoryItem[],
        provider: BaseProvider,
        modelId: string
    ): Promise<string> {
        const transcript = items.map(item => `${item.role.toUpperCase()}: ${item.text.substring(0, 1000)}`).join('\n\n');

        const prompt = `Condense the following conversation history into a dense, high-utility context summary. Focus on:
1. User goals and technical requests
2. Files, functions, and architecture discussed
3. Technical decisions or constraints finalized
4. Specific code state or pending tasks

Keep the summary under 250 words. Format as structured bullet points.

Conversation:
${transcript}`;

        const abortCtrl = new AbortController();
        const timeout = setTimeout(() => abortCtrl.abort(), 12000);

        let result = '';
        try {
            const stream = provider.streamChat(
                [{ role: 'user', content: prompt }],
                modelId,
                abortCtrl.signal
            );

            for await (const chunk of stream) {
                result += chunk.text;
            }
        } finally {
            clearTimeout(timeout);
        }

        if (!result.trim()) {
            throw new Error('Empty summary returned by model');
        }

        return `[COMPACTED CONTEXT SUMMARY - ${items.length} EARLIER TURNS]\n` +
            result.trim() +
            `\n[END COMPACTED CONTEXT SUMMARY]`;
    }
}
