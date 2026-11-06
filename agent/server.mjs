#!/usr/bin/env node
/**
 * 超星学习通 Agent —— 本地中枢
 *
 *  页面 --POST /hb-->   落盘状态（latest.json / heartbeat.log）
 *  Agent --POST /cmd--> 入队指令
 *  页面 --GET /poll-->   取走并清空指令队列
 *
 * 监听 127.0.0.1:8731（仅本机）。零依赖，Node 18+。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askLLM, llmReady } from './ai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.XXT_DATA || path.join(__dirname, '..', 'data');
const PORT = Number(process.env.XXT_PORT || 8731);
const MAX_LOG_LINES = 4000;
const MAX_QUEUE = 20;

const LATEST = path.join(DATA_DIR, 'latest.json');
const LOG = path.join(DATA_DIR, 'heartbeat.log');
const CMDLOG = path.join(DATA_DIR, 'commands.log');

fs.mkdirSync(DATA_DIR, { recursive: true });

const queue = [];

function nowIso() {
  return new Date().toISOString();
}

function trimLog(file, maxLines) {
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) return;
    const lines = data.split('\n');
    if (lines.length > maxLines) {
      fs.writeFile(file, lines.slice(-maxLines).join('\n'), () => {});
    }
  });
}

function saveHeartbeat(obj) {
  obj.received = nowIso();
  try { fs.writeFileSync(LATEST, JSON.stringify(obj, null, 2)); } catch (e) {}
  fs.appendFile(LOG, JSON.stringify(obj) + '\n', () => trimLog(LOG, MAX_LOG_LINES));
}

function pushCommand(cmd) {
  const item = Object.assign({ id: Math.random().toString(36).slice(2, 8), at: nowIso() }, cmd);
  queue.push(item);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  fs.appendFile(CMDLOG, JSON.stringify(item) + '\n', () => {});
  return item;
}

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === '/hb') {
    const raw = url.searchParams.get('d') || (req.method === 'POST' ? await readBody(req) : '');
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj) { res.writeHead(400); res.end('bad json'); return; }
    saveHeartbeat(obj);
    res.writeHead(200); res.end('ok');
    return;
  }

  if (p === '/poll') {
    const cmds = queue.splice(0, queue.length);
    json(res, 200, { cmds });
    return;
  }

  if (p === '/cmd') {
    const raw = url.searchParams.get('d') || (req.method === 'POST' ? await readBody(req) : '');
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    if (!obj || !obj.cmd) { res.writeHead(400); res.end('need {"cmd":"..."}'); return; }
    json(res, 200, { ok: true, queued: pushCommand(obj) });
    return;
  }

  if (p === '/queue') {
    json(res, 200, { cmds: queue });
    return;
  }

  if (p === '/status') {
    let data = '{}';
    try { data = fs.readFileSync(LATEST, 'utf8'); } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(data);
    return;
  }

  if (p === '/ask') {
    let obj = null;
    try { obj = JSON.parse(url.searchParams.get('d') || (req.method === 'POST' ? await readBody(req) : '{}')); } catch (e) { obj = null; }
    if (!obj || !obj.question) { json(res, 400, { ok: false, error: 'need {"question":"..."}' }); return; }
    const result = await askLLM(obj);
    fs.appendFile(CMDLOG, JSON.stringify({ at: nowIso(), kind: 'ask', q: String(obj.question).slice(0, 120), result }) + '\n', () => {});
    json(res, 200, result);
    return;
  }

  if (p === '/ai-status') {
    json(res, 200, { ready: llmReady() });
    return;
  }

  if (p === '/health') {
    json(res, 200, { ok: true, port: PORT, dataDir: DATA_DIR, queue: queue.length, ts: nowIso() });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[xxt-agent] listening http://127.0.0.1:${PORT}  data=${DATA_DIR}`);
});
