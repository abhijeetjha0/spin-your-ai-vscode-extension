import * as vscode from 'vscode';

export interface SlashCommand {
  name: string;
  command: string;
  label: string;
  icon: string;
  category: 'Prompt' | 'Multi-Agent' | 'Scope' | 'Skill' | 'Action';
  description: string;
  type: 'prompt' | 'skill' | 'scope' | 'action';
  template?: string;
  actionId?: string;
  skillName?: string;
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
  // Prompts
  {
    name: 'plan',
    command: '/plan',
    label: 'Plan',
    icon: 'architecture',
    category: 'Prompt',
    description: 'Generate a detailed, step-by-step implementation plan for a task',
    type: 'prompt',
    template: 'Please outline a comprehensive, step-by-step implementation plan for: '
  },
  {
    name: 'explain',
    command: '/explain',
    label: 'Explain',
    icon: 'psychology',
    category: 'Prompt',
    description: 'Explain active selection, code, or context in depth',
    type: 'prompt',
    template: 'Please explain the following code and concepts in detail:\n\n'
  },
  {
    name: 'refactor',
    command: '/refactor',
    label: 'Refactor',
    icon: 'auto_fix_high',
    category: 'Prompt',
    description: 'Refactor code for better readability, structure, and performance',
    type: 'prompt',
    template: 'Please refactor the following code for better readability and performance:\n\n'
  },
  {
    name: 'fix',
    command: '/fix',
    label: 'Fix',
    icon: 'bug_report',
    category: 'Prompt',
    description: 'Diagnose syntax, logic, or runtime issues and provide verified solutions',
    type: 'prompt',
    template: 'Please diagnose and fix the issue in the following:\n\n'
  },
  {
    name: 'test',
    command: '/test',
    label: 'Test',
    icon: 'science',
    category: 'Prompt',
    description: 'Generate comprehensive unit tests, edge cases, and assertion suites',
    type: 'prompt',
    template: 'Please write comprehensive unit tests and edge cases for the following:\n\n'
  },
  {
    name: 'summarize',
    command: '/summarize',
    label: 'Summarize',
    icon: 'summarize',
    category: 'Prompt',
    description: 'Summarize the active document, file, or discussion concisely',
    type: 'prompt',
    template: 'Please provide a concise, structured summary of the current context:\n\n'
  },
  {
    name: 'search',
    command: '/search',
    label: 'Search',
    icon: 'search',
    category: 'Prompt',
    description: 'Search workspace files, code symbols, or context',
    type: 'prompt',
    template: 'Please search the workspace for: '
  },

  // Multi-Agent Orchestration
  {
    name: 'subagent',
    command: '/subagent',
    label: 'Subagent',
    icon: 'account_tree',
    category: 'Multi-Agent',
    description: 'Spin specialized autonomous sub-agent(s) with dedicated roles and tasks',
    type: 'prompt',
    template: 'Can you spin up specialized sub-agents from different perspectives to analyze: '
  },

  // Context Scope
  {
    name: 'file',
    command: '/file',
    label: 'File Scope',
    icon: 'draft',
    category: 'Scope',
    description: 'Focus and attach active file content',
    type: 'prompt',
    template: '@file '
  },
  {
    name: 'workspace',
    command: '/workspace',
    label: 'Workspace Scope',
    icon: 'folder',
    category: 'Scope',
    description: 'Inject workspace file structure and project context',
    type: 'prompt',
    template: '@workspace '
  },

  // Actions
  {
    name: 'history',
    command: '/history',
    label: 'Chat History',
    icon: 'history',
    category: 'Action',
    description: 'Open chat sessions and conversation history',
    type: 'action',
    actionId: 'history'
  },
  {
    name: 'compact',
    command: '/compact',
    label: 'Compact Context',
    icon: 'compress',
    category: 'Action',
    description: 'Trigger manual context compaction to compress history and save tokens',
    type: 'action',
    actionId: 'compact'
  },
  {
    name: 'refresh',
    command: '/refresh',
    label: 'Refresh Models & Skills',
    icon: 'refresh',
    category: 'Action',
    description: 'Reload AI models and refresh workspace skills',
    type: 'action',
    actionId: 'refresh'
  },
  {
    name: 'clear',
    command: '/clear',
    label: 'Clear Chat',
    icon: 'delete_sweep',
    category: 'Action',
    description: 'Reset conversation history and clear active sub-agents',
    type: 'action',
    actionId: 'clear'
  },
  {
    name: 'help',
    command: '/help',
    label: 'Help',
    icon: 'help',
    category: 'Action',
    description: 'Display commands reference manual and keyboard shortcuts',
    type: 'action',
    actionId: 'help'
  }
];

export class SlashCommandService {
  private static cachedSkills: SlashCommand[] = [];
  private static lastScannedTime = 0;
  private static CACHE_TTL_MS = 15000; // 15 seconds

  /**
   * Parses YAML frontmatter from a SKILL.md file content.
   */
  public static parseSkillFrontmatter(content: string, fallbackName?: string): { name: string; description: string } | null {
    if (typeof content !== 'string') return null;

    const match = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
    if (!match) {
      if (fallbackName) {
        return { name: fallbackName, description: `Project skill: ${fallbackName}` };
      }
      return null;
    }

    const yamlBlock = match[1];
    let name = '';
    let description = '';

    const nameMatch = yamlBlock.match(/^name:\s*["']?([^"'\r\n]+)["']?/m);
    if (nameMatch) {
      name = nameMatch[1].trim();
    } else if (fallbackName) {
      name = fallbackName;
    }

    const descMatch = yamlBlock.match(/^description:\s*(?:[>|]-?\s*[\r\n]+([\s\S]*?)(?=(?:^[\w-]+:)|$)|["']?([^"'\r\n]+)["']?)/m);
    if (descMatch) {
      if (descMatch[1]) {
        description = descMatch[1].split(/[\r\n]+/).map(s => s.trim()).filter(Boolean).join(' ');
      } else if (descMatch[2]) {
        description = descMatch[2].trim();
      }
    }

    if (!name) return null;

    return {
      name,
      description: description || `Project skill: ${name}`
    };
  }

  /**
   * Converts a parsed skill into a dynamic SlashCommand object.
   */
  public static createSkillCommand(skill: { name: string; description: string }): SlashCommand {
    const commandName = skill.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return {
      name: commandName,
      command: `/${commandName}`,
      label: skill.name,
      icon: 'auto_awesome',
      category: 'Skill',
      description: skill.description || `Execute project skill: ${skill.name}`,
      type: 'skill',
      skillName: skill.name,
      template: `Use skill: ${skill.name}\nTask: `
    };
  }

  /**
   * Dynamically scans the workspace for all .agents/.../SKILL.md files with zero hardcoding.
   */
  public static async discoverSkills(forceRefresh = false): Promise<SlashCommand[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedSkills.length > 0 && now - this.lastScannedTime < this.CACHE_TTL_MS) {
      return this.cachedSkills;
    }

    const discovered: SlashCommand[] = [];
    const seen = new Set<string>();
    try {
      const skillUris = await vscode.workspace.findFiles('**/.agents/**/SKILL.md', '**/node_modules/**');
      for (const uri of skillUris) {
        try {
          const raw = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(raw).toString('utf8');
          
          // Determine folder name fallback
          const parts = uri.fsPath.replace(/\\/g, '/').split('/');
          const skillIndex = parts.lastIndexOf('SKILL.md');
          const folderName = skillIndex > 0 ? parts[skillIndex - 1] : undefined;

          const parsed = this.parseSkillFrontmatter(content, folderName);
          if (parsed) {
            const cmd = this.createSkillCommand(parsed);
            const key = cmd.command.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              discovered.push(cmd);
            }
          }
        } catch {
          // skip invalid files
        }
      }
    } catch {
      // workspace not open or error searching
    }

    this.cachedSkills = discovered;
    this.lastScannedTime = now;
    return discovered;
  }

  /**
   * Returns all available commands (base commands + dynamically discovered skills), deduplicated.
   */
  public static async getAllCommands(forceRefresh = false): Promise<SlashCommand[]> {
    const dynamicSkills = await this.discoverSkills(forceRefresh);
    const seen = new Set<string>();
    const unique: SlashCommand[] = [];
    for (const cmd of [...BASE_SLASH_COMMANDS, ...dynamicSkills]) {
      const key = cmd.command.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(cmd);
      }
    }
    return unique;
  }

  /**
   * Filters commands by query string (matching name, command, label, description, or category),
   * sorted by relevance (exact match first, then prefix match).
   */
  public static async filterCommands(query = '', forceRefresh = false): Promise<SlashCommand[]> {
    const all = await this.getAllCommands(forceRefresh);
    const normalized = query.replace(/^\//, '').trim().toLowerCase();
    if (!normalized) {
      return all;
    }

    const matches = all.filter(cmd =>
      cmd.name.toLowerCase().includes(normalized) ||
      cmd.command.toLowerCase().includes(normalized) ||
      cmd.label.toLowerCase().includes(normalized) ||
      cmd.description.toLowerCase().includes(normalized) ||
      cmd.category.toLowerCase().includes(normalized)
    );

    return matches.sort((a, b) => {
      const aCmd = a.command.toLowerCase().replace(/^\//, '');
      const bCmd = b.command.toLowerCase().replace(/^\//, '');
      const aExact = aCmd === normalized ? 0 : 1;
      const bExact = bCmd === normalized ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      const aStarts = aCmd.startsWith(normalized) ? 0 : 1;
      const bStarts = bCmd.startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;

      return aCmd.localeCompare(bCmd);
    });
  }

  /**
   * Extracts slash query from input text at given cursor position.
   */
  public static extractSlashQuery(text = '', cursorPos = 0): { isMatch: boolean; query?: string; slashIndex?: number; endIndex?: number } {
    if (typeof text !== 'string' || cursorPos <= 0) {
      return { isMatch: false };
    }

    const textBeforeCursor = text.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);

    if (!match) {
      return { isMatch: false };
    }

    const query = match[1];
    const slashIndex = textBeforeCursor.lastIndexOf('/' + query);

    return {
      isMatch: true,
      query,
      slashIndex,
      endIndex: cursorPos
    };
  }

  /**
   * Resets internal cache (useful for testing or full refresh).
   */
  public static resetCache(): void {
    this.cachedSkills = [];
    this.lastScannedTime = 0;
  }
}
