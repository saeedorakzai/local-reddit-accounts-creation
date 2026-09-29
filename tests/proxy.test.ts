import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseProxyFile,
  proxyFromEnv,
  toPlaywrightProxy,
  validateProxy,
  ProxyManager,
} from '../src/proxy/proxyManager.js';
import { Logger } from '../src/logging/logger.js';

describe('Proxy module', () => {
  it('parses 4-line HOST/PORT/USER/PASS file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-proxy-'));
    const file = path.join(dir, 'proxy.txt');
    fs.writeFileSync(file, '10.0.0.1\n8080\nuser1\nsecretpass\n', 'utf8');
    const proxy = parseProxyFile(file);
    assert.equal(proxy.host, '10.0.0.1');
    assert.equal(proxy.port, 8080);
    assert.equal(proxy.username, 'user1');
    assert.equal(proxy.password, 'secretpass');
  });

  it('parses key:value proxy file without requiring password line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-proxy-kv-'));
    const file = path.join(dir, 'proxy.txt');
    fs.writeFileSync(
      file,
      'http\nhost: 1.2.3.4\nport: 9000\nusername: alice\n',
      'utf8',
    );
    const proxy = parseProxyFile(file);
    assert.equal(proxy.host, '1.2.3.4');
    assert.equal(proxy.port, 9000);
    assert.equal(proxy.username, 'alice');
  });

  it('builds playwright proxy and never puts password in safeSummary', () => {
    const mgr = new ProxyManager();
    const proxy = { host: '1.1.1.1', port: 3128, username: 'u', password: 'p' };
    const pw = toPlaywrightProxy(proxy);
    assert.equal(pw.server, 'http://1.1.1.1:3128');
    assert.match(pw.bypass || '', /127\.0\.0\.1/);
    const summary = mgr.safeSummary(proxy);
    assert.equal(summary.host, '1.1.1.1');
    assert.equal(summary.hasAuth, true);
    assert.ok(!('password' in summary));
  });

  it('reads proxy from env', () => {
    const proxy = proxyFromEnv({
      PROXY_HOST: '9.9.9.9',
      PROXY_PORT: '8000',
      PROXY_USERNAME: 'x',
      PROXY_PASSWORD: 'y',
    } as NodeJS.ProcessEnv);
    assert.ok(proxy);
    assert.equal(proxy!.host, '9.9.9.9');
  });

  it('validateProxy fails fast on closed port', async () => {
    const result = await validateProxy(
      { host: '127.0.0.1', port: 1 },
      { timeoutMs: 500 },
    );
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
});
