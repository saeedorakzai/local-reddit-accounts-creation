import type { AppConfig } from '../config/config.js';
import { pathsFromConfig } from '../config/config.js';
import { BrowserManager } from '../browser/browserManager.js';
import {
  FirefoxProfileManager,
  createProfileManager,
} from '../browser/firefoxProfileManager.js';
import { Selectors } from '../browser/selectors.js';
import { Logger } from '../logging/logger.js';
import { MailManager } from '../mail/mailManager.js';
import { ProxyManager, type ProxyConfig } from '../proxy/proxyManager.js';
import { StateManager } from '../state/stateManager.js';
import {
  loadProcessedIds,
  loadTestUsers,
  markUserProcessed,
  validateRecord,
  type TestUserRecord,
} from '../data/testUsers.js';
import { WorkflowEngine, type WorkflowStep } from './workflowEngine.js';
import { sleep } from '../automation/waits.js';

export interface RegistrationContext {
  logger: Logger;
  config: AppConfig;
  record: TestUserRecord;
  recordId: string;
  profileName?: string;
  profileManager: FirefoxProfileManager;
  browser?: BrowserManager;
  proxyManager: ProxyManager;
  proxy?: ProxyConfig | null;
  mail: MailManager;
  state: StateManager;
  verificationCode?: string;
  verificationEmailId?: string;
  accountId?: string;
  paths: ReturnType<typeof pathsFromConfig>;
}

function buildSteps(config: AppConfig): WorkflowStep<RegistrationContext>[] {
  return [
    {
      id: 'STEP-01',
      name: 'Validate test record',
      retries: 1,
      run: async (ctx) => {
        validateRecord(ctx.record);
        ctx.state.ensurePending(ctx.recordId);
      },
    },
    {
      id: 'STEP-02',
      name: 'Create isolated Firefox profile',
      run: async (ctx) => {
        const name = ctx.profileManager.nextSequentialName(ctx.config.profilePrefix);
        ctx.profileManager.createProfile(name);
        ctx.profileName = name;
        ctx.state.update(ctx.recordId, { profileName: name, currentStep: 'STEP-02' });
      },
    },
    {
      id: 'STEP-03',
      name: 'Configure and validate proxy',
      run: async (ctx) => {
        if (!ctx.config.proxyEnabled) {
          ctx.proxy = null;
          return;
        }
        const proxyFile = ctx.config.proxyFile || ctx.paths.proxyFile || undefined;
        const proxy = ctx.proxyManager.load({
          enabled: true,
          host: ctx.config.proxyHost,
          port: ctx.config.proxyPort,
          username: ctx.config.proxyUsername,
          password: ctx.config.proxyPassword,
          file: proxyFile,
        });
        if (!proxy) throw new Error('Proxy enabled but not configured');
        // Fill password from env when file omits it
        if (!proxy.password && ctx.config.proxyPassword) {
          proxy.password = ctx.config.proxyPassword;
        }
        if (!proxy.username && ctx.config.proxyUsername) {
          proxy.username = ctx.config.proxyUsername;
        }
        const summary = ctx.proxyManager.safeSummary(proxy);
        ctx.logger.info(`Using proxy ${summary.host}:${summary.port}`, {
          profile: ctx.profileName,
          recordId: ctx.recordId,
          step: 'STEP-03',
        });
        const result = await ctx.proxyManager.validate(proxy);
        if (!result.ok) {
          throw new Error(`Proxy validation failed: ${result.error}`);
        }
        ctx.proxy = proxy;
      },
    },
    {
      id: 'STEP-04',
      name: 'Launch Firefox',
      timeoutMs: config.navigationTimeout,
      run: async (ctx) => {
        if (!ctx.profileName) throw new Error('No profile name');
        const pwProxy = ctx.proxy
          ? ctx.proxyManager.toPlaywright(ctx.proxy)
          : undefined;
        if (pwProxy) {
          ctx.logger.info(
            `Proxy on; bypassing localhost for ${ctx.config.testBaseUrl}`,
            {
              profile: ctx.profileName,
              recordId: ctx.recordId,
              step: 'STEP-04',
            },
          );
        }
        const launched = await ctx.profileManager.launchProfile(ctx.profileName, {
          headless: ctx.config.headless,
          slowMo: ctx.config.slowMoMs,
          proxy: pwProxy,
        });
        ctx.browser = new BrowserManager(launched, ctx.config, ctx.logger);
      },
    },
    {
      id: 'STEP-05',
      name: 'Open test site',
      timeoutMs: config.navigationTimeout,
      run: async (ctx) => {
        if (!ctx.browser) throw new Error('Browser not launched');
        await ctx.browser.goto(ctx.config.testBaseUrl);
      },
    },
    {
      id: 'STEP-06',
      name: 'Perform registration',
      timeoutMs: config.navigationTimeout,
      run: async (ctx) => {
        if (!ctx.browser) throw new Error('Browser not launched');
        const page = ctx.browser.page;

        // Prefer dedicated register route if present
        const registerUrl = new URL('/register', ctx.config.testBaseUrl).toString();
        try {
          await ctx.browser.goto(registerUrl);
        } catch {
          const link = page.locator(Selectors.registerLink).first();
          if (await link.count()) {
            await ctx.browser.safeClick(Selectors.registerLink);
          }
        }

        await ctx.browser.safeFill(Selectors.emailInput, ctx.record.email);
        await ctx.browser.safeFill(Selectors.passwordInput, ctx.record.password);
        if (ctx.record.username) {
          const userField = page.locator(Selectors.usernameInput).first();
          if (await userField.count()) {
            await ctx.browser.safeFill(Selectors.usernameInput, ctx.record.username);
          }
        }
        await ctx.browser.safeClick(Selectors.submitButton);
        await ctx.browser.waitForPageLoad();
      },
    },
    {
      id: 'STEP-07',
      name: 'Retrieve verification code',
      timeoutMs: config.emailPollTimeout + 5000,
      retries: 1,
      run: async (ctx) => {
        const { code, emailId } = await ctx.mail.getVerificationCode(ctx.record.email);
        ctx.verificationCode = code;
        ctx.verificationEmailId = emailId;
      },
    },
    {
      id: 'STEP-08',
      name: 'Submit verification code',
      run: async (ctx) => {
        if (!ctx.browser || !ctx.verificationCode) {
          throw new Error('Missing browser or verification code');
        }
        await ctx.browser.safeFill(Selectors.verificationInput, ctx.verificationCode);
        await ctx.browser.safeClick(Selectors.verifyButton);
        await ctx.browser.waitForPageLoad();
      },
    },
    {
      id: 'STEP-09',
      name: 'Complete profile preferences',
      run: async (ctx) => {
        if (!ctx.browser) throw new Error('Browser not launched');
        const page = ctx.browser.page;
        const select = page.locator(Selectors.preferenceSelect).first();
        if (await select.count()) {
          await ctx.browser.safeSelect(
            Selectors.preferenceSelect,
            ctx.record.preference || 'email',
          );
        }
        const complete = page.locator(Selectors.completeButton).first();
        if (await complete.count()) {
          await ctx.browser.safeClick(Selectors.completeButton);
          await ctx.browser.waitForPageLoad();
        }
      },
    },
    {
      id: 'STEP-10',
      name: 'Verify successful completion',
      run: async (ctx) => {
        if (!ctx.browser) throw new Error('Browser not launched');
        await ctx.browser.waitForElement(Selectors.successBanner);
        const accountEl = ctx.browser.page.locator(Selectors.accountId).first();
        if (await accountEl.count()) {
          const text =
            (await accountEl.getAttribute('data-account-id')) ||
            (await accountEl.textContent()) ||
            '';
          ctx.accountId = text.trim() || undefined;
        }
        if (!ctx.accountId) {
          // Fallback: derive stable id from email local-part
          ctx.accountId = ctx.record.email.split('@')[0];
        }
      },
    },
    {
      id: 'STEP-11',
      name: 'Rename Firefox profile',
      run: async (ctx) => {
        if (!ctx.profileName || !ctx.accountId) {
          throw new Error('Missing profile or account id');
        }
        await ctx.profileManager.closeProfile(ctx.profileName);
        const safeName = ctx.accountId.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
        ctx.profileManager.renameProfile(ctx.profileName, safeName);
        ctx.profileName = safeName;
        ctx.browser = undefined;
      },
    },
    {
      id: 'STEP-12',
      name: 'Mark email and user processed',
      retries: 1,
      run: async (ctx) => {
        if (ctx.verificationEmailId) {
          ctx.mail.moveProcessedEmail(ctx.verificationEmailId);
        }
        markUserProcessed(ctx.paths.processedUsers, ctx.record);
      },
    },
  ];
}

export async function runRegistrationWorkflow(
  config: AppConfig,
  record: TestUserRecord,
  logger: Logger,
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  const paths = pathsFromConfig(config);
  const state = new StateManager(paths.state, logger);
  const claimed = state.tryClaim(record.id);
  if (!claimed) {
    logger.warning(`Skipping record ${record.id} (locked or already success)`, {
      recordId: record.id,
    });
    return { success: false, error: 'Record locked or already completed' };
  }

  const profileManager = createProfileManager(config, logger);
  const proxyManager = new ProxyManager(logger);
  const mail = new MailManager({
    mailboxDir: paths.mailbox,
    processedEmailsFile: paths.processedEmails,
    pollIntervalMs: config.emailPollInterval,
    pollTimeoutMs: config.emailPollTimeout,
    logger,
  });

  const ctx: RegistrationContext = {
    logger,
    config,
    record,
    recordId: record.id,
    profileManager,
    proxyManager,
    mail,
    state,
    paths,
  };

  const engine = new WorkflowEngine(buildSteps(config), {
    maxRetries: config.maxRetries,
    retryDelayMs: config.actionRetryDelay,
  });

  try {
    const result = await engine.run(ctx, {
      onStepStart: (step) => {
        state.update(record.id, { currentStep: step.id });
      },
    });

    if (!result.success) {
      let screenshot = '';
      let url = '';
      if (ctx.browser) {
        try {
          const fail = await ctx.browser.captureFailure(
            result.failedStep?.id || 'unknown',
          );
          screenshot = fail.screenshot;
          url = fail.url;
        } catch {
          // ignore
        }
      }
      state.markFailed(record.id, result.failedStep?.error || 'Unknown failure', {
        screenshot,
        url,
        currentStep: result.failedStep?.id,
        profileName: ctx.profileName,
      });
      return { success: false, error: result.failedStep?.error };
    }

    state.markSuccess(record.id, {
      accountId: ctx.accountId,
      profileName: ctx.profileName,
      currentStep: 'STEP-12',
    });
    logger.success(`Workflow SUCCESS for ${record.id}`, {
      recordId: record.id,
      profile: ctx.profileName,
      status: 'SUCCESS',
    });
    return { success: true, accountId: ctx.accountId };
  } finally {
    try {
      if (ctx.profileName) await profileManager.closeProfile(ctx.profileName);
    } catch {
      // ignore
    }
    await profileManager.closeAll();
  }
}

export async function runWorkflowBatch(
  config: AppConfig,
  logger: Logger,
  options?: { mode?: 'one' | 'all' | 'set'; ids?: string[] },
): Promise<{ total: number; success: number; failed: number }> {
  const paths = pathsFromConfig(config);
  const users = loadTestUsers(paths.testUsers);
  const processed = loadProcessedIds(paths.processedUsers);
  const state = new StateManager(paths.state, logger);

  let candidates = users.filter((u) => {
    if (processed.has(u.id)) return false;
    const st = state.get(u.id);
    if (st?.status === 'SUCCESS') return false;
    return true;
  });

  if (options?.mode === 'set' && options.ids?.length) {
    const idSet = new Set(options.ids.map((i) => i.toLowerCase()));
    candidates = candidates.filter(
      (u) => idSet.has(u.id.toLowerCase()) || idSet.has(u.email.toLowerCase()),
    );
  } else if (options?.mode === 'one') {
    candidates = candidates.slice(0, 1);
  }

  let success = 0;
  let failed = 0;

  for (const record of candidates) {
    logger.info(`Starting workflow for ${record.id}`, { recordId: record.id });
    const result = await runRegistrationWorkflow(config, record, logger);
    if (result.success) success += 1;
    else {
      failed += 1;
      if (!config.batchContinueOnFailure && options?.mode !== 'one') {
        break;
      }
    }
    await sleep(config.workflowDelayMs);
  }

  return { total: candidates.length, success, failed };
}
