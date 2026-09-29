const config = require('./config');

function getPlatformsToRun() {
    return ['outlook'];
}

module.exports = {
    name: 'login',
    config,
    getPlatformsToRun
};
