/**
 * Parse data/logins.csv — the G2G credential export.
 *
 * Three things about the real file drive the implementation:
 *   1. Emails carry a leading apostrophe ('user@outlook.com) — Excel's text guard.
 *   2. The template ships ~150 trailing all-empty rows.
 *   3. Columns are read by header name, so an added G2G column cannot shift the
 *      password into the wrong field.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const { registerSecret } = require('../shared/redact');

/** Header aliases, most specific first. Matched against normalized headers. */
const FIELDS = {
    code: ['g2g code id', 'code id'],
    email: ['user id / email address', 'email address', 'user id', 'email'],
    mobile: ['mobile number', 'mobile', 'phone'],
    password: ['password', 'pass'],
    activationDate: ['activation date'],
    secretQuestion1: ['first secret question'],
    secretAnswer1: ['first secret answer'],
    secretQuestion2: ['second secret question'],
    secretAnswer2: ['second secret answer'],
    secretQuestion3: ['third secret question'],
    secretAnswer3: ['third secret answer'],
    firstName: ['first name'],
    lastName: ['last name'],
    country: ['account country', 'country'],
    dateOfBirth: ['date of birth'],
    remark: ['remark', 'note', 'notes']
};

function normalizeHeader(header) {
    return String(header || '')
        .replace(/﻿/g, '')
        .replace(/\(.*?\)/g, '')     // drop "(eg. 01 Jan 2020)" hints
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Map each logical field to the actual header string present in the file.
 * Exact match wins over substring so "password" never binds to a header that
 * merely contains the word.
 */
function resolveHeaders(headers) {
    const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
    const resolved = {};

    for (const [field, aliases] of Object.entries(FIELDS)) {
        let hit = null;
        for (const alias of aliases) {
            hit = normalized.find((h) => h.norm === alias);
            if (hit) break;
        }
        if (!hit) {
            for (const alias of aliases) {
                hit = normalized.find((h) => h.norm.includes(alias));
                if (hit) break;
            }
        }
        if (hit) resolved[field] = hit.raw;
    }

    return resolved;
}

function cleanCell(value) {
    return String(value ?? '').trim();
}

/** Strip Excel's leading text guard and surrounding quotes from an address. */
function cleanEmail(value) {
    return cleanCell(value).replace(/^['"`]+/, '').replace(/['"`]+$/, '').trim();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @returns {{ accounts: object[], skipped: object[], duplicates: object[], total: number }}
 */
function loadAccounts(csvPath, projectRoot = require('../projectRoot')) {
    const filePath = path.isAbsolute(csvPath) ? csvPath : path.join(projectRoot, csvPath);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Credentials file not found: ${csvPath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const rows = parse(raw, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: false
    });

    if (!rows.length) {
        return { accounts: [], skipped: [], duplicates: [], total: 0 };
    }

    const headers = Object.keys(rows[0]);
    const map = resolveHeaders(headers);

    if (!map.email || !map.password) {
        const missing = [!map.email && 'email', !map.password && 'password']
            .filter(Boolean)
            .join(' and ');
        throw new Error(
            `Could not find the ${missing} column in ${csvPath}. ` +
            `Headers seen: ${headers.join(', ')}`
        );
    }

    const accounts = [];
    const skipped = [];
    const duplicates = [];
    const seen = new Map();

    rows.forEach((row, index) => {
        const lineNumber = index + 2;                 // +1 header, +1 to 1-base
        const email = cleanEmail(row[map.email]);
        const password = cleanCell(row[map.password]);

        // The template's trailing blank rows are not failures — drop them silently.
        const rowHasAnyValue = Object.values(row).some((v) => cleanCell(v) !== '');
        if (!email && !rowHasAnyValue) return;

        if (!email) {
            skipped.push({ lineNumber, reason: 'no email address' });
            return;
        }
        if (!isValidEmail(email)) {
            skipped.push({ lineNumber, email, reason: 'malformed email address' });
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

        const meta = {};
        for (const [field, header] of Object.entries(map)) {
            if (field === 'email' || field === 'password') continue;
            const value = cleanCell(row[header]);
            if (value) meta[field] = value;
        }

        registerSecret(password);

        accounts.push({ lineNumber, email, emailKey, password, meta });
    });

    return { accounts, skipped, duplicates, total: rows.length };
}

module.exports = {
    loadAccounts,
    cleanEmail,
    normalizeHeader,
    resolveHeaders,
    isValidEmail
};
