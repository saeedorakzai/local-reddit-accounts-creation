const login = require('./login');
const register = require('./register');

const FEATURES = { login, register };

function getFeature(name) {
    const feature = FEATURES[name];
    if (!feature) {
        throw new Error(`Unknown feature: "${name}". Use: ${Object.keys(FEATURES).join(', ')}`);
    }
    return feature;
}

module.exports = { getFeature, FEATURES };
