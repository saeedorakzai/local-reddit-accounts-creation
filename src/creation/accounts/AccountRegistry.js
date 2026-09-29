/**
 * The joined, validated account list: credentials from the CSV, profile IDs from
 * the bindings, filtered by run.only / run.skip.
 *
 * Nothing is dropped silently. Accounts with no profile and profiles with no
 * account are both surfaced — an account missing from the run report is a bug.
 *
 * This layer never opens a browser.
 */

const path = require('path');
const fs = require('fs');
const { loadAccounts } = require('./csvSource');
const { loadAccountsFromEmailData } = require('./emailDataSource');
const { resolveBindings } = require('./bindings');
const { MASK } = require('../shared/redact');
const PROJECT_ROOT = require('../projectRoot');

function toKeySet(values) {
    return new Set((values || []).map((v) => String(v).trim().toLowerCase()).filter(Boolean));
}

function loadCredentialRows(config) {
    const csvFile = config.accounts.csvFile;
    const source = config.accounts.source || 'emailData';
    const resolved = path.isAbsolute(csvFile)
        ? csvFile
        : path.join(PROJECT_ROOT, csvFile);

    if (source === 'csv' || csvFile.endsWith('.csv')) {
        return loadAccounts(csvFile, PROJECT_ROOT);
    }

    // email data.txt (or any non-csv) — fall back to CSV parser if file looks like G2G export
    if (fs.existsSync(resolved)) {
        const head = fs.readFileSync(resolved, 'utf8').slice(0, 400);
        if (/user id|email address|password/i.test(head) && head.includes(',')) {
            try {
                return loadAccounts(csvFile, PROJECT_ROOT);
            } catch {
                // fall through to line parser
            }
        }
        return loadAccountsFromEmailData(csvFile, PROJECT_ROOT);
    }

    return loadAccountsFromEmailData(csvFile, PROJECT_ROOT);
}

class AccountRegistry {
    constructor(data) {
        Object.assign(this, data);
    }

    static load(config) {
        const { accounts, skipped, duplicates, total } = loadCredentialRows(config);
        const binding = resolveBindings(accounts, config);

        const only = toKeySet(config.run.only);
        const skip = toKeySet(config.run.skip);

        let selected = binding.bound;
        let filteredOut = [];

        if (only.size) {
            filteredOut = selected.filter((a) => !only.has(a.emailKey));
            selected = selected.filter((a) => only.has(a.emailKey));
        } else if (skip.size) {
            filteredOut = selected.filter((a) => skip.has(a.emailKey));
            selected = selected.filter((a) => !skip.has(a.emailKey));
        }

        return new AccountRegistry({
            accounts: selected,
            filteredOut,
            unboundAccounts: binding.unboundAccounts,
            unboundProfiles: binding.unboundProfiles,
            duplicateProfiles: binding.duplicateProfiles,
            skippedRows: skipped,
            duplicateRows: duplicates,
            csvRowCount: total,
            parsedCount: accounts.length,
            strategy: config.binding.strategy
        });
    }

    get profileIds() {
        return this.accounts.map((a) => a.profileId);
    }

    /** `k1abc - 1/2` — position of a profile in the run. */
    label(profileId) {
        const index = this.profileIds.indexOf(profileId);
        const n = index >= 0 ? index + 1 : '?';
        return `${profileId} - ${n}/${this.accounts.length}`;
    }

    findByProfileId(profileId) {
        return this.accounts.find((a) => a.profileId === profileId) || null;
    }

    /**
     * True when something needs a human's attention before a run is trustworthy.
     * Unbound accounts are the dangerous case — they would be silently absent.
     */
    hasProblems() {
        // Duplicate email rows are ignored (first wins) — warn only, don't block.
        return (
            this.unboundAccounts.length > 0 ||
            this.duplicateProfiles.length > 0
        );
    }

    /** Human-readable lines. Never contains a password. */
    describe() {
        const lines = [];
        const pad = (s, n) => String(s).padEnd(n);

        lines.push('');
        lines.push('='.repeat(72));
        lines.push('ACCOUNTS');
        lines.push('='.repeat(72));
        lines.push(`CSV rows read:        ${this.csvRowCount}`);
        lines.push(`Valid accounts:       ${this.parsedCount}`);
        lines.push(`Binding strategy:     ${this.strategy}`);
        lines.push(`Ready to run:         ${this.accounts.length}`);

        if (this.accounts.length) {
            const profileWidth = Math.max(
                8,
                ...this.accounts.map((a) => a.profileId.length)
            ) + 2;
            const emailWidth = Math.max(
                6,
                ...this.accounts.map((a) => a.email.length)
            ) + 2;

            lines.push('');
            lines.push(
                `  ${pad('#', 4)}${pad('PROFILE', profileWidth)}` +
                `${pad('EMAIL', emailWidth)}PASSWORD`
            );
            lines.push('  ' + '-'.repeat(4 + profileWidth + emailWidth + MASK.length));
            this.accounts.forEach((a, i) => {
                lines.push(
                    `  ${pad(i + 1, 4)}${pad(a.profileId, profileWidth)}` +
                    `${pad(a.email, emailWidth)}${MASK}`
                );
            });
        }

        if (this.filteredOut.length) {
            lines.push('');
            lines.push(`EXCLUDED BY run.only / run.skip (${this.filteredOut.length})`);
            lines.push('-'.repeat(72));
            for (const a of this.filteredOut) {
                lines.push(`  ${a.email}`);
            }
        }

        if (this.unboundAccounts.length) {
            lines.push('');
            lines.push(`⚠️  ACCOUNTS WITH NO PROFILE (${this.unboundAccounts.length}) — these will not run`);
            lines.push('-'.repeat(72));
            for (const a of this.unboundAccounts) {
                lines.push(`  line ${a.lineNumber}  ${a.email}`);
            }
        }

        if (this.unboundProfiles.length) {
            lines.push('');
            lines.push(`ℹ️  PROFILES WITH NO ACCOUNT (${this.unboundProfiles.length})`);
            lines.push('-'.repeat(72));
            for (const p of this.unboundProfiles) {
                lines.push(`  ${p.profileId}${p.email ? `  (bound to ${p.email})` : ''}`);
            }
        }

        if (this.duplicateProfiles.length) {
            lines.push('');
            lines.push(`❌ PROFILE BOUND TO MORE THAN ONE ACCOUNT (${this.duplicateProfiles.length})`);
            lines.push('-'.repeat(72));
            for (const d of this.duplicateProfiles) {
                lines.push(`  ${d.profileId}  ${d.emails.join('  +  ')}`);
            }
        }

        if (this.duplicateRows.length) {
            lines.push('');
            lines.push(`⚠️  DUPLICATE EMAILS IN CSV (${this.duplicateRows.length}) — later rows ignored`);
            lines.push('-'.repeat(72));
            for (const d of this.duplicateRows) {
                lines.push(`  line ${d.lineNumber}  ${d.email}  (first seen line ${d.firstSeenAt})`);
            }
        }

        if (this.skippedRows.length) {
            lines.push('');
            lines.push(`⚠️  UNUSABLE ROWS (${this.skippedRows.length})`);
            lines.push('-'.repeat(72));
            for (const s of this.skippedRows) {
                lines.push(`  line ${s.lineNumber}  ${s.email || '(no email)'}  — ${s.reason}`);
            }
        }

        lines.push('');
        lines.push('='.repeat(72));
        return lines;
    }
}

module.exports = AccountRegistry;
