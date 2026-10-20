import * as assert from 'assert';
import { SlashCommandService, BASE_SLASH_COMMANDS } from '../services/slashCommandService';

declare const global: any;

describe('SlashCommandService', () => {
    beforeEach(() => {
        global.__vscodeMockState.workspaceFolders = [
            { name: 'test-workspace', uri: { fsPath: '/test/workspace', path: '/test/workspace' } }
        ];
        global.__vscodeMockState.files.clear();
        global.__vscodeMockState.directories.clear();
        SlashCommandService.resetCache();
    });

    it('provides all base multimodal commands and categories', () => {
        const names = BASE_SLASH_COMMANDS.map(c => c.name);
        
        // Prompts
        assert.ok(names.includes('plan'), 'Includes /plan');
        assert.ok(names.includes('explain'), 'Includes /explain');
        assert.ok(names.includes('refactor'), 'Includes /refactor');
        assert.ok(names.includes('fix'), 'Includes /fix');
        assert.ok(names.includes('test'), 'Includes /test');
        assert.ok(names.includes('summarize'), 'Includes /summarize');
        assert.ok(names.includes('search'), 'Includes /search');

        // Multi-Agent
        assert.ok(names.includes('subagent'), 'Includes /subagent');

        // Scope
        assert.ok(names.includes('file'), 'Includes /file');
        assert.ok(names.includes('workspace'), 'Includes /workspace');

        // Actions
        assert.ok(names.includes('history'), 'Includes /history');
        assert.ok(names.includes('compact'), 'Includes /compact');
        assert.ok(names.includes('refresh'), 'Includes /refresh');
        assert.ok(names.includes('clear'), 'Includes /clear');
        assert.ok(names.includes('help'), 'Includes /help');
    });

    it('dynamically parses YAML frontmatter with zero hardcoding', () => {
        const skillMd = `---
name: feature-planner
description: >-
  Outlines a feature implementation plan adhering to project guidelines.
author: "Test Author"
---

# Feature Planner Instructions`;

        const parsed = SlashCommandService.parseSkillFrontmatter(skillMd);
        assert.ok(parsed);
        assert.strictEqual(parsed.name, 'feature-planner');
        assert.ok(parsed.description.includes('Outlines a feature implementation plan'));

        const cmd = SlashCommandService.createSkillCommand(parsed);
        assert.strictEqual(cmd.name, 'feature-planner');
        assert.strictEqual(cmd.command, '/feature-planner');
        assert.strictEqual(cmd.category, 'Skill');
        assert.strictEqual(cmd.type, 'skill');
        assert.strictEqual(cmd.icon, 'auto_awesome');
        assert.ok(cmd.template?.includes('feature-planner'));
    });

    it('handles single-line descriptions and fallback names', () => {
        const skillMd = `---
name: quick-audit
description: "Perform immediate quick code audit"
---`;
        const parsed = SlashCommandService.parseSkillFrontmatter(skillMd);
        assert.ok(parsed);
        assert.strictEqual(parsed.name, 'quick-audit');
        assert.strictEqual(parsed.description, 'Perform immediate quick code audit');

        // Fallback when missing frontmatter
        const fallbackParsed = SlashCommandService.parseSkillFrontmatter('No frontmatter', 'fallback-skill');
        assert.ok(fallbackParsed);
        assert.strictEqual(fallbackParsed.name, 'fallback-skill');
    });

    it('dynamically discovers workspace skills from .agents/ directory', async () => {
        global.__vscodeMockState.files.set(
            '/test/workspace/.agents/skills/project-explainer/SKILL.md',
            `---
name: project-explainer
description: Deep scan and explain project architecture.
---`
        );
        global.__vscodeMockState.files.set(
            '/test/workspace/.agents/skills/test-generator/SKILL.md',
            `---
name: test-generator
description: Generate unit and integration test suites.
---`
        );
        // Non-skill file that should be ignored
        global.__vscodeMockState.files.set(
            '/test/workspace/src/index.ts',
            'console.log("hello");'
        );

        const skills = await SlashCommandService.discoverSkills(true);
        assert.strictEqual(skills.length, 2);
        const skillNames = skills.map(s => s.name);
        assert.ok(skillNames.includes('project-explainer'));
        assert.ok(skillNames.includes('test-generator'));

        // getAllCommands includes both base commands and dynamic skills
        const all = await SlashCommandService.getAllCommands();
        assert.ok(all.some(c => c.name === 'project-explainer'));
        assert.ok(all.some(c => c.name === 'plan'));
    });

    it('filters commands accurately with queries and prioritizes exact match', async () => {
        global.__vscodeMockState.files.set(
            '/test/workspace/.agents/skills/code-cleaner/SKILL.md',
            `---
name: code-cleaner
description: Clean up redundant code and imports.
---`
        );
        global.__vscodeMockState.files.set(
            '/test/workspace/.agents/skills/test-generator/SKILL.md',
            `---
name: test-generator
description: Generate unit and integration test suites.
---`
        );

        const planResults = await SlashCommandService.filterCommands('plan', true);
        assert.ok(planResults.some(c => c.name === 'plan'));

        const cleanResults = await SlashCommandService.filterCommands('/cle');
        assert.ok(cleanResults.some(c => c.name === 'code-cleaner'));
        assert.ok(cleanResults.some(c => c.name === 'clear'));

        const actionResults = await SlashCommandService.filterCommands('/hist');
        assert.ok(actionResults.some(c => c.name === 'history'));

        // Querying /test should have exact match '/test' first and no duplicates
        const testResults = await SlashCommandService.filterCommands('/test');
        assert.strictEqual(testResults[0].command, '/test', 'Exact /test must be ranked first');
        assert.ok(testResults.some(c => c.command === '/test-generator'));
        
        // Ensure no duplicates exist in testResults
        const commandCounts = new Map<string, number>();
        for (const c of testResults) {
            commandCounts.set(c.command, (commandCounts.get(c.command) || 0) + 1);
        }
        for (const [cmd, count] of commandCounts.entries()) {
            assert.strictEqual(count, 1, `Command ${cmd} should not be duplicated`);
        }
    });

    it('deduplicates skills across multi-root workspace folders', async () => {
        global.__vscodeMockState.workspaceFolders = [
            { name: 'root-1', uri: { fsPath: '/test/workspace1', path: '/test/workspace1' } },
            { name: 'root-2', uri: { fsPath: '/test/workspace2', path: '/test/workspace2' } }
        ];
        global.__vscodeMockState.files.set(
            '/test/workspace1/.agents/skills/common-skill/SKILL.md',
            `---
name: common-skill
description: Common skill in workspace 1.
---`
        );
        global.__vscodeMockState.files.set(
            '/test/workspace2/.agents/skills/common-skill/SKILL.md',
            `---
name: common-skill
description: Common skill in workspace 2.
---`
        );

        const discovered = await SlashCommandService.discoverSkills(true);
        const commonSkills = discovered.filter(s => s.command === '/common-skill');
        assert.strictEqual(commonSkills.length, 1, 'Duplicate skill from second workspace folder must be deduplicated');

        const all = await SlashCommandService.getAllCommands();
        const allCommon = all.filter(s => s.command === '/common-skill');
        assert.strictEqual(allCommon.length, 1, 'getAllCommands must contain exactly one /common-skill');
    });

    it('extracts slash queries from input accurately', () => {
        // Simple start of line
        const r1 = SlashCommandService.extractSlashQuery('/plan', 5);
        assert.strictEqual(r1.isMatch, true);
        assert.strictEqual(r1.query, 'plan');
        assert.strictEqual(r1.slashIndex, 0);

        // Preceded by whitespace
        const r2 = SlashCommandService.extractSlashQuery('Please run /subagent', 20);
        assert.strictEqual(r2.isMatch, true);
        assert.strictEqual(r2.query, 'subagent');
        assert.strictEqual(r2.slashIndex, 11);

        // Trailing query
        const r3 = SlashCommandService.extractSlashQuery('Hello /', 7);
        assert.strictEqual(r3.isMatch, true);
        assert.strictEqual(r3.query, '');

        // Space after slash command is not a match
        const r4 = SlashCommandService.extractSlashQuery('/plan detailed task', 19);
        assert.strictEqual(r4.isMatch, false);

        // No slash
        const r5 = SlashCommandService.extractSlashQuery('Just a regular text', 10);
        assert.strictEqual(r5.isMatch, false);
    });
});
