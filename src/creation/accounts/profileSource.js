/**
 * Parse the profile queue — the AdsPower instances to log accounts into.
 *
 * Two shapes, chosen by file extension:
 *   - .json : an array of ids  ["k1abc", ...]  or of objects [{ user_id | profileId | id }]
 *   - .csv  : a "profileId" column, or just one id per line, header optional
 * Extra columns/fields are ignored; only the id is used.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const ID_HEADERS = ['profileid', 'profile id', 'user_id', 'user id', 'id', 'adspower id', 'adspower'];

function clean(value) {
    return String(value ?? '').replace(/^['"`]+/, '').replace(/['"`]+$/, '').trim();
}

/** An AdsPower id is short and alphanumeric; this rejects stray words/headers. */
function looksLikeProfileId(value) {
    return /^[a-z0-9]{6,}$/i.test(value);
}

function loadProfiles(sourcePath, projectRoot = require('../projectRoot')) {
    const filePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(projectRoot, sourcePath);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Profiles file not found: ${sourcePath}`);
    }

    if (/\.json$/i.test(filePath)) {
        return loadProfilesJson(filePath);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const records = parse(raw, {
        columns: false,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true
    });

    if (!records.length) {
        return { profiles: [], skipped: [] };
    }

    // Detect a header row and, if present, which column holds the id.
    let idColumn = 0;
    let startRow = 0;
    const firstRow = records[0].map((c) => clean(c).toLowerCase());
    const headerHit = firstRow.findIndex((c) => ID_HEADERS.includes(c));
    if (headerHit >= 0) {
        idColumn = headerHit;
        startRow = 1;
    }

    const profiles = [];
    const skipped = [];
    const seen = new Set();

    for (let i = startRow; i < records.length; i++) {
        const lineNumber = i + 1;
        const row = records[i];
        const value = clean(row[idColumn] ?? row[0]);

        if (!value) continue;                        // blank filler line
        if (!looksLikeProfileId(value)) {
            skipped.push({ lineNumber, value, reason: 'does not look like a profile id' });
            continue;
        }
        if (seen.has(value)) {
            skipped.push({ lineNumber, value, reason: 'duplicate profile id' });
            continue;
        }
        seen.add(value);
        profiles.push({ profileId: value, lineNumber });
    }

    return { profiles, skipped };
}

/** Parse a JSON profiles file: array of ids, or array of objects with an id field. */
function loadProfilesJson(filePath) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        throw new Error(`Invalid JSON in ${path.basename(filePath)}: ${err.message}`);
    }

    const list = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed.profiles) ? parsed.profiles : []);

    const profiles = [];
    const skipped = [];
    const seen = new Set();

    list.forEach((item, i) => {
        const value = clean(
            typeof item === 'string' ? item : (item.user_id || item.profileId || item.id || '')
        );
        if (!value) {
            skipped.push({ lineNumber: i + 1, value: '', reason: 'no id' });
            return;
        }
        if (!looksLikeProfileId(value)) {
            skipped.push({ lineNumber: i + 1, value, reason: 'does not look like a profile id' });
            return;
        }
        if (seen.has(value)) {
            skipped.push({ lineNumber: i + 1, value, reason: 'duplicate profile id' });
            return;
        }
        seen.add(value);
        profiles.push({ profileId: value, lineNumber: i + 1 });
    });

    return { profiles, skipped };
}

module.exports = { loadProfiles, loadProfilesJson, clean, looksLikeProfileId };
