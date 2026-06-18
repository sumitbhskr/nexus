const path = require('path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.test'), override: true });
} catch (e) {}
