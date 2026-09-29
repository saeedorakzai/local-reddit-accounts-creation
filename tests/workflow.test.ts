import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/config/config.js';
import { Logger } from '../src/logging/logger.js';
import { MailManager } from '../src/mail/mailManager.js';
import { runRegistrationWorkflow } from '../src/workflows/registrationWorkflow.js';
import type { TestUserRecord } from '../src/data/testUsers.js';
import { FirefoxProfileManager } from '../src/browser/firefoxProfileManager.js';

async function startMiniServer(
  mailboxDir: string,
  processedEmails: string,
): Promise<{ server: http.Server; port: number; baseUrl: string }> {
  const mail = new MailManager({
    mailboxDir,
    processedEmailsFile: processedEmails,
    pollIntervalMs: 100,
    pollTimeoutMs: 5000,
  });

  const pending = new Map<string, { code: string; verified: boolean }>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const html = (body: string) =>
      `<html><body>${body}</body></html>`;

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/register')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        html(`
          <form method="POST" action="/register">
            <input data-testid="email" name="email" />
            <input data-testid="password" name="password" type="password" />
            <input data-testid="username" name="username" />
            <button data-testid="submit" type="submit">Register</button>
          </form>`),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const email = body.get('email') || '';
      const code = '112233';
      pending.set(email.toLowerCase(), { code, verified: false });
      mail.depositMessage({
        to: email,
        from: 't@test',
        subject: 'verification',
        body: `code is ${code}`,
      });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        html(`
          <form method="POST" action="/verify">
            <input type="hidden" name="email" value="${email}" />
            <input data-testid="verification-code" name="code" />
            <button data-testid="verify-submit" type="submit">Verify</button>
          </form>`),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/verify') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const email = (body.get('email') || '').toLowerCase();
      const code = body.get('code') || '';
      const rec = pending.get(email);
      if (!rec || rec.code !== code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(html(`<p data-testid="error">bad</p>`));
        return;
      }
      rec.verified = true;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        html(`
          <form method="POST" action="/complete">
            <input type="hidden" name="email" value="${email}" />
            <select data-testid="preference" name="preference">
              <option value="email">Email</option>
            </select>
            <button data-testid="complete" type="submit">Complete</button>
          </form>`),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/complete') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = new URLSearchParams(Buffer.concat(chunks).toString());
      const email = body.get('email') || 'user';
      const accountId = email.split('@')[0];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        html(`
          <p data-testid="success">Registration complete</p>
          <span data-testid="account-id" data-account-id="${accountId}">${accountId}</span>`),
      );
      return;
    }

    res.writeHead(404);
    res.end('no');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  return { server, port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('Registration workflow (synthetic)', () => {
  it('runs end-to-end against local staging server', async () => {
    // Skip if Firefox cannot launch
    const can = await FirefoxProfileManager.canLaunchFirefox(true);
    if (!can) {
      console.log('SKIP: Firefox not available for Playwright');
      return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-wf-'));
    const dataDir = path.join(root, 'data');
    const mailbox = path.join(dataDir, 'mailbox');
    const processedEmails = path.join(dataDir, 'processed-emails.txt');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'processed-users.txt'), '');
    fs.writeFileSync(processedEmails, '');
    fs.writeFileSync(path.join(dataDir, 'state.json'), '{"version":1,"records":{}}');

    const { server, baseUrl } = await startMiniServer(mailbox, processedEmails);

    process.env.TEST_BASE_URL = baseUrl;
    process.env.HEADLESS = 'true';
    process.env.DATA_DIR = dataDir;
    process.env.LOG_DIR = path.join(root, 'logs');
    process.env.SCREENSHOT_DIR = path.join(root, 'screenshots');
    process.env.PROFILES_DIR = path.join(root, 'profiles');
    process.env.PROXY_ENABLED = 'false';
    process.env.EMAIL_POLL_INTERVAL = '200';
    process.env.EMAIL_POLL_TIMEOUT = '15000';
    process.env.MAX_RETRIES = '2';
    process.env.DEFAULT_TIMEOUT = '15000';
    process.env.NAVIGATION_TIMEOUT = '30000';

    const config = loadConfig({ requireTestUrl: true });
    const logger = new Logger(config.logDir, 'wf-test');

    const record: TestUserRecord = {
      id: 'wf-user-1',
      email: 'wf.user1@example.com',
      password: 'Pass12345',
      username: 'wf_user1',
      preference: 'email',
      raw: 'wf-user-1|wf.user1@example.com|Pass12345|wf_user1|email',
    };

    const result = await runRegistrationWorkflow(config, record, logger);
    logger.close();
    server.close();

    assert.equal(result.success, true, result.error);
    assert.ok(result.accountId);
  });
});
