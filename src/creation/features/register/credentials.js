/**
 * Generate + persist Reddit credentials for a successful register run.
 */

const fs = require('fs');
const path = require('path');

const { registerSecret } = require('../../shared/redact');

const REPO_ROOT = require('../../projectRoot');
const DEFAULT_FILE = path.join(REPO_ROOT, 'data/reddit-accounts.csv');
const HEADER = 'processedAt,profileId,outlookEmail,redditUsername,redditPassword,outcome,detail';

function randUsername() {
    // Reddit username: lowercase letters only — no digits, no caps, no underscore.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const len = 10 + Math.floor(Math.random() * 7); // 10–16
    let name = '';
    for (let i = 0; i < len; i++) {
        name += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return name;
}

function randPassword(length = 16) {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '!@#$%^&*';
    const all = upper + lower + digits + special;
    const chars = [
        upper[Math.floor(Math.random() * upper.length)],
        lower[Math.floor(Math.random() * lower.length)],
        digits[Math.floor(Math.random() * digits.length)],
        special[Math.floor(Math.random() * special.length)]
    ];
    for (let i = chars.length; i < length; i++) {
        chars.push(all[Math.floor(Math.random() * all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

function createCredentials(_outlookEmail) {
    const username = randUsername();
    const password = randPassword(16);
    registerSecret(password);
    return { username, password };
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function appendRedditAccount(row, filePath = DEFAULT_FILE) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const exists = fs.existsSync(filePath);
    if (!exists) fs.writeFileSync(filePath, `${HEADER}\n`);
    const line = [
        row.processedAt || new Date().toISOString(),
        row.profileId,
        row.outlookEmail,
        row.redditUsername,
        row.redditPassword,
        row.outcome,
        row.detail || ''
    ].map(csvEscape).join(',');
    fs.appendFileSync(filePath, `${line}\n`);
    return filePath;
}

module.exports = {
    createCredentials,
    appendRedditAccount,
    randUsername,
    randPassword,
    DEFAULT_FILE,
    HEADER
};
