'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const ragService = require('./rag.service');
const { authenticate, authorize } = require('../../common/middleware/auth');
const { aiLimiter } = require('../../common/middleware/rateLimiter');
const { auditLog } = require('../../common/middleware/auditLog');
const { ValidationError, AppError } = require('../../common/middleware/errorHandler');
const logger = require('../../common/utils/logger');

// ─── Multer setup ─────────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB) || 50) * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.csv', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`File type not allowed. Allowed: ${allowed.join(', ')}`));
    }
  },
});

router.use(authenticate);

// ─── POST /api/v1/rag/ingest/text ────────────────────────────────────────────
router.post(
  '/ingest/text',
  authorize('analyst'),
  aiLimiter,
  auditLog('RAG_INGEST_TEXT', 'rag'),
  async (req, res) => {
    const { title, content, source = 'docs', metadata } = req.body;

    if (!title || !content) {
      throw new ValidationError('title and content are required');
    }

    if (content.length < 50) {
      throw new ValidationError('Content must be at least 50 characters');
    }

    if (content.length > 500000) {
      throw new ValidationError('Content exceeds 500,000 character limit');
    }

    const result = await ragService.ingestDocument({
      tenantId: req.tenantId,
      documentId: require('uuid').v4(),
      title,
      content,
      source,
      mimeType: 'text/plain',
      metadata: metadata || {},
    });

    res.status(201).json({ success: true, data: result });
  }
);

// ─── POST /api/v1/rag/ingest/file ────────────────────────────────────────────
router.post(
  '/ingest/file',
  authorize('analyst'),
  upload.single('file'),
  auditLog('RAG_INGEST_FILE', 'rag'),
  async (req, res) => {
    if (!req.file) {
      throw new ValidationError('File is required');
    }

    const { title, source = 'docs' } = req.body;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const documentId = require('uuid').v4();

    let content = '';
    let mimeType = 'text/plain';

    try {
      if (ext === '.pdf') {
        const pdfParse = require('pdfparse');
        const fileBuffer = fs.readFileSync(req.file.path);
        const parsed = await pdfParse(fileBuffer);
        content = parsed.text;
        mimeType = 'application/pdf';
      } else if (ext === '.csv') {
        content = fs.readFileSync(req.file.path, 'utf-8');
        mimeType = 'text/csv';
      } else {
        content = fs.readFileSync(req.file.path, 'utf-8');
      }

      if (!content || content.trim().length < 50) {
        throw new ValidationError('File content is empty or too short');
      }

      const result = await ragService.ingestDocument({
        tenantId: req.tenantId,
        documentId,
        title: title || req.file.originalname,
        content,
        source: ext === '.csv' ? 'csv' : source,
        mimeType,
        metadata: {
          originalFilename: req.file.originalname,
          fileSize: req.file.size,
        },
      });

      res.status(201).json({ success: true, data: result });
    } finally {
      // Clean up uploaded file
      fs.unlink(req.file.path, () => {});
    }
  }
);

// ─── POST /api/v1/rag/search ──────────────────────────────────────────────────
router.post(
  '/search',
  aiLimiter,
  async (req, res) => {
    const { query, source, limit = 5, mode = 'hybrid' } = req.body;

    if (!query || query.trim().length < 3) {
      throw new ValidationError('query must be at least 3 characters');
    }

    let results;
    switch (mode) {
      case 'semantic':
        results = await ragService.semanticSearch({
          tenantId: req.tenantId,
          query,
          source,
          limit: Math.min(limit, 20),
        });
        break;
      case 'keyword':
        results = await ragService.keywordSearch({
          tenantId: req.tenantId,
          query,
          source,
          limit: Math.min(limit, 20),
        });
        break;
      default:
        results = await ragService.hybridSearch({
          tenantId: req.tenantId,
          query,
          source,
          limit: Math.min(limit, 20),
        });
    }

    res.json({
      success: true,
      data: {
        query,
        mode,
        results,
        count: results.length,
      },
    });
  }
);

// ─── GET /api/v1/rag/documents ────────────────────────────────────────────────
router.get('/documents', async (req, res) => {
  const documents = await ragService.listDocuments(req.tenantId);
  res.json({ success: true, data: { documents, count: documents.length } });
});

// ─── DELETE /api/v1/rag/documents/:documentId ────────────────────────────────
router.delete(
  '/documents/:documentId',
  authorize('manager'),
  auditLog('RAG_DELETE_DOCUMENT', 'rag'),
  async (req, res) => {
    await ragService.deleteDocument(req.tenantId, req.params.documentId);
    res.json({ success: true, message: 'Document deleted from knowledge base' });
  }
);

module.exports = router;