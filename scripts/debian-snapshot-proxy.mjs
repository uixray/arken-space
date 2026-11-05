// Build-only adapter: retain signed immutable snapshot indexes while fetching
// identical pool objects from Debian mirrors, with bounded fallback.
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
const prefix = '/archive/debian/20260518T000000Z/';
const snapshots = ['snapshot-fastly.debian.org', 'snapshot.debian.org', 'snapshot-cloudflare.debian.org'];
const maxBytes = 100 * 1024 * 1024;

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 12000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 4) {
        const next = new URL(res.headers.location, url);
        res.resume();
        if (next.protocol !== 'https:' || next.username || next.password) return reject(new Error('unsafe redirect'));
        return resolve(fetch(next, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const parts = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('response too large')); else parts.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  if (req.method !== 'GET' || !req.url.startsWith(prefix) || req.url.includes('..')) { res.writeHead(400).end(); return; }
  const suffix = req.url.slice(prefix.length);
  const sources = suffix.startsWith('pool/') ? [`https://deb.debian.org/debian/${suffix}`] : [];
  sources.push(...snapshots.map(host => `https://${host}${prefix}${suffix}`));
  for (const url of sources) {
    try { const body = await fetch(url); res.writeHead(200, { 'Content-Length': body.length }); res.end(body); return; }
    catch (err) { console.error(`snapshot fetch failed ${url}: ${err.message}`); }
  }
  res.writeHead(502).end('All Debian sources failed');
}).listen(18765, '127.0.0.1');
