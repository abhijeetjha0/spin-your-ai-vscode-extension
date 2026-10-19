import { WorkspaceService, FileDiffInfo } from './workspaceService';
import { Logger } from '../utils/logger';

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
    public static getToolDefinitions(): any[] {
        return [
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
            }
        ];
    }

    /**
     * Checks if a tool name is one of the built-in workspace agent tools.
     */
    public static isAgentTool(toolName: string): boolean {
        return toolName.startsWith('workspace_');
    }

    /**
     * Executes a built-in workspace agent tool.
     */
    public static async executeTool(toolName: string, args: any): Promise<any> {
        switch (toolName) {
            case 'workspace_get_context': {
                return await WorkspaceService.getWorkspaceContext();
            }

            case 'workspace_list_dir': {
                const dirPath = args.dir_path || '.';
                const items = await WorkspaceService.listDirectory(dirPath);
                return {
                    directory: dirPath,
                    items: items.map(i => `${i.name}${i.isDirectory ? '/' : ''}`)
                };
            }

            case 'workspace_read_file': {
                if (!args.file_path) {
                    throw new Error('Missing required argument: "file_path"');
                }
                const content = await WorkspaceService.readFile(args.file_path);
                return {
                    file_path: args.file_path,
                    content
                };
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
                return {
                    query: args.query,
                    results
                };
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
