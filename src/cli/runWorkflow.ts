#!/usr/bin/env node
import { loadConfig } from '../config/config.js';
import { Logger, setLogger } from '../logging/logger.js';
import { runWorkflowBatch } from '../workflows/registrationWorkflow.js';

function parseArgs(argv: string[]) {
  const out: { mode: 'one' | 'all' | 'set'; ids: string[] } = {
    mode: 'one',
    ids: [],
  };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const m = arg.slice('--mode='.length);
      if (m === 'one' || m === 'all' || m === 'set') out.mode = m;
    } else if (arg.startsWith('--ids=')) {
      out.ids = arg
        .slice('--ids='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      out.mode = 'set';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ requireTestUrl: true });
  const logger = new Logger(config.logDir, 'workflow');
  setLogger(logger);

  logger.info(`Starting workflow mode=${args.mode}`);
  const summary = await runWorkflowBatch(config, logger, {
    mode: args.mode,
    ids: args.ids,
  });

  logger.info(
    `Done total=${summary.total} success=${summary.success} failed=${summary.failed}`,
  );
  logger.close();
  process.exit(summary.failed > 0 && summary.success === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
