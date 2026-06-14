'use strict';

const Joi = require('joi');

const envSchema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3001),
  APP_URL: Joi.string().uri().default('http://localhost:3001'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // MongoDB
  MONGODB_URI: Joi.string().required(),

  // Redis
  REDIS_URL: Joi.string().required(),

  // Qdrant
  QDRANT_URL: Joi.string().uri().default('http://localhost:6333'),
  QDRANT_COLLECTION: Joi.string().default('nexus_embeddings'),

  // AI
  ANTHROPIC_API_KEY: Joi.string().required(),
  OPENAI_API_KEY: Joi.string().required(),
  LLM_MODEL: Joi.string().default('claude-sonnet-4-6'),
  EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  LLM_MAX_TOKENS: Joi.number().default(2000),
  LLM_TEMPERATURE: Joi.number().min(0).max(2).default(0.1),

  // Encryption
  ENCRYPTION_KEY: Joi.string().min(32).required(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  AI_RATE_LIMIT_MAX: Joi.number().default(20),

  // Uploads
  UPLOAD_MAX_SIZE_MB: Joi.number().default(50),
  UPLOAD_DIR: Joi.string().default('./uploads'),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'debug').default('info'),

  // Optional integrations (warn if missing, don't fail)
  SALESFORCE_CLIENT_ID: Joi.string().optional(),
  SALESFORCE_CLIENT_SECRET: Joi.string().optional(),
  JIRA_BASE_URL: Joi.string().uri().optional(),
  JIRA_API_TOKEN: Joi.string().optional(),
  SLACK_BOT_TOKEN: Joi.string().optional(),
  SLACK_SIGNING_SECRET: Joi.string().optional(),
  ZENDESK_SUBDOMAIN: Joi.string().optional(),
  ZENDESK_API_TOKEN: Joi.string().optional(),
  HUBSPOT_ACCESS_TOKEN: Joi.string().optional(),
  NOTION_API_KEY: Joi.string().optional(),
  GOOGLE_PRIVATE_KEY: Joi.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: Joi.string().email().optional(),
  GOOGLE_SPREADSHEET_ID: Joi.string().optional(),
})
  .unknown(true) // allow extra env vars (OS-level, CI, etc.)
  .required();

function validateEnv() {
  const { error, value } = envSchema.validate(process.env, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const missing = error.details.map((d) => `  ✗ ${d.message}`).join('\n');
    console.error(`\n[NEXUS] Environment validation FAILED:\n${missing}\n`);
    console.error('Copy .env.example to .env and fill in required values.\n');
    process.exit(1);
  }

  // Warn about missing optional integration keys
  const optionalIntegrations = [
    ['SALESFORCE_CLIENT_ID', 'Salesforce'],
    ['JIRA_API_TOKEN', 'Jira'],
    ['SLACK_BOT_TOKEN', 'Slack'],
    ['ZENDESK_API_TOKEN', 'Zendesk'],
    ['HUBSPOT_ACCESS_TOKEN', 'HubSpot'],
    ['NOTION_API_KEY', 'Notion'],
    ['GOOGLE_PRIVATE_KEY', 'Google Sheets'],
  ];

  const missingIntegrations = optionalIntegrations
    .filter(([key]) => !process.env[key])
    .map(([, name]) => name);

  if (missingIntegrations.length > 0) {
    console.warn(`[NEXUS] Optional integrations not configured: ${missingIntegrations.join(', ')}`);
  }

  return value;
}

module.exports = { validateEnv };
