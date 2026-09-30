/** Public trial gateway: original UI + an independent backend per browser. */
import http from 'node:http';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, readdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { VENDOR_PRESETS } from './llm-provider.js';
import { rememberAgentRun, hasLiveAgentRun } from './agent/gateway-lifecycle.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
// A fresh directory on every gateway start: never load the desktop user's data.
const trialRoot = resolve(tmpdir(), `knowsource-trial-${randomBytes(12).toString('hex')}`);
await mkdir(trialRoot, { recursive: true });
const sessions = new Map();
const maxSessions = 12, maxWorkers = 2, bodyLimit = 16 * 1024 * 1024;
const lifetime = 8 * 60 * 60 * 1000;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.json': 'application/json' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
// Cache effective credentials in gateway memory only; an empty edit means reuse,
// and must not erase the key needed when the idle child process is recreated.
function cacheModelConfig(entry, path, input) {
  const normalize = raw => {
    const c = { ...raw };
    if (c.provider === 'openai' || VENDOR_PRESETS[c.provider]) {
      c.vendor = c.provider;
      c.provider = 'openai-compatible';
    }
    if (c.provider === 'openai-compatible') c.vendor ||= 'openai';
    c.baseUrl = String(c.baseUrl || VENDOR_PRESETS[c.vendor]?.baseUrl || (c.provider === 'ollama' ? 'http://127.0.0.1:11434' : '')).trim().replace(/\/+$/, '').replace('localhost:11434', '127.0.0.1:11434');
    c.apiKey = String(c.apiKey || '').trim();
    if (/^[*•●]+$/.test(c.apiKey)) c.apiKey = '';
    return c;
  };
  const config = normalize(input);
  const current = entry.modelConfigs.get(path), llm = path === '/settings/kg' ? entry.modelConfigs.get('/settings/llm') : null;
  const candidates = config.reuseLLMKey ? [llm, current] : [current, llm];
  if (!config.apiKey) {
    const previous = candidates.filter(Boolean).map(normalize).find(c => c.apiKey && c.provider === config.provider && (c.vendor || '') === (config.vendor || '') && c.baseUrl === config.baseUrl);
    if (previous) config.apiKey = previous.apiKey;
  }
  delete config.reuseLLMKey;
  delete config.hasApiKey;
  entry.modelConfigs.delete(path);
  entry.modelConfigs.set(path, config);
}
function sessionFor(req) {
  const id = /(?:^|;\s*)ks_trial=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const entry = sessions.get(id);
  return entry && Date.now() < entry.expires ? entry : null;
}
function createSession(res) {
  if (sessions.size >= maxSessions) return null;
  const id = randomBytes(32).toString('hex');
  // Model credentials live only in this browser session's gateway memory.
  const entry = { id, token: randomBytes(32).toString('hex'), expires: Date.now() + lifetime, worker: null, starting: null, active: 0, lastUsed: Date.now(), port: null, modelConfigs: new Map(), agentRuns: new Map() };
  sessions.set(id, entry);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ks_trial=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime / 1000}${secure}`);
  return entry;
}
async function directoryBytes(folder) {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
  let size = 0;
  for (const item of entries) {
    if (item.isDirectory()) size += await directoryBytes(resolve(folder, item.name));
    else if (item.isFile()) size += (await stat(resolve(folder, item.name))).size;
  }
  return size;
}
async function restoreModelConfigs(entry, port) {
  // Replay in save order: both settings routes also update the embedding model.
  for (const [path, config] of entry.modelConfigs) {
    const body = Buffer.from(JSON.stringify(config));
    await new Promise((resolveRestored, reject) => {
      const request = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-knowledge-ide-token': entry.token } }, response => {
        const parts = []; let bytes = 0;
        response.on('data', part => {
          bytes += part.length;
          if (bytes > 64 * 1024) request.destroy(new Error('模型配置恢复响应异常'));
          else parts.push(part);
        });
        response.once('error', reject);
        response.once('end', () => {
          try {
            if (response.statusCode !== 200 || JSON.parse(Buffer.concat(parts).toString('utf8')).success !== true) throw new Error('模型配置恢复失败，请重新保存模型设置。');
            resolveRestored();
          } catch { reject(new Error('模型配置恢复失败，请重新保存模型设置。')); }
        });
      });
      const timeout = setTimeout(() => request.destroy(new Error('模型配置恢复超时')), 10000);
      request.once('close', () => clearTimeout(timeout));
      request.once('error', reject);
      request.end(body);
    });
  }
}
async function startWorker(entry) {
  if (entry.starting) return entry.starting;
  if (entry.worker && entry.port) return;
  const running = [...sessions.values()].filter(s => s.worker || s.starting);
  if (running.length >= maxWorkers) {
    throw new Error('试验服务器同时最多服务两个浏览器，请稍后再试。');
  }
  entry.starting = new Promise((resolveReady, reject) => {
    // No inherited API keys or desktop paths in the child environment.
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'production', PORT: '0', KNOWLEDGE_IDE_HOSTED_TRIAL: '1', KNOWLEDGE_IDE_API_TOKEN: entry.token, KNOWLEDGE_IDE_DATA_DIR: resolve(trialRoot, entry.id), KNOWLEDGE_IDE_TRAINEDDATA_DIR: resolve(root, 'runtime-assets/ocr') };
    const child = fork(resolve(root, 'services/server.js'), [], { cwd: root, env, execArgv: ['--max-old-space-size=160'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    entry.worker = child;
    const timer = setTimeout(() => { child.kill(); reject(new Error('独立研究空间启动超时，请稍后重试。')); }, 30000);
    child.once('message', async msg => {
      if (msg?.type !== 'ready' || !Number.isInteger(msg.port)) return;
      try {
        await restoreModelConfigs(entry, msg.port);
        if (entry.worker !== child || child.killed) throw new Error('研究空间已停止，请重试。');
        clearTimeout(timer); entry.port = msg.port; resolveReady();
      } catch (err) { clearTimeout(timer); child.kill(); reject(err); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('研究空间启动失败。')); });
    child.once('exit', () => { clearTimeout(timer); entry.worker = null; entry.port = null; entry.agentRuns.clear(); reject(new Error('试验服务器资源不足，研究空间已停止。')); });
  }).finally(() => { entry.starting = null; });
  return entry.starting;
}
async function proxy(req, res, url, entry) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '请从知源网站内发起请求。' });
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { return json(res, 403, { error: '无效来源' }); }
    if (origin.host !== req.headers.host) return json(res, 403, { error: '请求来源不匹配' });
  }
  const parts = []; let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > bodyLimit) return json(res, 413, { error: '免费试验版每次请求最多 16 MB（原文件建议不超过 10 MB）。' });
    parts.push(part);
  }
  if (!['GET', 'HEAD'].includes(req.method) && !url.pathname.endsWith('/delete') && req.method !== 'DELETE' && await directoryBytes(trialRoot) > 128 * 1024 * 1024) return json(res, 507, { error: '免费试验存储已满，请导出备份后删除不需要的资料。' });
  const body = Buffer.concat(parts);
  const settingsPath = req.method === 'POST' && ['/api/settings/llm', '/api/settings/kg'].includes(url.pathname) ? url.pathname.slice(4) : null;
  let savedConfig;
  if (settingsPath) {
    if (bytes > 64 * 1024) return json(res, 413, { error: '模型配置不能超过 64 KB。' });
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) savedConfig = parsed;
    } catch { /* The backend retains its normal invalid-JSON response. */ }
  }
  await startWorker(entry);
  entry.lastUsed = Date.now(); entry.active++;
  const upstream = http.request({ host: '127.0.0.1', port: entry.port, method: req.method, path: url.pathname.slice(4) + url.search, headers: { 'content-type': req.headers['content-type'] || 'application/json', 'content-length': bytes, 'x-knowledge-ide-token': entry.token } }, response => {
    if (response.statusCode === 200 && ['/api/agent/run', '/api/agent/status', '/api/agent/confirm', '/api/agent/cancel'].includes(url.pathname)) {
      const parts = []; let size = 0;
      response.on('data', part => {
        size += part.length;
        if (size <= 1024 * 1024) parts.push(part);
        else parts.length = 0;
      });
      response.once('end', () => {
        if (size > 1024 * 1024) return;
        try { rememberAgentRun(entry, JSON.parse(Buffer.concat(parts).toString('utf8'))); }
        catch { /* A malformed response never authorizes or changes an action. */ }
      });
    }
    if (settingsPath && savedConfig && response.statusCode === 200) {
      const result = []; let resultBytes = 0;
      response.on('data', part => { resultBytes += part.length; if (resultBytes <= 64 * 1024) result.push(part); });
      response.once('end', () => {
        if (resultBytes > 64 * 1024) return;
        try {
          if (JSON.parse(Buffer.concat(result).toString('utf8')).success === true) {
            cacheModelConfig(entry, settingsPath, savedConfig);
          }
        } catch { /* Failed or malformed saves never replace a working config. */ }
      });
    }
    const headers = { ...response.headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    delete headers['set-cookie']; delete headers['access-control-allow-origin'];
    res.writeHead(response.statusCode || 502, headers);
    response.pipe(res);
  });
  let finished = false;
  const finish = () => { if (!finished) { finished = true; entry.active--; entry.lastUsed = Date.now(); } };
  res.once('close', () => { upstream.destroy(); finish(); });
  res.once('finish', finish);
  upstream.setTimeout(11 * 60 * 1000, () => upstream.destroy(new Error('任务运行超时')));
  upstream.on('error', () => {
    finish();
    if (!res.headersSent) json(res, 502, { error: '后端任务中断或超时，请重试；大文件可能超出免费实例内存。' });
    else res.destroy();
  });
  upstream.end(body);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/healthz') return json(res, 200, { status: 'ok', mode: 'original-ui-isolated-trial' });
    let entry = sessionFor(req);
    if (url.pathname.startsWith('/api/')) {
      if (!entry) return json(res, 401, { error: '试验空间已过期或服务已重启，请刷新页面创建新空间。' });
      return await proxy(req, res, url, entry);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
    if (pathname.includes('\\') || pathname.includes('\0')) return json(res, 400, { error: 'Invalid path' });
    let file = resolve(dist, '.' + pathname);
    if (file !== dist && !file.startsWith(dist + sep)) return json(res, 403, { error: 'Forbidden' });
    if (pathname === '/') file = resolve(dist, 'index.html');
    let info;
    try { info = await stat(file); } catch { return json(res, 404, { error: 'Not found' }); }
    if (!info.isFile()) return json(res, 404, { error: 'Not found' });
    if (file === resolve(dist, 'index.html') && !entry) {
      entry = createSession(res);
      if (!entry) return json(res, 503, { error: '免费试验名额暂满，请稍后再试。' });
    }
    let content = await readFile(file);
    if (file === resolve(dist, 'index.html')) content = Buffer.from(content.toString('utf8').replace('<head>', '<head><script>window.__KS_HOSTED_TRIAL__=true;</script>'));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (err) {
    if (!res.headersSent) json(res, 503, { error: err.message || '服务暂不可用' });
    else res.destroy();
  }
});
server.requestTimeout = 12 * 60 * 1000;
server.headersTimeout = 30000;
server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log(`[web] KnowSource original UI listening on ${server.address().port}`));
setInterval(() => {
  for (const [id, entry] of sessions) {
    if (!entry.active && entry.worker && Date.now() - entry.lastUsed > 5 * 60 * 1000 && !hasLiveAgentRun(entry)) entry.worker.kill('SIGTERM');
    if (Date.now() >= entry.expires && !entry.active) { entry.worker?.kill('SIGTERM'); sessions.delete(id); }
  }
}, 30000).unref();
function shutdown() { server.close(); for (const entry of sessions.values()) entry.worker?.kill('SIGTERM'); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
