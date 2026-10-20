const Module = require('module');
const path = require('path');

// Global mock state that test suites can manipulate
global.__vscodeMockState = {
    workspaceFolders: [{ name: 'test-workspace', uri: { fsPath: '/mock/workspace', path: '/mock/workspace' } }],
    files: new Map(), // fsPath -> Buffer or string
    directories: new Map(), // fsPath -> [{ name, isDirectory }]
    activeTextEditor: undefined,
    outputLogs: []
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return {
            window: {
                createOutputChannel: (name) => ({
                    name,
                    appendLine: (msg) => {
                        global.__vscodeMockState.outputLogs.push(msg);
                    },
                    show: () => {},
                    dispose: () => {}
                }),
                get activeTextEditor() {
                    return global.__vscodeMockState.activeTextEditor;
                },
                showInformationMessage: async () => {},
                showErrorMessage: async () => {},
                showWarningMessage: async () => {}
            },
            workspace: {
                get workspaceFolders() {
                    return global.__vscodeMockState.workspaceFolders;
                },
                findFiles: async (include, exclude, maxResults) => {
                    const allKeys = Array.from(global.__vscodeMockState.files.keys());
                    const filtered = allKeys.filter(k => {
                        if (exclude) {
                            if (exclude.includes('node_modules') && k.includes('node_modules')) return false;
                            if (exclude.includes('.git') && k.includes('.git')) return false;
                            if (exclude.includes('dist') && k.includes('/dist/')) return false;
                            if (exclude.includes('coverage') && k.includes('/coverage/')) return false;
                            if (exclude.includes('*.log') && k.endsWith('.log')) return false;
                        }
                        if (typeof include === 'string') {
                            if (include.includes('.agents') && !k.includes('.agents')) return false;
                            if (include.includes('SKILL.md') && !k.endsWith('SKILL.md')) return false;
                        }
                        return true;
                    });
                    const sliced = maxResults ? filtered.slice(0, maxResults) : filtered;
                    return sliced.map(p => ({ fsPath: p, path: p }));
                },
                fs: {
                    readFile: async (uri) => {
                        const content = global.__vscodeMockState.files.get(uri.fsPath);
                        if (content === undefined) {
                            throw new Error(`File not found: ${uri.fsPath}`);
                        }
                        return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
                    },
                    writeFile: async (uri, data) => {
                        global.__vscodeMockState.files.set(uri.fsPath, Buffer.from(data).toString('utf8'));
                    },
                    readDirectory: async (uri) => {
                        const entries = global.__vscodeMockState.directories.get(uri.fsPath);
                        if (!entries) {
                            // Check if any files exist under this prefix
                            const prefix = uri.fsPath.endsWith('/') ? uri.fsPath : uri.fsPath + '/';
                            const matched = [];
                            for (const [filePath] of global.__vscodeMockState.files.entries()) {
                                if (filePath.startsWith(prefix)) {
                                    const rel = filePath.substring(prefix.length);
                                    const topPart = rel.split('/')[0];
                                    const isDir = rel.includes('/');
                                    if (!matched.some(m => m[0] === topPart)) {
                                        matched.push([topPart, isDir ? 2 : 1]);
                                    }
                                }
                            }
                            if (matched.length > 0) return matched;
                            throw new Error(`Directory not found: ${uri.fsPath}`);
                        }
                        return entries.map(e => [e.name, e.isDirectory ? 2 : 1]);
                    }
                }
            },
            Uri: {
                file: (p) => ({ fsPath: p, path: p, scheme: 'file' }),
                joinPath: (base, ...segments) => {
                    const full = path.posix.normalize([base.fsPath, ...segments].join('/'));
                    return { fsPath: full, path: full, scheme: 'file' };
                },
                parse: (s) => ({ fsPath: s, path: s, scheme: 'file' })
            },
            FileType: {
                Unknown: 0,
                File: 1,
                Directory: 2,
                SymbolicLink: 64
            }
        };
    }
    return originalRequire.apply(this, arguments);
};
