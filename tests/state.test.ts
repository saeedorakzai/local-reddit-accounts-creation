import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateManager } from '../src/state/stateManager.js';
import { WorkflowEngine } from '../src/workflows/workflowEngine.js';
import { Logger } from '../src/logging/logger.js';
import {
  parseUserLine,
  markUserProcessed,
  loadProcessedIds,
} from '../src/data/testUsers.js';

describe('State manager', () => {
  it('persists PENDING -> RUNNING -> SUCCESS and blocks double claim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-state-'));
    const statePath = path.join(root, 'state.json');
    const state = new StateManager(statePath);

    state.ensurePending('u1');
    assert.equal(state.get('u1')?.status, 'PENDING');

    const claimed = state.tryClaim('u1');
    assert.ok(claimed);
    assert.equal(claimed!.status, 'RUNNING');

    const second = state.tryClaim('u1');
    assert.equal(second, null);

    state.markSuccess('u1', { accountId: 'alice' });
    assert.equal(state.get('u1')?.status, 'SUCCESS');
    assert.equal(state.tryClaim('u1'), null);
  });

  it('marks FAILED with reason and allows reset', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-state-fail-'));
    const state = new StateManager(path.join(root, 'state.json'));
    state.tryClaim('u2');
    state.markFailed('u2', 'boom', { currentStep: 'STEP-05' });
    assert.equal(state.get('u2')?.status, 'FAILED');
    assert.equal(state.get('u2')?.error, 'boom');
    state.resetFailed('u2');
    assert.equal(state.get('u2')?.status, 'PENDING');
  });
});

describe('Retry / failure handling', () => {
  it('retries then fails with meaningful error', async () => {
    const logger = new Logger(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-log-')), 'retry');
    let attempts = 0;
    const engine = new WorkflowEngine(
      [
        {
          id: 'STEP-X',
          name: 'Flaky step',
          retries: 3,
          run: async () => {
            attempts += 1;
            throw new Error('intentional');
          },
        },
      ],
      { maxRetries: 3, retryDelayMs: 10 },
    );

    const result = await engine.run({ logger, recordId: 'r1', profileName: 'p1' });
    assert.equal(result.success, false);
    assert.equal(attempts, 3);
    assert.match(result.failedStep!.error || '', /intentional/);
    logger.close();
  });

  it('succeeds after transient failures', async () => {
    const logger = new Logger(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-log2-')), 'retry');
    let attempts = 0;
    const engine = new WorkflowEngine(
      [
        {
          id: 'STEP-Y',
          name: 'Eventually ok',
          retries: 3,
          run: async () => {
            attempts += 1;
            if (attempts < 2) throw new Error('transient');
          },
        },
      ],
      { maxRetries: 3, retryDelayMs: 5 },
    );
    const result = await engine.run({ logger });
    assert.equal(result.success, true);
    assert.equal(attempts, 2);
    logger.close();
  });
});

describe('Processed file handling', () => {
  it('parses legacy email,,password and marks processed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-users-'));
    const processed = path.join(root, 'processed-users.txt');
    const rec = parseUserLine('alice@example.com,,secret123', 0);
    assert.ok(rec);
    assert.equal(rec!.email, 'alice@example.com');
    markUserProcessed(processed, rec!);
    markUserProcessed(processed, rec!); // idempotent
    const ids = loadProcessedIds(processed);
    assert.ok(ids.has(rec!.id));
    assert.equal([...ids].length, 1);
  });
});
