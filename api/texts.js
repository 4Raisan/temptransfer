// Vercel Serverless Function: /api/texts
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env.local for local testing if present
if (fs.existsSync(path.join(process.cwd(), '.env.local'))) {
  try {
    const envContent = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.substring(0, idx);
        const v = trimmed.substring(idx + 1).replace(/^"|"$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    });
  } catch (e) {}
}

let putBlob = null;
let listBlob = null;
try {
  const blobModule = require('@vercel/blob');
  putBlob = blobModule.put;
  listBlob = blobModule.list;
} catch (e) {}

const BLOB_FILENAME = 'community_texts.json';
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BODY_SIZE = 64 * 1024; // 64KB max request body
const MAX_TEXT_LENGTH = 10000; // 10,000 chars max per text
const MAX_TEXTS = 200; // Max texts in community board

let memoryTexts = [];
let cachedBlobUrl = null;

function purgeExpired(list) {
  const now = Date.now();
  return (list || []).filter(item => {
    const expires = item.expiresAt || (item.createdAt + EXPIRATION_MS);
    return expires > now;
  });
}

async function loadCommunityTexts() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      let targetUrl = cachedBlobUrl;

      // If URL not cached yet in this container instance, discover it via listBlob
      if (!targetUrl && listBlob) {
        const { blobs } = await listBlob({ prefix: BLOB_FILENAME, limit: 1 });
        const targetBlob = blobs.find(b => b.pathname === BLOB_FILENAME);
        if (targetBlob) {
          const rawUrl = targetBlob.url || targetBlob.downloadUrl;
          cachedBlobUrl = rawUrl ? rawUrl.split('?')[0] : null;
          targetUrl = cachedBlobUrl;
        }
      }

      if (targetUrl) {
        const cleanUrl = targetUrl.split('?')[0];
        const res = await fetch(cleanUrl + '?_t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });
        if (res.ok) {
          const remoteList = await res.json();
          if (Array.isArray(remoteList)) {
            const valid = purgeExpired(remoteList);
            memoryTexts = valid;
            return { texts: valid, hadExpired: valid.length < remoteList.length };
          }
        }
      }
    } catch (e) {
      console.warn('Blob list/fetch error:', e.message);
    }
  }

  const valid = purgeExpired(memoryTexts);
  return { texts: valid, hadExpired: false };
}

async function saveCommunityTexts(newList) {
  const valid = purgeExpired(newList);
  memoryTexts = valid;

  if (putBlob && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const b = await putBlob(BLOB_FILENAME, JSON.stringify(valid), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      if (b && (b.url || b.downloadUrl)) {
        cachedBlobUrl = (b.url || b.downloadUrl).split('?')[0];
      }
    } catch (e) {
      console.error('Failed to sync to Vercel Blob:', e.message);
    }
  }

  return valid;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let exceeded = false;

    req.on('data', chunk => {
      if (exceeded) return;
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        exceeded = true;
        return;
      }
      body += chunk;
    });

    req.on('error', err => {
      if (!exceeded) reject(err);
    });

    req.on('end', () => {
      if (exceeded) {
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(new Error('INVALID_JSON'));
      }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // GET: Fetch community texts
  if (req.method === 'GET') {
    try {
      const { texts, hadExpired } = await loadCommunityTexts();

      // Save back if expired items were purged (cleanup on read)
      if (hadExpired) {
        saveCommunityTexts(texts).catch(e => console.error('Background purge save failed:', e.message));
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ texts, serverTime: Date.now() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to load texts' }));
    }
    return;
  }

  // POST: Add new community text
  if (req.method === 'POST') {
    try {
      let data;
      try {
        data = await parseBody(req);
      } catch (e) {
        if (e.message === 'BODY_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Request body too large (max 64KB)' }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      if (!data || !data.text || typeof data.text !== 'string' || !data.text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Text content is required' }));
        return;
      }

      const text = data.text.trim();

      if (text.length > MAX_TEXT_LENGTH) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: `Text too long (max ${MAX_TEXT_LENGTH} characters)` }));
        return;
      }

      const now = Date.now();
      const newItem = {
        id: 'comm_' + now.toString(36) + crypto.randomBytes(4).toString('hex'),
        text: text,
        createdAt: now,
        expiresAt: now + EXPIRATION_MS
      };

      const { texts: currentList } = await loadCommunityTexts();

      // Duplicate detection (within 10 seconds)
      const isDuplicate = currentList.some(item => item.text === newItem.text && (now - item.createdAt) < 10000);
      if (isDuplicate) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Duplicate text detected', duplicate: true, texts: currentList }));
        return;
      }

      currentList.unshift(newItem);

      // Enforce max texts limit
      if (currentList.length > MAX_TEXTS) {
        currentList.length = MAX_TEXTS;
      }

      const savedList = await saveCommunityTexts(currentList);
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, item: newItem, texts: savedList }));
    } catch (e) {
      console.error('POST error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // DELETE: Delete single text only (no bulk wipe)
  if (req.method === 'DELETE') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const deleteId = urlObj.searchParams.get('id');

      if (!deleteId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Item ID is required for deletion' }));
        return;
      }

      const { texts: currentList } = await loadCommunityTexts();
      const updatedList = currentList.filter(item => item.id !== deleteId);

      if (updatedList.length === currentList.length) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Text not found' }));
        return;
      }

      await saveCommunityTexts(updatedList);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, texts: updatedList }));
    } catch (err) {
      console.error('DELETE error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};
