import path from 'node:path';
import type { Page } from 'playwright';
import { ensureDir } from '../utils/platform.js';

export async function takeFailureScreenshot(
  page: Page,
  screenshotDir: string,
  label: string,
): Promise<string> {
  ensureDir(screenshotDir);
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(screenshotDir, `${stamp}_${safe}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch {
    // page may be closed; try viewport-only
    try {
      await page.screenshot({ path: filePath });
    } catch {
      return '';
    }
  }
  return filePath;
}
