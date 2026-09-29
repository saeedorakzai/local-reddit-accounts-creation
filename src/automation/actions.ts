import type { BrowserContext, Page } from 'playwright';
import { takeFailureScreenshot } from './screenshots.js';
import { sleep, waitForElement, waitForPageLoad } from './waits.js';

export interface ActionOptions {
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
  screenshotDir?: string;
  step?: string;
  onRetry?: (attempt: number, max: number, error: Error) => void;
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: ActionOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const delay = options.retryDelayMs ?? 1000;
  let lastError: Error = new Error('unknown');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        options.onRetry?.(attempt, retries, lastError);
        await sleep(delay);
      }
    }
  }

  throw new Error(`${label} failed after ${retries} attempts: ${lastError.message}`);
}

export async function safeClick(
  page: Page,
  selector: string,
  options: ActionOptions = {},
): Promise<void> {
  await withRetry(
    `click(${selector})`,
    async () => {
      const el = await waitForElement(page, selector, { timeout: options.timeout });
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: options.timeout });
    },
    options,
  );
}

export async function safeFill(
  page: Page,
  selector: string,
  value: string,
  options: ActionOptions = {},
): Promise<void> {
  await withRetry(
    `fill(${selector})`,
    async () => {
      const el = await waitForElement(page, selector, { timeout: options.timeout });
      await el.scrollIntoViewIfNeeded();
      await el.fill('');
      await el.fill(value, { timeout: options.timeout });
    },
    options,
  );
}

export async function safeSelect(
  page: Page,
  selector: string,
  value: string,
  options: ActionOptions = {},
): Promise<void> {
  await withRetry(
    `select(${selector})`,
    async () => {
      const el = await waitForElement(page, selector, { timeout: options.timeout });
      await el.selectOption({ value }).catch(async () => {
        await el.selectOption({ label: value });
      });
    },
    options,
  );
}

export async function goto(
  page: Page,
  url: string,
  options: ActionOptions & { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' } = {},
): Promise<void> {
  await withRetry(
    `goto(${url})`,
    async () => {
      await page.goto(url, {
        timeout: options.timeout ?? 60000,
        waitUntil: options.waitUntil ?? 'domcontentloaded',
      });
      await waitForPageLoad(page, { timeout: options.timeout });
    },
    options,
  );
}

export async function switchToPage(
  context: BrowserContext,
  predicate: (page: Page) => boolean | Promise<boolean>,
  options?: { timeout?: number },
): Promise<Page> {
  const timeout = options?.timeout ?? 30000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    for (const p of context.pages()) {
      if (await predicate(p)) {
        await p.bringToFront();
        return p;
      }
    }
    await sleep(200);
  }

  throw new Error(`switchToPage timed out after ${timeout}ms`);
}

export async function waitForPopup(
  context: BrowserContext,
  trigger: () => Promise<unknown>,
  options?: { timeout?: number },
): Promise<Page> {
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: options?.timeout ?? 30000 }),
    trigger(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

export async function captureFailure(
  page: Page,
  screenshotDir: string,
  step: string,
): Promise<{ screenshot: string; url: string }> {
  const url = page.url();
  const screenshot = await takeFailureScreenshot(page, screenshotDir, step);
  return { screenshot, url };
}
