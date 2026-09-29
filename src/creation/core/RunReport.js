/**
 * Run output — reports/YYYY-MM-DD-report.txt (appended, one section per run) and
 * reports/YYYY-MM-DD-results.json (keyed by email, so a follow-up run can be
 * filtered to failures).
 *
 * Reports identify accounts by email and profile ID. Never a password.
 */

const fs = require('fs');
const path = require('path');

const { REPORT_ORDER, label, isSuccess, OUTCOMES } = require('../shared/outcomes');

const REPO_ROOT = require('../projectRoot');

function dateStamp(date) {
    return date.toISOString().slice(0, 10);
}

function dateTime(date) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

function duration(ms) {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    return `${min}m ${sec}s`;
}

/** Group ledger entries by outcome, in report order. */
function groupByOutcome(ledger) {
    const groups = new Map();
    for (const outcome of REPORT_ORDER) groups.set(outcome, []);

    for (const entry of ledger) {
        if (!groups.has(entry.outcome)) groups.set(entry.outcome, []);
        groups.get(entry.outcome).push(entry);
    }

    return [...groups.entries()].filter(([, entries]) => entries.length);
}

function buildSection({ ledger, unaccountedFor, durationMs, endedAt }) {
    const total = ledger.length + unaccountedFor.length;
    const ok = ledger.filter((e) => isSuccess(e.outcome)).length;

    const lines = [
        '',
        '='.repeat(72),
        `RUN — ${dateTime(endedAt)}`,
        '='.repeat(72),
        `Duration:  ${duration(durationMs)}`,
        `Accounts:  ${total}`,
        `Succeeded: ${ok}/${total}`,
        ''
    ];

    for (const [outcome, entries] of groupByOutcome(ledger)) {
        lines.push(`${label(outcome).toUpperCase()} (${entries.length})`);
        lines.push('-'.repeat(72));
        for (const entry of entries) {
            const detail = entry.detail ? `  — ${entry.detail}` : '';
            // Instance → email → password, as requested. This is why the report
            // file carries the plaintext-password warning in its header.
            const pw = entry.account.password || '';
            lines.push(`  ${entry.account.profileId}  ${entry.account.email}  ${pw}${detail}`);
        }
        lines.push('');
    }

    // Should always be empty. If it is not, the ledger has a hole and the run
    // report cannot be trusted — say so loudly rather than quietly omitting them.
    if (unaccountedFor.length) {
        lines.push(`❌ NOT ACCOUNTED FOR (${unaccountedFor.length}) — this is a bug`);
        lines.push('-'.repeat(72));
        for (const account of unaccountedFor) {
            lines.push(`  ${account.profileId}  ${account.email}`);
        }
        lines.push('');
    }

    lines.push('='.repeat(72), '');
    return lines.join('\n');
}

function writeRunReport({ ledger, unaccountedFor = [], durationMs, endedAt = new Date() }) {
    const dir = path.join(REPO_ROOT, 'reports');
    fs.mkdirSync(dir, { recursive: true });

    const stamp = dateStamp(endedAt);
    const txtPath = path.join(dir, `${stamp}-report.txt`);
    const jsonPath = path.join(dir, `${stamp}-results.json`);

    const section = buildSection({ ledger, unaccountedFor, durationMs, endedAt });

    if (fs.existsSync(txtPath)) {
        fs.appendFileSync(txtPath, section, 'utf8');
    } else {
        const header = [
            'OUTLOOK LOGIN REPORT',
            `Date: ${stamp}`,
            'One section per run — appended after each run',
            '# CONTAINS PLAINTEXT PASSWORDS — gitignored. Do not commit or share.',
            'Columns per line:  <profileId>  <email>  <password>  [— detail]',
            ''
        ].join('\n');
        fs.writeFileSync(txtPath, header + section, 'utf8');
    }

    const results = {
        ranAt: endedAt.toISOString(),
        durationMs,
        accounts: Object.fromEntries(
            ledger.map((e) => [
                e.account.email,
                {
                    profileId: e.account.profileId,
                    password: e.account.password || null,
                    outcome: e.outcome,
                    detail: e.detail || null,
                    success: isSuccess(e.outcome)
                }
            ])
        ),
        unaccountedFor: unaccountedFor.map((a) => a.email)
    };

    let history = [];
    if (fs.existsSync(jsonPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            history = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            history = [];
        }
    }
    history.push(results);
    fs.writeFileSync(jsonPath, JSON.stringify(history, null, 2) + '\n', 'utf8');

    return { txtPath, jsonPath };
}

/** The same grouping, for stdout. */
function summaryLines(ledger, unaccountedFor = []) {
    const total = ledger.length + unaccountedFor.length;
    const ok = ledger.filter((e) => isSuccess(e.outcome)).length;

    const lines = ['', '='.repeat(72), `SUMMARY — ${ok}/${total} succeeded`, '='.repeat(72)];

    for (const [outcome, entries] of groupByOutcome(ledger)) {
        const icon = isSuccess(outcome) ? '✅' : outcome === OUTCOMES.UNKNOWN ? '❓' : '⚠️';
        lines.push('', `${icon} ${label(outcome)} (${entries.length})`);
        for (const entry of entries) {
            const detail = entry.detail ? `  — ${entry.detail}` : '';
            lines.push(`   ${entry.account.email}${detail}`);
        }
    }

    if (unaccountedFor.length) {
        lines.push('', `❌ Not accounted for (${unaccountedFor.length}) — this is a bug`);
        for (const account of unaccountedFor) {
            lines.push(`   ${account.email}`);
        }
    }

    lines.push('', '='.repeat(72));
    return lines;
}

module.exports = { writeRunReport, buildSection, summaryLines, groupByOutcome };
