// Vercel Serverless Function: /api/texts
const fs = require('fs');
const path = require('path');

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
try {
  const blobModule = require('@vercel/blob');
  putBlob = blobModule.put;
} catch (e) {}

const BLOB_FILENAME = 'community_texts.json';
const EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

let memoryTexts = [];
let lastFetchTime = 0;
let blobUrl = null;

function purgeExpired(list) {
  const now = Date.now();
  return (list || []).filter(item => {
    const expires = item.expiresAt || (item.createdAt + EXPIRATION_MS);
    return expires > now;
  });
}

async function loadCommunityTexts() {
  const now = Date.now();
  // Fetch fresh from Blob if token is available
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      let targetUrl = blobUrl;
      if (!targetUrl && process.env.BLOB_STORE_ID) {
        const cleanId = process.env.BLOB_STORE_ID.replace('store_', '').toLowerCase();
        targetUrl = `https://${cleanId}.public.blob.vercel-storage.com/${BLOB_FILENAME}`;
      }

      if (targetUrl) {
        const res = await fetch(`${targetUrl}?_cb=${now}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store' }
        });
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
      console.warn('Blob fetch error:', e.message);
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
      // Must use allowOverwrite: true to update existing community blob
      const blob = await putBlob(BLOB_FILENAME, JSON.stringify(valid), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      blobUrl = blob.url;
    } catch (e) {
      console.error('Failed to sync to Vercel Blob:', e.message);
    }
  }

  return valid;
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
      const texts = await loadCommunityTexts();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ texts, serverTime: Date.now() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST: Add new community text
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

  // DELETE: Delete single or all
  if (req.method === 'DELETE') {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const deleteId = urlObj.searchParams.get('id');

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

  res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};
