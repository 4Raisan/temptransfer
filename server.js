// Temp-Transfer - Community Synchronized Serverless & Local Handler
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env.local for local development if present
if (fs.existsSync(path.join(__dirname, '.env.local'))) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
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
  } catch (e) {
    console.error('Error reading .env.local:', e);
  }
}

// Vercel Blob SDK
let putBlob = null;
try {
  const blobModule = require('@vercel/blob');
  putBlob = blobModule.put;
} catch (e) {
  console.warn('@vercel/blob not installed, fallback to memory storage');
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const BLOB_FILENAME = 'community_texts.json';
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

// In-memory cache for ultra-fast response & fallback
let memoryTexts = [];
let lastFetchTime = 0;
let blobUrl = null;

function purgeExpired(list) {
  const now = Date.now();
  return list.filter(item => {
    const expires = item.expiresAt || (item.createdAt + EXPIRATION_MS);
    return expires > now;
  });
}

async function loadCommunityTexts() {
  const now = Date.now();
  // Use memory cache if updated within the last 2 seconds
  if (now - lastFetchTime < 2000 && memoryTexts.length > 0) {
    return memoryTexts;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      // Find blob URL or construct from store ID
      let targetUrl = blobUrl;
      if (!targetUrl && process.env.BLOB_STORE_ID) {
        const cleanId = process.env.BLOB_STORE_ID.replace('store_', '').toLowerCase();
        targetUrl = `https://${cleanId}.public.blob.vercel-storage.com/${BLOB_FILENAME}?t=${now}`;
      }

      if (targetUrl) {
        const res = await fetch(targetUrl, { cache: 'no-store' });
        if (res.ok) {
          const remoteList = await res.json();
          if (Array.isArray(remoteList)) {
            const valid = purgeExpired(remoteList);
            memoryTexts = valid;
            lastFetchTime = now;
            return valid;
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch from remote Blob, using memory cache:', e.message);
    }
  }

  memoryTexts = purgeExpired(memoryTexts);
  lastFetchTime = now;
  return memoryTexts;
}

async function saveCommunityTexts(newList) {
  const valid = purgeExpired(newList);
  memoryTexts = valid;
  lastFetchTime = Date.now();

  if (putBlob && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await putBlob(BLOB_FILENAME, JSON.stringify(valid), {
        access: 'public',
        addRandomSuffix: false
      });
      blobUrl = blob.url;
    } catch (e) {
      console.error('Failed to sync to Vercel Blob:', e.message);
    }
  }

  return valid;
}

async function handler(req, res) {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const originalUrl = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url || '/';
  const urlObj = new URL(originalUrl, 'http://localhost');
  const reqUrl = urlObj.pathname;

  // --- API Endpoints ---
  if (reqUrl === '/api/texts') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'GET') {
      try {
        const texts = await loadCommunityTexts();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ texts, serverTime: Date.now() }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data || !data.text || typeof data.text !== 'string' || !data.text.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Text content is required' }));
            return;
          }

          const now = Date.now();
          const newItem = {
            id: 'comm_' + now.toString(36) + Math.random().toString(36).substr(2, 6),
            text: data.text.trim(),
            createdAt: now,
            expiresAt: now + EXPIRATION_MS
          };

          const currentList = await loadCommunityTexts();
          // Filter out duplicates if same text submitted within 5 seconds
          const isDuplicate = currentList.some(item => item.text === newItem.text && (now - item.createdAt) < 5000);
          if (!isDuplicate) {
            currentList.unshift(newItem);
          }

          const savedList = await saveCommunityTexts(currentList);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, item: newItem, texts: savedList }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const deleteId = urlObj.searchParams.get('id');
      try {
        const currentList = await loadCommunityTexts();
        let updatedList = [];
        if (deleteId) {
          updatedList = currentList.filter(item => item.id !== deleteId);
        } else {
          updatedList = [];
        }
        await saveCommunityTexts(updatedList);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, texts: updatedList }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
  }

  // --- Static File Serving ---
  let filePathName = reqUrl;
  if (filePathName === '/' || filePathName === '') {
    filePathName = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, filePathName);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
}

// Export for Vercel Serverless Function
module.exports = handler;

// Standalone runner
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`Temp-Transfer running at http://localhost:${PORT}`);
  });
}
