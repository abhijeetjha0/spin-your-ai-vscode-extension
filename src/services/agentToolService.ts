import { WorkspaceService, FileDiffInfo } from './workspaceService';
import { Logger } from '../utils/logger';
import { SubagentService } from './subagentService';
import { ToolCacheService } from './toolCacheService';

export interface ToolPermissionRequest {
    requestId: string;
    toolName: string;
    filePath: string;
    isNew: boolean;
    diffText: string;
}

export type PermissionRequestHandler = (req: ToolPermissionRequest) => Promise<boolean>;

export class AgentToolService {
    private static permissionHandler?: PermissionRequestHandler;
    private static pendingConfirmations = new Map<string, (approved: boolean) => void>();

    /**
     * Register the UI permission prompt handler (typically registered by ChatSidebarViewProvider).
     */
    public static setPermissionHandler(handler: PermissionRequestHandler) {
        this.permissionHandler = handler;
    }

    /**
     * Resolve a pending permission request when the user clicks Approve or Reject in the UI.
     */
    public static resolvePermission(requestId: string, approved: boolean) {
        const resolver = this.pendingConfirmations.get(requestId);
        if (resolver) {
            resolver(approved);
            this.pendingConfirmations.delete(requestId);
        }
    }

    /**
     * Returns built-in workspace agent tool schemas to supply to the LLM.
     */
    public static getToolDefinitions(options?: { isSubagent?: boolean }): any[] {
        const isSub = options?.isSubagent || SubagentService.isInsideSubagent();
        const tools: any[] = [
            {
                type: 'function',
                function: {
                    name: 'workspace_get_context',
                    description: 'Get an overview of the current workspace directory tree, indexed files, and active editor file.',
                    parameters: {
                        type: 'object',
                        properties: {}
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_list_dir',
                    description: 'List files and directories within a workspace directory.',
                    parameters: {
                        type: 'object',
                        properties: {
                            dir_path: {
                                type: 'string',
                                description: 'Relative path of directory to inspect (e.g. "." for workspace root).'
                            }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_read_file',
                    description: 'Read the text content of a file within the workspace.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file_path: {
                                type: 'string',
                                description: 'Relative path of the file to read.'
                            }
                        },
                        required: ['file_path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_read_files',
                    description: 'Read the text contents of multiple files in parallel in a single tool call. Maximizes efficiency and minimizes turns.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file_paths: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of relative file paths to read concurrently.'
                            }
                        },
                        required: ['file_paths']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_search_files',
                    description: 'Search for text or regex across workspace files. Returns matching relative file paths, line numbers, and code snippets without reading every file individually.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The text query or pattern to search for across the workspace.'
                            },
                            file_pattern: {
                                type: 'string',
                                description: 'Optional glob filter (e.g. "**/*.ts", "src/**", "*.json").'
                            },
                            max_results: {
                                type: 'number',
                                description: 'Maximum number of matches to return (default: 30).'
                            }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_write_file',
                    description: 'Create a new file or completely overwrite an existing file. User permission with diff preview will be requested before modifying anything.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file_path: {
                                type: 'string',
                                description: 'Relative path of the file to create or overwrite.'
                            },
                            content: {
                                type: 'string',
                                description: 'The complete text content to write into the file.'
                            }
                        },
                        required: ['file_path', 'content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'workspace_edit_file',
                    description: 'Replaces specific existing content in a workspace file with replacement content. User permission with diff preview will be requested before modifying anything.',
                    parameters: {
                        type: 'object',
                        properties: {
                            file_path: {
                                type: 'string',
                                description: 'Relative path of the file to edit.'
                            },
                            target_content: {
                                type: 'string',
                                description: 'The exact lines or block of text in the file to replace.'
                            },
                            replacement_content: {
                                type: 'string',
                                description: 'The replacement lines or block of text.'
                            }
                        },
                        required: ['file_path', 'target_content', 'replacement_content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'spin_subagent',
                    description: 'Spin up a specialized, autonomous sub-agent to handle a focused subtask (e.g. image/diagram inspection, isolated code analysis, workspace search, data extraction, or deep research). Maintains its own isolated context and returns a comprehensive result. Specify subagent_id to resume an existing sub-agent. IMPORTANT: Only spin the exact number of sub-agents requested by the user. Do not spawn recursive or redundant sub-agents. Once all requested sub-agents complete, synthesize their results and directly answer the user.',
                    parameters: {
                        type: 'object',
                        properties: {
                            role: {
                                type: 'string',
                                description: 'The specialized role/persona of the sub-agent (e.g., "Multimodal Vision Analyst", "Code Inspector", "Security Auditor", "Research Specialist").'
                            },
                            task: {
                                type: 'string',
                                description: 'The exact task, question, or goal the sub-agent must execute.'
                            },
                            context: {
                                type: 'string',
                                description: 'Optional background context, data, code, or details necessary for the sub-agent.'
                            },
                            subagent_id: {
                                type: 'string',
                                description: 'Optional ID of a previously spun sub-agent to continue its existing conversation context.'
                            },
                            max_turns: {
                                type: 'number',
                                description: 'Optional maximum tool turns budget for this sub-agent (default 12 for deep skill tasks, 5 for simple tasks).'
                            }
                        },
                        required: ['role', 'task']
                    }
                }
            }
        ];

        return isSub ? tools.filter(t => t.function.name !== 'spin_subagent') : tools;
    }

    /**
     * Checks if a tool name is one of the built-in workspace agent tools.
     */
    public static isAgentTool(toolName: string): boolean {
        return toolName.startsWith('workspace_') || toolName === 'spin_subagent';
    }

    /**
     * Executes a built-in workspace agent tool.
     */
    public static async executeTool(toolName: string, args: any): Promise<any> {
        const cached = ToolCacheService.get(toolName, args);
        if (cached !== null) {
            try {
                return JSON.parse(cached);
            } catch {
                return cached;
            }
        }

        switch (toolName) {
            case 'spin_subagent': {
                // 1. Strict Recursion Guard: Sub-agents are leaf agents and cannot spawn nested sub-agents
                if (SubagentService.isInsideSubagent()) {
                    return {
                        error: 'Action blocked: Sub-agents are leaf agents and cannot spawn nested sub-agents. Please perform your assigned task directly.'
                    };
                }

                // 2. Turn safety limit: Prevent infinite loop or over-delegation beyond limit
                if (SubagentService.getTurnSubagentCount() >= SubagentService.MAX_SUBAGENTS_PER_TURN) {
                    return {
                        error: `Turn sub-agent limit reached (maximum ${SubagentService.MAX_SUBAGENTS_PER_TURN} sub-agents per turn). Do not spin any more sub-agents. Synthesize the findings from the sub-agents above and provide your final response to the user now.`
                    };
                }
                SubagentService.incrementTurnSubagentCount();

                return await SubagentService.spinSubagent({
                    role: args.role,
                    task: args.task,
                    context: args.context,
                    subagentId: args.subagent_id,
                    maxTurns: typeof args.max_turns === 'number' ? args.max_turns : undefined
                });
            }

            case 'workspace_get_context': {
                const res = await WorkspaceService.getWorkspaceContext();
                ToolCacheService.set(toolName, args, JSON.stringify(res));
                return res;
            }

            case 'workspace_list_dir': {
                const dirPath = args.dir_path || '.';
                const items = await WorkspaceService.listDirectory(dirPath);
                const res = {
                    directory: dirPath,
                    items: items.map(i => `${i.name}${i.isDirectory ? '/' : ''}`)
                };
                ToolCacheService.set(toolName, args, JSON.stringify(res));
                return res;
            }

            case 'workspace_read_file': {
                if (!args.file_path) {
                    throw new Error('Missing required argument: "file_path"');
                }
                const content = await WorkspaceService.readFile(args.file_path);
                const res = {
                    file_path: args.file_path,
                    content
                };
                ToolCacheService.set(toolName, args, JSON.stringify(res));
                return res;
            }

            case 'workspace_read_files': {
                const paths = Array.isArray(args.file_paths) ? args.file_paths : [];
                if (paths.length === 0) {
                    throw new Error('Missing or empty required argument: "file_paths"');
                }
                const files = await WorkspaceService.readMultipleFiles(paths);
                const res = { files };
                ToolCacheService.set(toolName, args, JSON.stringify(res));
                return res;
            }

            case 'workspace_search_files': {
                if (!args.query) {
                    throw new Error('Missing required argument: "query"');
                }
                const results = await WorkspaceService.searchFiles(
                    args.query,
                    args.file_pattern,
                    typeof args.max_results === 'number' ? args.max_results : 30
                );
                const res = {
                    query: args.query,
                    results
                };
                ToolCacheService.set(toolName, args, JSON.stringify(res));
                return res;
            }

            case 'workspace_write_file': {
                if (!args.file_path || args.content === undefined) {
                    throw new Error('Missing required arguments: "file_path" and "content"');
                }

                const diffInfo = await WorkspaceService.prepareWriteDiff(args.file_path, args.content);
                const approved = await this.askUserPermission('workspace_write_file', diffInfo);

                if (!approved) {
                    return {
                        success: false,
                        file_path: args.file_path,
                        message: `User rejected permission to create/overwrite file: "${args.file_path}". No changes were made.`
                    };
                }

                await WorkspaceService.applyWrite(args.file_path, args.content);
                ToolCacheService.invalidate();
                return {
                    success: true,
                    file_path: args.file_path,
                    message: `File "${args.file_path}" was successfully saved.`
                };
            }

            case 'workspace_edit_file': {
                if (!args.file_path || !args.target_content || args.replacement_content === undefined) {
                    throw new Error('Missing required arguments: "file_path", "target_content", and "replacement_content"');
                }

                const diffInfo = await WorkspaceService.prepareEditDiff(
                    args.file_path,
                    args.target_content,
                    args.replacement_content
                );
                const approved = await this.askUserPermission('workspace_edit_file', diffInfo);

                if (!approved) {
                    return {
                        success: false,
                        file_path: args.file_path,
                        message: `User rejected permission to edit file: "${args.file_path}". No changes were made.`
                    };
                }

                await WorkspaceService.applyWrite(args.file_path, diffInfo.newContent);
                ToolCacheService.invalidate();
                return {
                    success: true,
                    file_path: args.file_path,
                    message: `File "${args.file_path}" was successfully updated.`
                };
            }

            default:
                throw new Error(`Unknown workspace agent tool: ${toolName}`);
        }
    }

    /**
     * Prompts the user via Webview for approval before destructive/modifying operations.
     */
    private static async askUserPermission(toolName: string, diffInfo: FileDiffInfo): Promise<boolean> {
        if (!this.permissionHandler) {
            Logger.warn('No permission handler registered; defaulting to rejection for safety.');
            return false;
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const permissionPromise = new Promise<boolean>((resolve) => {
            this.pendingConfirmations.set(requestId, resolve);

            // Timeout after 3 minutes if no response from user
            const timer = setTimeout(() => {
                if (this.pendingConfirmations.has(requestId)) {
                    this.pendingConfirmations.delete(requestId);
                    resolve(false);
                }
            }, 180000);
            if (typeof (timer as any)?.unref === 'function') {
                (timer as any).unref();
            }
        });

        const req: ToolPermissionRequest = {
            requestId,
            toolName,
            filePath: diffInfo.filePath,
            isNew: diffInfo.isNew,
            diffText: diffInfo.diffText
        };

        // Notify UI handler
        this.permissionHandler(req).catch((err) => {
            Logger.error('Failed to trigger permission prompt:', err);
            this.resolvePermission(requestId, false);
        });

        return await permissionPromise;
    }
}
