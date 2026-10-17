'use strict';
// Where the browser transports keep their Chrome profiles (signed-in sessions): <project root>/data. Keep it out of git.
const path = require('path');

module.exports = { DATA_DIR: path.join(__dirname, '..', '..', '..', 'data') };
