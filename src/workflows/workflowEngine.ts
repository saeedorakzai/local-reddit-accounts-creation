import type { Logger } from '../logging/logger.js';
import { sleep } from '../automation/waits.js';

export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface WorkflowStepContext {
  stepId: string;
  attempt: number;
  maxRetries: number;
}

export interface WorkflowStep<TCtx> {
  id: string;
  name: string;
  timeoutMs?: number;
  retries?: number;
  run: (ctx: TCtx, step: WorkflowStepContext) => Promise<void>;
}

export interface StepResult {
  id: string;
  name: string;
  status: StepStatus;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface WorkflowRunResult {
  success: boolean;
  steps: StepResult[];
  failedStep?: StepResult;
}

export class WorkflowEngine<TCtx extends { logger: Logger; profileName?: string; recordId?: string }> {
  constructor(
    private readonly steps: WorkflowStep<TCtx>[],
    private readonly defaults: { maxRetries: number; retryDelayMs: number },
  ) {}

  async run(
    ctx: TCtx,
    options?: {
      onStepStart?: (step: WorkflowStep<TCtx>) => void;
      onStepSuccess?: (result: StepResult) => void;
      onStepFailure?: (result: StepResult) => void;
    },
  ): Promise<WorkflowRunResult> {
    const results: StepResult[] = [];

    for (const step of this.steps) {
      const maxRetries = step.retries ?? this.defaults.maxRetries;
      const started = Date.now();
      options?.onStepStart?.(step);

      ctx.logger.info(step.name, {
        profile: ctx.profileName,
        recordId: ctx.recordId,
        step: step.id,
        action: step.name,
      });

      let lastError: Error | undefined;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        attempts = attempt;
        try {
          await this.runWithTimeout(
            () => step.run(ctx, { stepId: step.id, attempt, maxRetries }),
            step.timeoutMs,
          );
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            ctx.logger.warning(`Retry ${attempt}/${maxRetries}`, {
              profile: ctx.profileName,
              recordId: ctx.recordId,
              step: step.id,
              retry: `${attempt}/${maxRetries}`,
              error: lastError.message,
            });
            await sleep(this.defaults.retryDelayMs);
          }
        }
      }

      const durationMs = Date.now() - started;

      if (lastError) {
        const result: StepResult = {
          id: step.id,
          name: step.name,
          status: 'FAILED',
          attempts,
          durationMs,
          error: lastError.message,
        };
        results.push(result);
        ctx.logger.error(step.name, {
          profile: ctx.profileName,
          recordId: ctx.recordId,
          step: step.id,
          status: 'FAILED',
          durationMs,
          error: lastError.message,
        });
        options?.onStepFailure?.(result);
        return { success: false, steps: results, failedStep: result };
      }

      const result: StepResult = {
        id: step.id,
        name: step.name,
        status: 'SUCCESS',
        attempts,
        durationMs,
      };
      results.push(result);
      ctx.logger.success(step.name, {
        profile: ctx.profileName,
        recordId: ctx.recordId,
        step: step.id,
        status: 'SUCCESS',
        durationMs,
      });
      options?.onStepSuccess?.(result);
    }

    return { success: true, steps: results };
  }

  private async runWithTimeout(
    fn: () => Promise<void>,
    timeoutMs?: number,
  ): Promise<void> {
    if (!timeoutMs || timeoutMs <= 0) {
      await fn();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Step timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
