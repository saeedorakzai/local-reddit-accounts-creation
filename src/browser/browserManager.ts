import type { BrowserContext, Page } from 'playwright';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../logging/logger.js';
import type { LaunchedProfile } from './firefoxProfileManager.js';
import {
  captureFailure,
  goto,
  safeClick,
  safeFill,
  safeSelect,
  switchToPage,
  waitForPopup,
  type ActionOptions,
} from '../automation/actions.js';
import { waitForElement, waitForNavigation, waitForPageLoad } from '../automation/waits.js';
import { takeFailureScreenshot } from '../automation/screenshots.js';

/**
 * High-level automation facade bound to a launched profile + config.
 */
export class BrowserManager {
  readonly profile: LaunchedProfile;
  readonly config: AppConfig;
  readonly logger: Logger;

  constructor(profile: LaunchedProfile, config: AppConfig, logger: Logger) {
    this.profile = profile;
    this.config = config;
    this.logger = logger;
  }

  get page(): Page {
    return this.profile.page;
  }

  get context(): BrowserContext {
    return this.profile.context;
  }

  private baseOptions(extra?: ActionOptions): ActionOptions {
    return {
      timeout: this.config.defaultTimeout,
      retries: this.config.maxRetries,
      retryDelayMs: this.config.actionRetryDelay,
      screenshotDir: this.config.screenshotDir,
      onRetry: (attempt, max, error) => {
        this.logger.warning(`Retry ${attempt}/${max}`, {
          profile: this.profile.name,
          action: 'retry',
          retry: `${attempt}/${max}`,
          error: error.message,
        });
      },
      ...extra,
    };
  }

  async goto(url: string, waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'): Promise<void> {
    await goto(this.page, url, {
      ...this.baseOptions({ timeout: this.config.navigationTimeout }),
      waitUntil,
    });
  }

  waitForElement(selector: string, timeout?: number) {
    return waitForElement(this.page, selector, {
      timeout: timeout ?? this.config.defaultTimeout,
    });
  }

  safeClick(selector: string, options?: ActionOptions) {
    return safeClick(this.page, selector, this.baseOptions(options));
  }

  safeFill(selector: string, value: string, options?: ActionOptions) {
    return safeFill(this.page, selector, value, this.baseOptions(options));
  }

  safeSelect(selector: string, value: string, options?: ActionOptions) {
    return safeSelect(this.page, selector, value, this.baseOptions(options));
  }

  waitForNavigation(action: () => Promise<unknown>) {
    return waitForNavigation(this.page, action, {
      timeout: this.config.navigationTimeout,
    });
  }

  waitForPageLoad(waitUntil?: 'load' | 'domcontentloaded' | 'networkidle') {
    return waitForPageLoad(this.page, {
      timeout: this.config.navigationTimeout,
      waitUntil,
    });
  }

  switchToPage(predicate: (page: Page) => boolean | Promise<boolean>) {
    return switchToPage(this.context, predicate, {
      timeout: this.config.defaultTimeout,
    });
  }

  waitForPopup(trigger: () => Promise<unknown>) {
    return waitForPopup(this.context, trigger, {
      timeout: this.config.defaultTimeout,
    });
  }

  takeFailureScreenshot(label: string) {
    return takeFailureScreenshot(this.page, this.config.screenshotDir, label);
  }

  captureFailure(step: string) {
    return captureFailure(this.page, this.config.screenshotDir, step);
  }

  setActivePage(page: Page): void {
    this.profile.page = page;
  }
}
