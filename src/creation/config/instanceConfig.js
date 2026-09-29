/**
 * Per-profile config — resolve every { min, max } range into one concrete value,
 * once per profile per run.
 *
 * Two profiles in the same batch must not sample the same distribution on every
 * keystroke, or they move in lockstep and the whole batch looks like one actor.
 */

function randomInt(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** A number passes through; a { min, max } resolves to a single pick. */
function resolveRange(value) {
    if (value == null) return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value.min != null && value.max != null) {
        return randomInt(value.min, value.max);
    }
    return value;
}

function resolveRanges(source = {}) {
    const resolved = {};
    for (const [key, value] of Object.entries(source)) {
        resolved[key] = resolveRange(value);
    }
    return resolved;
}

/** A full config snapshot for one account's run. */
function createInstanceConfig(baseConfig, account) {
    const outlook = baseConfig.platforms.outlook;
    const login = baseConfig.features.login.outlook;
    const reddit = baseConfig.platforms.reddit;
    const register = baseConfig.features.register?.reddit;

    return {
        ...baseConfig,
        profileId: account.profileId,
        account,
        platforms: {
            ...baseConfig.platforms,
            outlook: {
                ...outlook,
                timing: resolveRanges(outlook.timing)
            },
            ...(reddit
                ? {
                    reddit: {
                        ...reddit,
                        timing: resolveRanges(reddit.timing || {})
                    }
                }
                : {})
        },
        features: {
            ...baseConfig.features,
            login: {
                ...baseConfig.features.login,
                outlook: {
                    ...login,
                    settleMs: resolveRange(login.settleMs)
                }
            },
            ...(register
                ? {
                    register: {
                        ...baseConfig.features.register,
                        reddit: {
                            ...register,
                            settleMs: resolveRange(register.settleMs)
                        }
                    }
                }
                : {})
        }
    };
}

module.exports = {
    createInstanceConfig,
    resolveRange,
    resolveRanges,
    randomInt
};
