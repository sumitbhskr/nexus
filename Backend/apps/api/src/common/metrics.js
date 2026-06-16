// src/common/metrics.js
'use strict';

const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

module.exports = { register };
