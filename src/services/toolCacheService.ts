export class ToolCacheService {
    private static cache = new Map<string, string>();
    private static readonly IDEMPOTENT_TOOLS = new Set([
        'workspace_read_file',
        'workspace_read_files',
        'workspace_list_dir',
        'workspace_get_context',
        'workspace_search_files'
    ]);

    /**
     * Checks whether a tool is idempotent and safe to cache.
     */
    public static isIdempotent(toolName: string): boolean {
        return this.IDEMPOTENT_TOOLS.has(toolName);
    }

    /**
     * Retrieves a cached tool execution result if available.
     */
    public static get(toolName: string, args: any): string | null {
        if (!this.isIdempotent(toolName)) return null;
        const key = `${toolName}:${JSON.stringify(args || {})}`;
        return this.cache.get(key) || null;
    }

    /**
     * Caches a tool execution result.
     */
    public static set(toolName: string, args: any, result: string): void {
        if (!this.isIdempotent(toolName)) return;
        const key = `${toolName}:${JSON.stringify(args || {})}`;
        this.cache.set(key, result);
    }

    /**
     * Invalidates the cache (called when mutating tools like write/edit run).
     */
    public static invalidate(): void {
        this.cache.clear();
    }

    /**
     * Resets the entire cache.
     */
    public static reset(): void {
        this.cache.clear();
    }

    /**
     * Smart structured truncation preserving file head (imports, types, headers)
     * and tail (exports, returns) rather than arbitrary slicing.
     */
    public static smartTruncate(contentStr: string, maxChars = 8000): string {
        if (typeof contentStr !== 'string' || contentStr.length <= maxChars) {
            return contentStr;
        }

        const lines = contentStr.split('\n');
        if (lines.length <= 60) {
            return contentStr.slice(0, maxChars) + '\n... [Remaining output truncated]';
        }

        const headCount = Math.min(100, Math.floor(lines.length * 0.4));
        const tailCount = Math.min(40, Math.floor(lines.length * 0.2));
        const omittedCount = lines.length - headCount - tailCount;

        if (omittedCount <= 10) {
            return contentStr.slice(0, maxChars) + '\n... [Remaining output truncated]';
        }

        const head = lines.slice(0, headCount).join('\n');
        const tail = lines.slice(lines.length - tailCount).join('\n');
        const summary = `\n\n... [Omitted ${omittedCount} intermediate lines to protect context window. Target specific sections or line ranges if needed] ...\n\n`;

        const truncated = head + summary + tail;
        if (truncated.length > maxChars) {
            return head.slice(0, Math.floor(maxChars * 0.7)) + summary + tail.slice(-Math.floor(maxChars * 0.25));
        }

        return truncated;
    }
}
