'use strict';

const { QdrantClient } = require('@qdrant/js-client-rest');
const logger = require('../common/utils/logger');

let qdrantClient = null;

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'nexus_embeddings';
const VECTOR_SIZE = 1536; // text-embedding-3-small dimensions

async function initQdrant() {
  const url = process.env.QDRANT_URL || 'http://qdrant:6333';

  qdrantClient = new QdrantClient({ url });

  try {
    // Verify connectivity
    await qdrantClient.getCollections();
    logger.info('Qdrant connected', { url });

    // Create collection if it doesn't exist
    await ensureCollection();
  } catch (error) {
    logger.warn('Qdrant connection failed — continuing without vector search', {
      error: error.message,
      url,
    });
    qdrantClient = null; // reset so getQdrantClient() throws cleanly
  }
}

async function ensureCollection() {
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);

    if (!exists) {
      await qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
        optimizers_config: {
          default_segment_number: 2,
          indexing_threshold: 20000,
        },
        replication_factor: 1,
      });

      // Create payload indexes for filtering
      await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'tenantId',
        field_schema: 'keyword',
      });
      await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'source',
        field_schema: 'keyword',
      });
      await qdrantClient.createPayloadIndex(COLLECTION_NAME, {
        field_name: 'documentId',
        field_schema: 'keyword',
      });

      logger.info(`Qdrant collection '${COLLECTION_NAME}' created with indexes`);
    } else {
      logger.info(`Qdrant collection '${COLLECTION_NAME}' already exists`);
    }
  } catch (error) {
    logger.error('Failed to initialize Qdrant collection', { error: error.message });
    throw error;
  }
}

function getQdrantClient() {
  if (!qdrantClient) {
    throw new Error('Qdrant client not initialized — call initQdrant() first');
  }
  return qdrantClient;
}

function getCollectionName() {
  return COLLECTION_NAME;
}

module.exports = { initQdrant, getQdrantClient, getCollectionName };
