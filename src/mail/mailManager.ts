import fs from 'node:fs';
import path from 'node:path';
import { appendTextFile, readJsonFile, readLines, writeJsonFile } from '../utils/files.js';
import { ensureDir, resolveProjectPath } from '../utils/platform.js';
import { extractVerificationCode } from './verificationCode.js';
import type { Logger } from '../logging/logger.js';
import { sleep } from '../automation/waits.js';

export interface MailMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
  processed?: boolean;
}

export interface MailManagerOptions {
  mailboxDir: string;
  processedEmailsFile: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  logger?: Logger;
}

/**
 * File-based controlled test mailbox.
 * Drop JSON messages into mailboxDir; the workflow polls for matching mail.
 */
export class MailManager {
  private readonly mailboxDir: string;
  private readonly processedFile: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly logger?: Logger;

  constructor(options: MailManagerOptions) {
    this.mailboxDir = resolveProjectPath(options.mailboxDir);
    this.processedFile = resolveProjectPath(options.processedEmailsFile);
    this.pollIntervalMs = options.pollIntervalMs;
    this.pollTimeoutMs = options.pollTimeoutMs;
    this.logger = options.logger;
    ensureDir(this.mailboxDir);
  }

  private processedIds(): Set<string> {
    return new Set(readLines(this.processedFile));
  }

  markEmailProcessed(emailId: string): void {
    const set = this.processedIds();
    if (set.has(emailId)) return;
    appendTextFile(this.processedFile, emailId);
    this.logger?.info(`Marked email processed ${emailId}`, {
      action: 'markEmailProcessed',
    });
  }

  moveProcessedEmail(emailId: string): void {
    const src = path.join(this.mailboxDir, `${emailId}.json`);
    const destDir = path.join(this.mailboxDir, 'processed');
    ensureDir(destDir);
    const dest = path.join(destDir, `${emailId}.json`);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest);
    }
    this.markEmailProcessed(emailId);
  }

  listMessages(): MailMessage[] {
    if (!fs.existsSync(this.mailboxDir)) return [];
    const files = fs
      .readdirSync(this.mailboxDir)
      .filter((f) => f.endsWith('.json'));
    const messages: MailMessage[] = [];
    for (const file of files) {
      const full = path.join(this.mailboxDir, file);
      try {
        const msg = readJsonFile<MailMessage | null>(full, null);
        if (msg?.id) messages.push(msg);
      } catch {
        // skip bad files
      }
    }
    return messages.sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  }

  findLatestVerificationEmail(
    recipient: string,
    options?: { subjectIncludes?: string },
  ): MailMessage | null {
    const processed = this.processedIds();
    const subjectNeedle = (options?.subjectIncludes || 'verification').toLowerCase();

    for (const msg of this.listMessages()) {
      if (processed.has(msg.id) || msg.processed) continue;
      if (msg.to.toLowerCase() !== recipient.toLowerCase()) continue;
      const hay = `${msg.subject}\n${msg.body}`.toLowerCase();
      if (!hay.includes(subjectNeedle) && !/\b\d{4,8}\b/.test(hay)) continue;
      return msg;
    }
    return null;
  }

  async getVerificationCode(
    recipient: string,
    options?: { subjectIncludes?: string },
  ): Promise<{ code: string; emailId: string }> {
    const start = Date.now();
    this.logger?.info(`Polling mailbox for ${recipient}`, {
      action: 'getVerificationCode',
    });

    while (Date.now() - start < this.pollTimeoutMs) {
      const msg = this.findLatestVerificationEmail(recipient, options);
      if (msg) {
        const code = extractVerificationCode(`${msg.subject}\n${msg.body}`);
        if (code) {
          this.logger?.success(`Found verification code for ${recipient}`, {
            action: 'getVerificationCode',
            durationMs: Date.now() - start,
          });
          return { code, emailId: msg.id };
        }
      }
      await sleep(this.pollIntervalMs);
    }

    throw new Error(
      `No verification email for ${recipient} within ${this.pollTimeoutMs}ms`,
    );
  }

  /** Inject a synthetic message (used by test server / unit tests). */
  depositMessage(msg: Omit<MailMessage, 'id' | 'receivedAt'> & { id?: string }): MailMessage {
    ensureDir(this.mailboxDir);
    const id = msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const full: MailMessage = {
      id,
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      body: msg.body,
      receivedAt: new Date().toISOString(),
      processed: false,
    };
    writeJsonFile(path.join(this.mailboxDir, `${id}.json`), full);
    return full;
  }
}
