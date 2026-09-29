const config = require('./config');

function getPlatformsToRun() {
    return ['reddit'];
}

module.exports = {
    name: 'register',
    config,
    getPlatformsToRun
};
