import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import { MailManager } from '../mail/mailManager.js';
import { ensureDir, getProjectRoot, resolveProjectPath } from '../utils/platform.js';

const PORT = Number(process.env.TEST_SERVER_PORT || 3456);
const MAILBOX = resolveProjectPath(process.env.MAILBOX_DIR || path.join('data', 'mailbox'));
const PROCESSED = resolveProjectPath(
  process.env.PROCESSED_EMAILS || path.join('data', 'processed-emails.txt'),
);

ensureDir(MAILBOX);

const mail = new MailManager({
  mailboxDir: MAILBOX,
  processedEmailsFile: PROCESSED,
  pollIntervalMs: 1000,
  pollTimeoutMs: 5000,
});

/** In-memory registrations for the local staging site. */
const pending = new Map<
  string,
  { email: string; password: string; username?: string; code: string; verified: boolean }
>();

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
    label { display:block; margin-top: 0.75rem; }
    input, select, button { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }
    .success { color: #0a7; margin-top: 1rem; }
    .error { color: #c00; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

function parseBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/register')) {
    return send(
      res,
      200,
      layout(
        'Test Registration',
        `<p>Controlled staging target for creation-flow automation.</p>
         <a data-testid="register-link" href="/register">Register</a>
         <form method="POST" action="/register" style="margin-top:1rem">
           <label>Email <input data-testid="email" id="email" name="email" type="email" required/></label>
           <label>Password <input data-testid="password" id="password" name="password" type="password" required/></label>
           <label>Username <input data-testid="username" id="username" name="username"/></label>
           <button data-testid="submit" type="submit">Register</button>
         </form>`,
      ),
    );
  }

  if (req.method === 'POST' && url.pathname === '/register') {
    const body = await parseBody(req);
    const email = body.get('email') || '';
    const password = body.get('password') || '';
    const username = body.get('username') || undefined;
    if (!email || !password) {
      return send(res, 400, layout('Error', `<p class="error" data-testid="error">Missing fields</p>`));
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pending.set(email.toLowerCase(), { email, password, username, code, verified: false });

    mail.depositMessage({
      to: email,
      from: 'noreply@test.local',
      subject: 'Your verification code',
      body: `Welcome!\nYour verification code is: ${code}\n`,
    });

    return send(
      res,
      200,
      layout(
        'Verify Email',
        `<p>We sent a code to ${email}</p>
         <form method="POST" action="/verify">
           <input type="hidden" name="email" value="${email}"/>
           <label>Code <input data-testid="verification-code" id="code" name="code" required/></label>
           <button data-testid="verify-submit" type="submit">Verify</button>
         </form>`,
      ),
    );
  }

  if (req.method === 'POST' && url.pathname === '/verify') {
    const body = await parseBody(req);
    const email = (body.get('email') || '').toLowerCase();
    const code = body.get('code') || '';
    const rec = pending.get(email);
    if (!rec || rec.code !== code) {
      return send(
        res,
        400,
        layout(
          'Verify Email',
          `<p class="error" data-testid="error">Invalid code</p>
           <form method="POST" action="/verify">
             <input type="hidden" name="email" value="${email}"/>
             <label>Code <input data-testid="verification-code" id="code" name="code" required/></label>
             <button data-testid="verify-submit" type="submit">Verify</button>
           </form>`,
        ),
      );
    }
    rec.verified = true;
    return send(
      res,
      200,
      layout(
        'Preferences',
        `<form method="POST" action="/complete">
           <input type="hidden" name="email" value="${email}"/>
           <label>Preference
             <select data-testid="preference" id="preference" name="preference">
               <option value="email">Email</option>
               <option value="sms">SMS</option>
               <option value="none">None</option>
             </select>
           </label>
           <button data-testid="complete" type="submit">Complete</button>
         </form>`,
      ),
    );
  }

  if (req.method === 'POST' && url.pathname === '/complete') {
    const body = await parseBody(req);
    const email = (body.get('email') || '').toLowerCase();
    const rec = pending.get(email);
    if (!rec?.verified) {
      return send(res, 400, layout('Error', `<p class="error" data-testid="error">Not verified</p>`));
    }
    const accountId = (rec.username || email.split('@')[0]).replace(/[^a-zA-Z0-9._-]/g, '_');
    return send(
      res,
      200,
      layout(
        'Done',
        `<p class="success" data-testid="success">Registration complete</p>
         <p>Account: <span data-testid="account-id" id="account-id" data-account-id="${accountId}">${accountId}</span></p>`,
      ),
    );
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, root: getProjectRoot() }));
    return;
  }

  send(res, 404, layout('Not Found', `<p data-testid="error">404</p>`));
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Test staging server at http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Mailbox dir: ${MAILBOX}`);
});
