/**
 * Resolve which AdsPower profile each account belongs to.
 *
 * The CSV has no profile ID, so the join lives outside it. 'byMapFile' is the
 * default because it is the only strategy that stays correct when the CSV is
 * re-exported in a different row order — a mis-bind sends one account's password
 * at a different account, and repeated wrong-password attempts are what trigger
 * Microsoft account locks.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = require('../projectRoot');

function resolvePath(relativePath) {
    return path.isAbsolute(relativePath)
        ? relativePath
        : path.join(PROJECT_ROOT, relativePath);
}

/** One local Firefox profile directory name per Outlook email. */
function byLocalProfile(accounts) {
    const bound = accounts.map((account) => {
        const local = account.emailKey
            .replace(/[^a-zA-Z0-9._-]+/g, '_')
            .slice(0, 64);
        return {
            ...account,
            profileId: `ff-${local}`
        };
    });

    return {
        bound,
        unboundAccounts: [],
        unboundProfiles: [],
        duplicateProfiles: []
    };
}

/**
 * Accepts either shape:
 *   { "bindings": [ { "profileId": "k1abc", "email": "a@b.com" } ] }
 *   { "a@b.com": "k1abc" }
 */
function parseMapDocument(parsed, sourceLabel) {
    if (Array.isArray(parsed?.bindings)) {
        return parsed.bindings.map((entry, i) => {
            const email = String(entry.email || '').trim().toLowerCase();
            const profileId = String(entry.profileId || '').trim();
            if (!email || !profileId) {
                throw new Error(
                    `${sourceLabel}: bindings[${i}] needs both "email" and "profileId"`
                );
            }
            return { emailKey: email, profileId };
        });
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([email, profileId]) => ({
            emailKey: String(email).trim().toLowerCase(),
            profileId: String(profileId).trim()
        }));
    }

    throw new Error(
        `${sourceLabel}: expected { "bindings": [...] } or { "email": "profileId" }`
    );
}

function loadMapFile(mapFile) {
    const filePath = resolvePath(mapFile);

    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Bindings file not found: ${mapFile}\n` +
            `   Create it, or run "npm run bind" to draft one from AdsPower.`
        );
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        throw new Error(`Invalid JSON in ${mapFile}: ${err.message}`);
    }

    return parseMapDocument(parsed, mapFile);
}

function byMapFile(accounts, config) {
    const entries = loadMapFile(config.binding.mapFile);
    const byEmail = new Map();
    const duplicateProfiles = [];
    const seenProfiles = new Map();

    for (const entry of entries) {
        byEmail.set(entry.emailKey, entry.profileId);
        if (seenProfiles.has(entry.profileId)) {
            duplicateProfiles.push({
                profileId: entry.profileId,
                emails: [seenProfiles.get(entry.profileId), entry.emailKey]
            });
        } else {
            seenProfiles.set(entry.profileId, entry.emailKey);
        }
    }

    const bound = [];
    const unboundAccounts = [];

    for (const account of accounts) {
        const profileId = byEmail.get(account.emailKey);
        if (profileId) {
            bound.push({ ...account, profileId });
        } else {
            unboundAccounts.push(account);
        }
    }

    const boundEmails = new Set(bound.map((a) => a.emailKey));
    const unboundProfiles = entries
        .filter((e) => !boundEmails.has(e.emailKey))
        .map((e) => ({ profileId: e.profileId, email: e.emailKey }));

    return { bound, unboundAccounts, unboundProfiles, duplicateProfiles };
}

function byIndex(accounts, config) {
    const profileIds = (config.adspower.profileIds || []).map((id) => String(id).trim());

    if (!profileIds.length) {
        throw new Error(
            'binding.strategy is "byIndex" but adspower.profileIds is empty in config/app.js'
        );
    }

    const bound = [];
    const unboundAccounts = [];

    accounts.forEach((account, i) => {
        if (i < profileIds.length) {
            bound.push({ ...account, profileId: profileIds[i] });
        } else {
            unboundAccounts.push(account);
        }
    });

    const unboundProfiles = profileIds
        .slice(accounts.length)
        .map((profileId) => ({ profileId, email: null }));

    return { bound, unboundAccounts, unboundProfiles, duplicateProfiles: [] };
}

/**
 * Ask AdsPower which profiles exist and match them to accounts by email appearing
 * in the profile's name, username, or remark. Drafting aid for `npm run bind` —
 * it writes a file for review rather than binding at runtime.
 */
async function lookupFromAdsPower(accounts, config, { onProgress = null } = {}) {
    const axios = require('axios');
    const baseUrl = config.adspower.baseUrl;
    const profiles = [];

    // AdsPower rate-limits /user/list the same way it rate-limits browser starts.
    // Paging without a gap trips "Too many request per second" partway through and
    // silently returns a short list, which would look like "no profile matched".
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const PAGE_DELAY_MS = 1200;
    const MAX_PAGES = 200;

    for (let page = 1; page <= MAX_PAGES; page++) {
        if (page > 1) await sleep(PAGE_DELAY_MS);

        let response;
        for (let attempt = 1; attempt <= 3; attempt++) {
            response = await axios.get(`${baseUrl}/api/v1/user/list`, {
                params: { page, page_size: 100 },
                timeout: 20000
            });

            if (response.data.code === 0) break;

            if (/too many request/i.test(response.data.msg || '')) {
                if (attempt === 3) {
                    throw new Error(
                        `AdsPower kept rate-limiting the profile list after ${page - 1} page(s). ` +
                        `Try again in a moment.`
                    );
                }
                await sleep(3000 * attempt);
                continue;
            }

            throw new Error(`AdsPower API error: ${response.data.msg}`);
        }

        const list = response.data.data?.list || [];
        profiles.push(...list);
        if (onProgress) onProgress(profiles.length);
        if (list.length < 100) break;
    }

    const matched = [];
    const unmatched = [];

    for (const account of accounts) {
        const hit = profiles.find((p) => {
            const haystack = [p.name, p.username, p.remark, p.user_id]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return haystack.includes(account.emailKey);
        });

        if (hit) {
            matched.push({ email: account.email, profileId: hit.user_id });
        } else {
            unmatched.push(account.email);
        }
    }

    return { matched, unmatched, profileCount: profiles.length };
}

function resolveBindings(accounts, config) {
    const strategy = config.binding.strategy;

    if (strategy === 'byLocalProfile') return byLocalProfile(accounts);
    if (strategy === 'byQueue') {
        // Lazily required to avoid a cycle (queue.js pulls in outcomes/csvSource).
        const { pairWithProfiles } = require('./queue');
        return pairWithProfiles(accounts, config);
    }
    if (strategy === 'byMapFile') return byMapFile(accounts, config);
    if (strategy === 'byIndex') return byIndex(accounts, config);
    if (strategy === 'byAdsPowerLookup') {
        throw new Error(
            'binding.strategy "byAdsPowerLookup" is not used with local Firefox.\n' +
            '   Use strategy "byLocalProfile" (default).'
        );
    }

    throw new Error(
        `Unknown binding.strategy "${strategy}". ` +
        `Use: byLocalProfile, byMapFile, byIndex, byQueue`
    );
}

module.exports = {
    resolveBindings,
    lookupFromAdsPower,
    loadMapFile,
    parseMapDocument,
    resolvePath
};
