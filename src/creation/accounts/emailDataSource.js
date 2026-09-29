/**
 * Parse root "email data.txt" (and similar) into account rows.
 *
 * Formats:
 *   uuid<TAB>'Email@outlook.com<TAB><TAB>password
 *   uuid,''Email@outlook.com,,password,,,,,,,,,,,,
 *   email,,password
 *   email:password
 *   email,password
 *   id|email|password
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = require('../projectRoot');
const { registerSecret } = require('../shared/redact');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanEmail(value) {
    return String(value ?? '')
        .trim()
        .replace(/^['"`]+/, '')
        .replace(/['"`]+$/, '')
        .trim();
}

/**
 * Tab-separated G2G-style export:
 *   uuid \t 'Email@outlook.com \t \t password
 */
function parseTabLine(trimmed) {
    if (!trimmed.includes('\t')) return null;

    const cols = trimmed.split('\t').map((c) => c.trim());
    const emailIdx = cols.findIndex((c) => isValidEmail(cleanEmail(c)));
    if (emailIdx < 0) return null;

    const email = cleanEmail(cols[emailIdx]);
    const after = cols.slice(emailIdx + 1).filter((c) => c && c !== "''" && c !== '""');
    const password = (after[0] || '').trim();
    let idHint = '';
    if (emailIdx > 0 && /^[0-9a-f-]{36}$/i.test(cols[0])) {
        idHint = cols[0];
    }

    return { email, password, idHint };
}

/**
 * @returns {{ accounts: object[], skipped: object[], duplicates: object[], total: number }}
 */
function loadAccountsFromEmailData(filePath, projectRoot = PROJECT_ROOT) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);

    if (!fs.existsSync(resolved)) {
        throw new Error(`Credentials file not found: ${filePath}`);
    }

    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    const accounts = [];
    const skipped = [];
    const duplicates = [];
    const seen = new Map();

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        let email = '';
        let password = '';
        let idHint = '';

        const tabbed = parseTabLine(trimmed);
        if (tabbed) {
            email = tabbed.email;
            password = tabbed.password;
            idHint = tabbed.idHint;
        } else {
            // uuid,''Email@outlook.com,,password,,,,...
            const uuidPrefixed = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*,\s*['"]{0,2}([^,'"]+@[^,'"]+)\s*,\s*,\s*([^,]+)/i.exec(
                trimmed
            );
            if (uuidPrefixed) {
                idHint = uuidPrefixed[1];
                email = cleanEmail(uuidPrefixed[2]);
                password = uuidPrefixed[3].trim();
            } else if (trimmed.includes(',,')) {
                const parts = trimmed.split(',');
                let emailIdx = parts.findIndex((p) => isValidEmail(cleanEmail(p)));
                if (emailIdx < 0) {
                    emailIdx = parts.findIndex((p) =>
                        isValidEmail(cleanEmail(p.replace(/^['"]+/, '')))
                    );
                }
                if (emailIdx >= 0) {
                    email = cleanEmail(parts[emailIdx]);
                    const after = parts.slice(emailIdx + 1);
                    const passCell = after.find(
                        (p) => p.trim() !== '' && p.trim() !== "''" && p.trim() !== '""'
                    );
                    password = (passCell || '').trim();
                    if (emailIdx > 0 && /^[0-9a-f-]{36}$/i.test(parts[0].trim())) {
                        idHint = parts[0].trim();
                    }
                }
            } else if (trimmed.includes(':') && !trimmed.includes(',')) {
                const idx = trimmed.indexOf(':');
                email = cleanEmail(trimmed.slice(0, idx));
                password = trimmed.slice(idx + 1).trim();
            } else if (trimmed.includes('|')) {
                const parts = trimmed.split('|').map((p) => p.trim());
                idHint = parts[0] || '';
                email = cleanEmail(parts[1] || parts[0]);
                password = (parts[2] || '').trim();
            } else {
                const comma = trimmed.split(',').map((p) => p.trim());
                email = cleanEmail(comma[0]);
                password = (comma[1] || '').trim();
            }
        }

        if (!email && !password) return;

        if (!email || !isValidEmail(email)) {
            skipped.push({
                lineNumber,
                email: email || '(none)',
                reason: 'malformed or missing email'
            });
            return;
        }
        if (!password) {
            skipped.push({ lineNumber, email, reason: 'no password' });
            return;
        }

        const emailKey = email.toLowerCase();
        if (seen.has(emailKey)) {
            duplicates.push({ lineNumber, email, firstSeenAt: seen.get(emailKey) });
            return;
        }
        seen.set(emailKey, lineNumber);

        registerSecret(password);

        accounts.push({
            lineNumber,
            email,
            emailKey,
            password,
            meta: idHint ? { code: idHint } : {}
        });
    });

    return { accounts, skipped, duplicates, total: lines.filter((l) => l.trim()).length };
}

module.exports = {
    loadAccountsFromEmailData,
    cleanEmail,
    isValidEmail,
    parseTabLine
};
