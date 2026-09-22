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
let getBlob = null;
let listBlob = null;
let delBlob = null;
try {
  const blobModule = require('@vercel/blob');
  putBlob = blobModule.put;
  getBlob = blobModule.get;
  listBlob = blobModule.list;
  delBlob = blobModule.del;
} catch (e) {}

const BLOB_FILENAME = 'community_texts.json';
const FEED_PREFIX = 'feed/data_';
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BODY_SIZE = 64 * 1024; // 64KB max request body
const MAX_TEXT_LENGTH = 10000; // 10,000 chars max per text
const MAX_TEXTS = 200; // Max texts in community board

let memoryFallback = [];

function purgeExpired(list) {
  const now = Date.now();
  return (list || []).filter(item => {
    const expires = item.expiresAt || (item.createdAt + EXPIRATION_MS);
    return expires > now;
  });
}

async function streamToString(readableStream) {
  const reader = readableStream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadCommunityTexts() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // 1. Try loading latest versioned immutable feed file (100% immune to CDN caching)
    if (listBlob) {
      try {
        const { blobs } = await listBlob({ prefix: FEED_PREFIX, limit: 6 });
        if (blobs && blobs.length > 0) {
          blobs.sort((a, b) => b.pathname.localeCompare(a.pathname));
          const latest = blobs[0];
          const res = await fetch(latest.url, { cache: 'no-store' });
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) {
              const valid = purgeExpired(list);
              memoryFallback = valid;
              return { texts: valid, hadExpired: valid.length < list.length };
            }
          }
        }
      } catch (e) {
        console.warn('Versioned feed load error:', e.message);
      }
    }

    // 2. Fallback to direct getBlob if no versioned files yet
    if (getBlob) {
      try {
        const res = await getBlob(BLOB_FILENAME, {
          access: 'public',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });
        if (res && res.statusCode === 200 && res.stream) {
          const contentStr = await streamToString(res.stream);
          const remoteList = JSON.parse(contentStr || '[]');
          if (Array.isArray(remoteList)) {
            const valid = purgeExpired(remoteList);
            memoryFallback = valid;
            return { texts: valid, hadExpired: valid.length < remoteList.length };
          }
        }
      } catch (e) {
        console.warn('Fallback getBlob error:', e.message);
      }
    }
  }

  const valid = purgeExpired(memoryFallback);
  return { texts: valid, hadExpired: false };
}

async function saveCommunityTexts(newList) {
  const valid = purgeExpired(newList);
  memoryFallback = valid;

  if (putBlob && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      // Write new unique version file (guaranteed zero CDN cache lag, millisecond precision)
      const paddedTime = String(Date.now()).padStart(16, '0');
      const versionFile = `${FEED_PREFIX}${paddedTime}_${crypto.randomBytes(3).toString('hex')}.json`;
      await putBlob(versionFile, JSON.stringify(valid), {
        access: 'public',
        addRandomSuffix: false
      });

      // Mirror to legacy community_texts.json in background
      putBlob(BLOB_FILENAME, JSON.stringify(valid), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0
      }).catch(() => {});

      // Prune old version files in background (keep latest 3)
      if (delBlob && listBlob) {
        listBlob({ prefix: FEED_PREFIX, limit: 15 }).then(({ blobs }) => {
          if (blobs && blobs.length > 3) {
            blobs.sort((a, b) => b.pathname.localeCompare(a.pathname));
            const stale = blobs.slice(3);
            delBlob(stale.map(b => b.url)).catch(() => {});
          }
        }).catch(() => {});
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

      // Duplicate detection (within 1.5 seconds to catch double-clicks)
      const isDuplicate = currentList.some(item => item.text === newItem.text && (now - item.createdAt) < 1500);
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
