import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeClick, safeFill, goto } from '../src/automation/actions.js';
import { sleep, waitForElement } from '../src/automation/waits.js';

describe('Browser automation helpers (unit)', () => {
  it('exports core helpers', () => {
    assert.equal(typeof waitForElement, 'function');
    assert.equal(typeof safeClick, 'function');
    assert.equal(typeof safeFill, 'function');
    assert.equal(typeof goto, 'function');
    assert.equal(typeof sleep, 'function');
  });

  it('sleep resolves', async () => {
    const start = Date.now();
    await sleep(30);
    assert.ok(Date.now() - start >= 25);
  });
});
