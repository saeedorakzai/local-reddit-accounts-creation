import type { Locator, Page } from 'playwright';

export async function waitForElement(
  page: Page,
  selector: string,
  options?: { timeout?: number; state?: 'attached' | 'visible' | 'hidden' },
): Promise<Locator> {
  const locator = page.locator(selector).first();
  await locator.waitFor({
    state: options?.state ?? 'visible',
    timeout: options?.timeout ?? 30000,
  });
  return locator;
}

export async function waitForPageLoad(
  page: Page,
  options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
): Promise<void> {
  await page.waitForLoadState(options?.waitUntil ?? 'domcontentloaded', {
    timeout: options?.timeout ?? 60000,
  });
}

export async function waitForNavigation(
  page: Page,
  action: () => Promise<unknown>,
  options?: { timeout?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
): Promise<void> {
  await Promise.all([
    page.waitForNavigation({
      timeout: options?.timeout ?? 60000,
      waitUntil: options?.waitUntil ?? 'domcontentloaded',
    }),
    action(),
  ]);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}
