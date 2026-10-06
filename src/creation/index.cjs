#!/usr/bin/env node
/**
 * Local Firefox creation entry — Outlook login → Reddit register.
 *
 *   npm run create              full pipeline (default)
 *   npm run create:accounts     print registry, no browser
 *   npm run create:inspect      Outlook login diagnostics
 *   npm run create:inspect:reddit  Reddit register only (Outlook already logged in)
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = require('./projectRoot');

// Load .env (Windows Notepad often saves as ".env.txt")
try {
    const dotenv = require('dotenv');
    const envCandidates = ['.env', '.env.txt'];
    let loaded = false;
    for (const name of envCandidates) {
        const p = path.join(PROJECT_ROOT, name);
        if (fs.existsSync(p)) {
            dotenv.config({ path: p });
            if (name !== '.env') {
                console.warn(`⚠️ Loaded env from "${name}" — rename to ".env" when you can`);
            }
            loaded = true;
            break;
        }
    }
    if (!loaded) {
        console.warn('⚠️ No .env found — using defaults (Playwright Firefox unless USE_SYSTEM_FIREFOX=true)');
    }
} catch {
    // dotenv optional
}

const { Bot, reportFatal } = require('./core/Bot');

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
creation-flow — local Firefox Reddit account creation

  npm run create                 Outlook login → Reddit register (local Firefox)
  npm run create:one             Same, but only the first pending account
  npm run create:accounts        Print parsed email queue (no browser)
  npm run create:inspect         Live Outlook login diagnostics
  npm run create:inspect:safe    Stop before typing the password
  npm run create:inspect:reddit  Reddit register only (Outlook must already be logged in)

  Credentials:  email data.txt (or TEST_USERS_FILE / data/logins.csv)
  Profiles:     .firefox-profiles/
  Proxy:        proxy details + PROXY_* env
  Output:       data/reddit-accounts.csv
  Config:       config/creation-app.cjs

  Tip: set run.only / run.skip in config/creation-app.cjs to filter emails.
`);
        return 0;
    }

    if (args.includes('--bind')) {
        console.log(
            '⚠️  --bind (AdsPower draft) is not used with local Firefox.\n' +
            '   Each email gets its own profile under .firefox-profiles/ automatically.\n'
        );
        return 1;
    }

    const bot = new Bot();

    if (args.includes('--accounts')) {
        return bot.printAccounts();
    }

    if (args.includes('--inspect-reddit')) {
        const emailArg = args.find((a) => a.startsWith('--email='));
        return bot.inspectReddit({
            email: emailArg ? emailArg.slice('--email='.length) : null
        });
    }

    if (args.includes('--inspect')) {
        const emailArg = args.find((a) => a.startsWith('--email='));
        return bot.inspect({
            email: emailArg ? emailArg.slice('--email='.length) : null,
            safe: args.includes('--safe')
        });
    }

    // Ensure data dirs exist
    for (const dir of ['data', 'diagnostics', 'screenshots', 'reports', 'logs']) {
        fs.mkdirSync(path.join(PROJECT_ROOT, dir), { recursive: true });
    }

    // Limit to first account for a smoke run
    if (args.includes('--one')) {
        bot.initialize();
        const first = bot.registry.accounts[0];
        if (!first) {
            console.log('❌ No accounts ready to run.\n');
            return 1;
        }
        return bot.run({ only: [first.emailKey] });
    }

    return bot.run();
}

main()
    .then((code) => process.exit(code || 0))
    .catch((error) => {
        reportFatal(error);
        process.exit(1);
    });
