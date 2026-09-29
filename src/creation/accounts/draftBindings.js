/**
 * `npm run bind` — ask AdsPower which profiles exist, match them to accounts by
 * email, and write data/profiles/bindings.json for review.
 *
 * It drafts a file. It never binds at runtime, because a wrong binding sends one
 * account's password at another account and repeated wrong-password attempts are
 * what trigger Microsoft account locks. A human checks this before it is used.
 */

const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../config');
const { loadAccounts } = require('./csvSource');
const { lookupFromAdsPower, resolvePath } = require('./bindings');

async function draftBindings() {
    const config = loadConfig();
    const { accounts } = loadAccounts(config.accounts.csvFile);

    if (!accounts.length) {
        console.log('❌ No usable accounts in the CSV — nothing to bind.\n');
        return 1;
    }

    console.log(`🔍 Asking AdsPower at ${config.adspower.baseUrl} for its profile list...`);

    let result;
    try {
        result = await lookupFromAdsPower(accounts, config, {
            onProgress: (count) => process.stdout.write(`\r   ${count} profiles scanned...`)
        });
        process.stdout.write('\r');
    } catch (error) {
        console.error(`\n❌ Could not reach AdsPower: ${error.message}`);
        console.error('   Is AdsPower running with its Local API enabled?\n');
        return 1;
    }

    const { matched, unmatched, profileCount } = result;
    console.log(`   ${profileCount} profile(s) found, ${matched.length}/${accounts.length} matched by email.\n`);

    const outPath = resolvePath(config.binding.mapFile);
    const existed = fs.existsSync(outPath);

    // Never replace a real bindings file with an empty one. Matching relies on the
    // email appearing in a profile's name/username/remark; if AdsPower profiles are
    // named something else entirely, zero matches is expected and destroying the
    // hand-written file would be the worst possible response.
    if (!matched.length) {
        console.log('⚠️  No profile name, username, or remark contained any of these emails.');
        console.log(`   Nothing was written${existed ? ' — your existing bindings file is untouched' : ''}.`);
        console.log('\n   Map them by hand instead. In AdsPower, each profile\'s ID is the');
        console.log(`   "user_id" shown in its detail panel. Then edit ${config.binding.mapFile}:\n`);
        console.log('   {');
        console.log('     "bindings": [');
        accounts.forEach((a, i) => {
            const comma = i < accounts.length - 1 ? ',' : '';
            console.log(`       { "profileId": "PUT_ID_HERE", "email": "${a.email}" }${comma}`);
        });
        console.log('     ]');
        console.log('   }\n');
        return 1;
    }

    if (existed) {
        const backup = `${outPath}.bak`;
        fs.copyFileSync(outPath, backup);
        console.log(`ℹ️  Existing bindings backed up to ${path.basename(backup)}`);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
        outPath,
        JSON.stringify({ bindings: matched }, null, 2) + '\n',
        'utf8'
    );

    console.log(`📝 Wrote ${config.binding.mapFile}`);
    for (const entry of matched) {
        console.log(`   ${entry.profileId}  ${entry.email}`);
    }

    if (unmatched.length) {
        console.log(`\n⚠️  No profile matched these ${unmatched.length} account(s):`);
        for (const email of unmatched) {
            console.log(`   ${email}`);
        }
        console.log(
            '\n   Add their profileId by hand. Matching looks for the email inside a\n' +
            "   profile's name, username, or remark."
        );
    }

    console.log('\n👉 Review the file, then run: npm run accounts\n');
    return unmatched.length ? 1 : 0;
}

module.exports = { draftBindings };
