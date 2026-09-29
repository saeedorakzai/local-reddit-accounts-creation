/**
 * The queue workflow: pair accounts with profiles by row order, then consume the
 * pairs that reached a final state so a re-run never repeats them.
 *
 *   data/logins.csv    row i  ─┐
 *                              ├─ paired → login → consume on finish
 *   data/profiles.csv  row i  ─┘
 *
 * "Consume" means: remove the account row from logins.csv AND the profile row from
 * profiles.csv, and append a record to data/processed.csv. Removing both by the
 * same index keeps the remaining rows aligned for the next run.
 *
 * A pair is consumed when its outcome is final — success OR a terminal failure.
 * Terminal failures are consumed on purpose: leaving a rejected password in the
 * queue would retry it every run, which is what locks Microsoft accounts. Nothing
 * is lost — processed.csv is the record. Transient outcomes (proxy blip, unknown
 * screen, AdsPower start failure) stay in the queue to retry.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const { loadProfiles } = require('./profileSource');
const { cleanEmail } = require('./csvSource');
const { SUCCESS, TERMINAL_FAILURES } = require('../shared/outcomes');

const REPO_ROOT = require('../projectRoot');

function resolve(relativePath) {
    return path.isAbsolute(relativePath) ? relativePath : path.join(REPO_ROOT, relativePath);
}

/** An outcome that will not change on a retry — safe (and required) to consume. */
function isFinalOutcome(outcome) {
    return SUCCESS.has(outcome) || TERMINAL_FAILURES.has(outcome);
}

function csvEscape(value) {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeCsv(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => csvEscape(row[h])).join(','));
    }
    return lines.join('\n') + '\n';
}

/**
 * Pair accounts (already parsed elsewhere) with the profile queue, by index.
 * @returns {{ bound, unboundAccounts, unboundProfiles, duplicateProfiles }}
 */
function pairWithProfiles(accounts, config) {
    const { profiles } = loadProfiles(config.binding.profilesFile);
    const count = Math.min(accounts.length, profiles.length);

    const bound = [];
    for (let i = 0; i < count; i++) {
        bound.push({ ...accounts[i], profileId: profiles[i].profileId });
    }

    return {
        bound,
        unboundAccounts: accounts.slice(count),
        unboundProfiles: profiles.slice(count).map((p) => ({ profileId: p.profileId, email: null })),
        duplicateProfiles: []
    };
}

/**
 * Rewrite logins.csv and profiles.csv with the consumed rows removed, and append
 * the consumed pairs to processed.csv.
 *
 * @param {object} config
 * @param {Array<{account, outcome, detail}>} ledger
 * @returns {{ consumed: object[], keptAccounts: number, keptProfiles: number }}
 */
function consumeFinished(config, ledger, now = new Date()) {
    const consumed = ledger.filter((entry) => isFinalOutcome(entry.outcome));
    if (!consumed.length) {
        return { consumed: [], keptAccounts: null, keptProfiles: null };
    }

    const consumedEmails = new Set(consumed.map((e) => e.account.emailKey));
    const consumedProfiles = new Set(consumed.map((e) => e.account.profileId));

    const keptAccounts = rewriteAccounts(config.accounts.csvFile, consumedEmails);
    const keptProfiles = rewriteProfiles(config.binding.profilesFile, consumedProfiles);
    appendProcessed(consumed, now);

    return { consumed, keptAccounts, keptProfiles };
}

/** Keep header + account rows whose email was not consumed; drop blank filler. */
function rewriteAccounts(csvFile, consumedEmails) {
    const filePath = resolve(csvFile);
    const raw = fs.readFileSync(filePath, 'utf8');
    const records = parse(raw, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true
    });

    if (!records.length) return 0;

    const headers = Object.keys(records[0]);
    const emailHeader = headers.find((h) => /email|user id/i.test(h)) || headers[1];

    const kept = records.filter((row) => {
        const email = cleanEmail(row[emailHeader]);
        if (!email) return false;                     // drop template blank rows
        return !consumedEmails.has(email.toLowerCase());
    });

    fs.writeFileSync(filePath, serializeCsv(headers, kept), 'utf8');
    return kept.length;
}

/** Keep the profiles whose id was not consumed, preserving the file's format. */
function rewriteProfiles(profilesFile, consumedProfiles) {
    const filePath = resolve(profilesFile);
    const { loadProfiles } = require('./profileSource');
    const { profiles } = loadProfiles(profilesFile);

    const kept = profiles
        .filter((p) => !consumedProfiles.has(p.profileId))
        .map((p) => p.profileId);

    if (/\.json$/i.test(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(kept, null, 4) + '\n', 'utf8');
    } else {
        fs.writeFileSync(filePath, `profileId\n${kept.join('\n')}${kept.length ? '\n' : ''}`, 'utf8');
    }
    return kept.length;
}

/**
 * Append the durable credential record for every consumed pair: which account —
 * with its password — landed on which AdsPower instance, and how it ended.
 *
 * This file INTENTIONALLY holds plaintext passwords, because it is the user's
 * inventory of "instance → account". It is gitignored (data/*.csv) and carries a
 * warning header. Nothing else in the project writes a password to disk.
 */
function appendProcessed(consumed, now) {
    const filePath = resolve('data/processed.csv');
    const exists = fs.existsSync(filePath);
    const stamp = now.toISOString();

    const rows = consumed.map((e) =>
        [stamp, e.account.profileId, e.account.email, e.account.password, e.outcome, e.detail || '']
            .map(csvEscape)
            .join(',')
    );

    const body = rows.join('\n') + '\n';
    if (exists) {
        fs.appendFileSync(filePath, body, 'utf8');
    } else {
        const header =
            '# CONTAINS PLAINTEXT PASSWORDS — do not commit or share. Gitignored.\n' +
            'processedAt,profileId,email,password,outcome,detail\n';
        fs.writeFileSync(filePath, header + body, 'utf8');
    }
}

module.exports = {
    pairWithProfiles,
    consumeFinished,
    isFinalOutcome
};
