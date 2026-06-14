'use strict';

const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const { getQdrantClient, getCollectionName } = require('../../config/qdrant');
const logger = require('../../common/utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const CHUNK_SIZE = 512;       // tokens approx
const CHUNK_OVERLAP = 64;     // overlap between chunks
const MAX_CHARS_PER_CHUNK = 1800; // ~512 tokens at ~3.5 chars/token

// ─── Generate embedding vector ────────────────────────────────────────────────
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000), // token limit guard
  });
  return response.data[0].embedding;
}

// ─── Batch generate embeddings ────────────────────────────────────────────────
async function generateEmbeddingsBatch(texts) {
  const BATCH_SIZE = 20;
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((t) => t.slice(0, 8000)),
    });
    results.push(...response.data.map((d) => d.embedding));
  }

  return results;
}

// ─── Chunk text into overlapping segments ─────────────────────────────────────
function chunkText(text, source = 'unknown') {
  // Clean text
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length <= MAX_CHARS_PER_CHUNK) {
    return [{ text: cleaned, chunkIndex: 0 }];
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < cleaned.length) {
    let end = start + MAX_CHARS_PER_CHUNK;

    if (end < cleaned.length) {
      // Find natural break point (paragraph > sentence > word)
      const paragraphBreak = cleaned.lastIndexOf('\n\n', end);
      const sentenceBreak = cleaned.lastIndexOf('. ', end);
      const wordBreak = cleaned.lastIndexOf(' ', end);

      if (paragraphBreak > start + MAX_CHARS_PER_CHUNK * 0.5) {
        end = paragraphBreak;
      } else if (sentenceBreak > start + MAX_CHARS_PER_CHUNK * 0.5) {
        end = sentenceBreak + 1;
      } else if (wordBreak > start) {
        end = wordBreak;
      }
    }

    const chunkText = cleaned.slice(start, end).trim();

    if (chunkText.length > 50) {
      chunks.push({ text: chunkText, chunkIndex });
      chunkIndex++;
    }

    // Move start with overlap
    start = end - Math.floor(MAX_CHARS_PER_CHUNK * (CHUNK_OVERLAP / CHUNK_SIZE));
    if (start >= cleaned.length) break;
  }

  return chunks;
}

// ─── Parse CSV into text chunks ───────────────────────────────────────────────
function parseCSV(csvContent, filename) {
  const lines = csvContent.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const chunks = [];

  // Process rows in groups of 20
  const GROUP_SIZE = 20;
  for (let i = 1; i < lines.length; i += GROUP_SIZE) {
    const group = lines.slice(i, i + GROUP_SIZE);
    const rows = group.map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/"/g, ''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      return Object.entries(row)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
    });

    chunks.push({
      text: `[CSV: ${filename}] Rows ${i}–${i + group.length - 1}:\n${rows.join('\n')}`,
      chunkIndex: Math.floor((i - 1) / GROUP_SIZE),
    });
  }

  return chunks;
}

// ─── Ingest document into vector store ───────────────────────────────────────
async function ingestDocument({
  tenantId,
  documentId,
  title,
  content,
  source = 'docs',
  mimeType = 'text/plain',
  metadata = {},
}) {
  logger.info('RAG: Starting document ingestion', {
    documentId,
    title,
    source,
    contentLength: content.length,
    tenantId,
  });

  // Parse by content type
  let rawChunks;
  if (mimeType === 'text/csv' || source === 'csv') {
    rawChunks = parseCSV(content, title);
  } else {
    rawChunks = chunkText(content, source);
  }

  logger.info('RAG: Text chunked', {
    documentId,
    chunkCount: rawChunks.length,
  });

  if (rawChunks.length === 0) {
    throw new Error('Document produced no chunks — may be empty or too short');
  }

  // Generate embeddings in batch
  const texts = rawChunks.map((c) => c.text);
  const embeddings = await generateEmbeddingsBatch(texts);

  // Build Qdrant points
  const points = rawChunks.map((chunk, idx) => ({
    id: uuidv4(),
    vector: embeddings[idx],
    payload: {
      tenantId: tenantId.toString(),
      documentId,
      title,
      source,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      charCount: chunk.text.length,
      ...metadata,
      ingestedAt: new Date().toISOString(),
    },
  }));

  // Upsert to Qdrant in batches of 100
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName();
  const BATCH_SIZE = 100;

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    await qdrant.upsert(collectionName, {
      wait: true,
      points: batch,
    });
  }

  logger.info('RAG: Document ingested successfully', {
    documentId,
    chunksIndexed: points.length,
    tenantId,
  });

  return {
    documentId,
    title,
    chunksIndexed: points.length,
    source,
    ingestedAt: new Date().toISOString(),
  };
}

// ─── Delete document from vector store ───────────────────────────────────────
async function deleteDocument(tenantId, documentId) {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName();

  await qdrant.delete(collectionName, {
    wait: true,
    filter: {
      must: [
        { key: 'tenantId', match: { value: tenantId.toString() } },
        { key: 'documentId', match: { value: documentId } },
      ],
    },
  });

  logger.info('RAG: Document deleted from vector store', { documentId, tenantId });
}

// ─── Semantic search ──────────────────────────────────────────────────────────
async function semanticSearch({ tenantId, query, source, limit = 5, scoreThreshold = 0.65 }) {
  const queryEmbedding = await generateEmbedding(query);
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName();

  // Build filter — always scope to tenant
  const mustFilters = [
    { key: 'tenantId', match: { value: tenantId.toString() } },
  ];

  if (source) {
    mustFilters.push({ key: 'source', match: { value: source } });
  }

  const results = await qdrant.search(collectionName, {
    vector: queryEmbedding,
    limit,
    score_threshold: scoreThreshold,
    filter: { must: mustFilters },
    with_payload: true,
  });

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    text: r.payload.text,
    metadata: {
      documentId: r.payload.documentId,
      title: r.payload.title,
      source: r.payload.source,
      chunkIndex: r.payload.chunkIndex,
    },
  }));
}

// ─── Keyword search (BM25-style via Qdrant scroll + filter) ──────────────────
async function keywordSearch({ tenantId, query, source, limit = 10 }) {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName();

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (keywords.length === 0) return [];

  const mustFilters = [
    { key: 'tenantId', match: { value: tenantId.toString() } },
  ];

  if (source) {
    mustFilters.push({ key: 'source', match: { value: source } });
  }

  // Scroll through results and filter by keyword presence
  const { points } = await qdrant.scroll(collectionName, {
    filter: { must: mustFilters },
    limit: 200,
    with_payload: true,
    with_vector: false,
  });

  // Score by keyword frequency
  const scored = points
    .map((p) => {
      const text = (p.payload.text || '').toLowerCase();
      const score = keywords.reduce(
        (sum, kw) => sum + (text.includes(kw) ? 1 : 0),
        0
      );
      return { point: p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((r) => ({
    id: r.point.id,
    score: r.score / keywords.length,
    text: r.point.payload.text,
    metadata: {
      documentId: r.point.payload.documentId,
      title: r.point.payload.title,
      source: r.point.payload.source,
      chunkIndex: r.point.payload.chunkIndex,
    },
  }));
}

// ─── Hybrid search (semantic + keyword, RRF fusion) ───────────────────────────
async function hybridSearch({ tenantId, query, source, limit = 5 }) {
  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.allSettled([
    semanticSearch({ tenantId, query, source, limit: limit * 2 }),
    keywordSearch({ tenantId, query, source, limit: limit * 2 }),
  ]);

  const semantic = semanticResults.status === 'fulfilled' ? semanticResults.value : [];
  const keyword = keywordResults.status === 'fulfilled' ? keywordResults.value : [];

  // Reciprocal Rank Fusion (RRF)
  const RRF_K = 60;
  const scoreMap = new Map();

  const addRRF = (results, weight = 1) => {
    results.forEach((result, rank) => {
      const id = result.id;
      const rrfScore = weight / (RRF_K + rank + 1);
      if (scoreMap.has(id)) {
        scoreMap.get(id).score += rrfScore;
      } else {
        scoreMap.set(id, { ...result, score: rrfScore });
      }
    });
  };

  addRRF(semantic, 0.7);   // Weight semantic higher
  addRRF(keyword, 0.3);

  // Sort by fused score and return top results
  const fused = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return fused;
}

// ─── List documents for tenant ────────────────────────────────────────────────
async function listDocuments(tenantId) {
  const qdrant = getQdrantClient();
  const collectionName = getCollectionName();

  const { points } = await qdrant.scroll(collectionName, {
    filter: {
      must: [
        { key: 'tenantId', match: { value: tenantId.toString() } },
        { key: 'chunkIndex', match: { value: 0 } }, // Only first chunk per doc
      ],
    },
    limit: 100,
    with_payload: true,
    with_vector: false,
  });

  return points.map((p) => ({
    documentId: p.payload.documentId,
    title: p.payload.title,
    source: p.payload.source,
    ingestedAt: p.payload.ingestedAt,
  }));
}

module.exports = {
  ingestDocument,
  deleteDocument,
  semanticSearch,
  keywordSearch,
  hybridSearch,
  listDocuments,
  generateEmbedding,
  chunkText,
};