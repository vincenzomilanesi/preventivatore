/**
 * Server di sviluppo: serve public/ e monta la Pages Function VERA (functions/api/gas.js) su /api/gas.
 * Il "GAS_URL" punta a un secondo server locale che esegue i .gs nel simulatore e, come Apps Script,
 * risponde al POST con un redirect 302 verso un URL di "echo" (così si collauda anche il follow del proxy).
 *
 * Uso: node dev/server.mjs [porta]   → http://localhost:8787 ; utente di prova mario.rossi@test.invalid
 * GET /__dev/otp?email=…  restituisce l'ultimo OTP "inviato" (solo sviluppo).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGas, seedSheets } from './gas-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8787);
const GAS_PORT = PORT + 1;
const SECRET = 'dev-secret';
const gas = createGas({ root: ROOT, props: { PROXY_SECRET: SECRET, ALLOWED_DOMAINS: 'test.invalid' }, sheets: seedSheets() });
const { onRequestPost } = await import(pathToFileURL(path.join(ROOT, 'functions/api/gas.js')).href);

// --- finto Apps Script con redirect 302
const echo = new Map();
http.createServer((req, res) => {
  if (req.method === 'POST') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const out = gas.ctx.doPost({ postData: { contents: b } }).getContent();
      const id = Math.random().toString(36).slice(2);
      echo.set(id, out);
      res.writeHead(302, { location: `http://localhost:${GAS_PORT}/echo?id=${id}` }).end();
    });
  } else {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    res.writeHead(200, { 'content-type': 'application/json' }).end(echo.get(id) || '{}');
    echo.delete(id);
  }
}).listen(GAS_PORT);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/gas') {
    if (req.method !== 'POST') return res.writeHead(405).end();
    let b = '';
    for await (const c of req) b += c;
    const r = await onRequestPost({
      request: new Request(url, { method: 'POST', headers: req.headers, body: b }),
      env: { GAS_URL: `http://localhost:${GAS_PORT}/exec`, PROXY_SECRET: SECRET },
    });
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
    return;
  }
  if (url.pathname === '/__dev/otp') {
    return res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ otp: gas.lastOtp(url.searchParams.get('email')) }));
  }
  const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.writeHead(404).end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    .end(fs.readFileSync(file));
}).listen(PORT, () => console.log(`dev server http://localhost:${PORT} (GAS simulato su ${GAS_PORT})`));
