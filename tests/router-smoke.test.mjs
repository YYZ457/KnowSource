import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

const API_TOKEN = 'knowsource-smoke-test-token';
let server;
let baseUrl;

function request(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

before(async () => {
  process.env.KNOWLEDGE_IDE_API_TOKEN = API_TOKEN;
  process.env.KNOWLEDGE_IDE_NO_PERSIST = '1';

  // router 在模块加载时读取环境变量，必须先设置再动态导入。
  const { handleHttpRequest } = await import('../services/api/router.js');
  server = http.createServer((req, res) => {
    handleHttpRequest(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: error.message }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  delete process.env.KNOWLEDGE_IDE_API_TOKEN;
  delete process.env.KNOWLEDGE_IDE_NO_PERSIST;
});

test('GET /health accepts the configured API token', async () => {
  const response = await request('/health', {
    headers: { 'X-Knowledge-IDE-Token': API_TOKEN }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).ok, true);
});

test('GET /health rejects a missing API token', async () => {
  const response = await request('/health');

  assert.equal(response.statusCode, 403);
});

test('Origin:null preflight is allowed for the token-protected Electron API', async () => {
  const response = await request('/health', {
    method: 'OPTIONS',
    headers: {
      Origin: 'null',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'X-Knowledge-IDE-Token'
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'null');
});
