// Temp-Transfer - Local Development Server
const http = require('http');
const fs = require('fs');
const path = require('path');
const apiTextsHandler = require('./api/texts.js');

const PUBLIC_DIR = path.join(__dirname, 'public');

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

function handler(req, res) {
  if (req.url && req.url.includes('debug=1')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
    return;
  }

  const originalUrl = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url || '/';
  const urlObj = new URL(originalUrl, 'http://localhost');
  const reqUrl = urlObj.pathname;

  // Delegate API to api/texts.js
  if (reqUrl.startsWith('/api') || (req.url && req.url.startsWith('/api')) || originalUrl.includes('/api/texts')) {
    return apiTextsHandler(req, res);
  }

  let filePathName = reqUrl;
  if (filePathName === '/' || filePathName === '') {
    filePathName = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, filePathName);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
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

module.exports = handler;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  http.createServer(handler).listen(PORT, () => {
    console.log(`Temp-Transfer running at http://localhost:${PORT}`);
  });
}
