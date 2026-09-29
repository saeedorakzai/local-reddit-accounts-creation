const path = require('path');
const PROJECT_ROOT = require('../projectRoot');

const APP_CONFIG_PATH = path.join(PROJECT_ROOT, 'config/creation-app.cjs');

/** Re-read config/creation-app.cjs from disk. */
function loadRootConfig() {
    delete require.cache[require.resolve(APP_CONFIG_PATH)];
    return require(APP_CONFIG_PATH);
}

module.exports = { loadRootConfig, APP_CONFIG_PATH };
