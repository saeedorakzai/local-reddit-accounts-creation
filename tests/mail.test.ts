import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractVerificationCode } from '../src/mail/verificationCode.js';
import { MailManager } from '../src/mail/mailManager.js';
import { readLines } from '../src/utils/files.js';

describe('Verification code extraction', () => {
  it('extracts code from common phrases', () => {
    assert.equal(extractVerificationCode('Your verification code is: 482916'), '482916');
    assert.equal(extractVerificationCode('OTP: 1234'), '1234');
    assert.equal(extractVerificationCode('no code here'), null);
  });
});

describe('Mail manager', () => {
  it('finds latest mail, extracts code, marks processed, avoids duplicates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mail-'));
    const mailbox = path.join(root, 'mailbox');
    const processed = path.join(root, 'processed-emails.txt');
    const mail = new MailManager({
      mailboxDir: mailbox,
      processedEmailsFile: processed,
      pollIntervalMs: 50,
      pollTimeoutMs: 2000,
    });

    mail.depositMessage({
      to: 'alice@example.com',
      from: 'noreply@test.local',
      subject: 'Your verification code',
      body: 'Code is 654321',
      id: 'msg-1',
    });

    const found = mail.findLatestVerificationEmail('alice@example.com');
    assert.ok(found);
    assert.equal(found!.id, 'msg-1');

    const { code, emailId } = await mail.getVerificationCode('alice@example.com');
    assert.equal(code, '654321');
    assert.equal(emailId, 'msg-1');

    mail.moveProcessedEmail(emailId);
    assert.ok(readLines(processed).includes('msg-1'));
    assert.equal(mail.findLatestVerificationEmail('alice@example.com'), null);
  });

  it('times out when no email arrives', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mail-empty-'));
    const mail = new MailManager({
      mailboxDir: path.join(root, 'mailbox'),
      processedEmailsFile: path.join(root, 'processed-emails.txt'),
      pollIntervalMs: 50,
      pollTimeoutMs: 200,
    });
    await assert.rejects(() => mail.getVerificationCode('missing@example.com'));
  });
});
