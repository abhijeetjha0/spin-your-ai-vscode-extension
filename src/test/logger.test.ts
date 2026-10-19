import * as assert from 'assert';
import { Logger } from '../utils/logger';

declare const global: any;

describe('Logger', () => {
    beforeEach(() => {
        global.__vscodeMockState.outputLogs = [];
    });

    it('initializes and logs information, warnings, and errors', () => {
        Logger.initialize('TestChannel');

        Logger.log('System initialized');
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('[INFO') && l.includes('System initialized')));

        Logger.warn('Potential issue detected');
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('[WARN') && l.includes('Potential issue detected')));

        const testErr = new Error('Database failure');
        testErr.stack = 'Mock Error Stack Trace';
        Logger.error('Operation failed', testErr);
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('[ERROR') && l.includes('Operation failed - Database failure')));
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('Mock Error Stack Trace')));

        Logger.error('Operation failed without error object');
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('[ERROR') && l.includes('Operation failed without error object')));

        Logger.error('Operation failed with plain object error', { code: 404 });
        assert.ok(global.__vscodeMockState.outputLogs.some((l: string) => l.includes('[ERROR') && l.includes('{"code":404}')));
    });
});
