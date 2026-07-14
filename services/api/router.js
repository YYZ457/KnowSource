/** @module services/api/router
 *  职责：API 路由网关，支持 HTTP 与 IPC 双通道
 */
import { parseHandler, getDocuments, deleteDocument, serveDocumentPdf, serveDocumentDocxHtml, pauseParse, resumeParse, cancelParse } from './handlers/parse.js';
import { importSampleDoc } from './handlers/sample-doc.js';
import { reorderDocuments } from './handlers/documents.js';
import { extractHandler, modelTestHandler } from './handlers/extract.js';
import { graphBuildHandler, rebuildCrossLinksHandler, clearGraphHandler } from './handlers/graph-build.js';
import { graphQueryHandler } from './handlers/graph-query.js';
import { createNode, updateNode, deleteNode, createEdge, updateEdge, deleteEdge } from './handlers/graph-node.js';
import { clearAll, getClearToken } from './handlers/clear.js';
import { matchHandler } from './handlers/match.js';
import { searchHandler } from './handlers/search.js';
import { listIdeas, createIdea, updateIdea, deleteIdea, recommendIdeaNodes, linkIdeaToNode, unlinkIdeaFromNode } from './handlers/idea.js';
import { setLLMProviderHandler, getLLMProviderHandler, testLLMProviderHandler, setKGProviderHandler, getKGProviderHandler, ollamaStatusHandler } from './handlers/settings.js';
import { getPromptsHandler, setPromptHandler, resetPromptHandler, setDisabledHandler, getLLMLogHandler, testPromptHandler, initPromptStore } from './handlers/prompts.js';
import { listProjectsHandler, createProjectHandler, renameProjectHandler, updateProjectHandler, deleteProjectHandler, switchProjectHandler, exportProjectHandler, importProjectHandler } from './handlers/projects.js';
import { storage } from '../storage.js';

// CORS 允许的开发服务器端口白名单
// - 5173: Vite 开发服务器默认端口
// - 4173: Vite 预览（preview）端口
// - 3000: 常见前端开发端口（React/Vue CLI 等）
// - 8080: 常见开发端口
const ALLOWED_DEV_PORTS = new Set(['5173', '5174', '4173', '3000', '8080']);

// 重操作接口速率限制：每 60 秒内每个 IP 最多 N 次
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMITED_PATHS = new Set(['/parse', '/graph/build', '/graph/crosslinks/rebuild', '/match', '/search', '/extract']);
const rateLimitMap = new Map();

// Electron 环境下由主进程注入的本地 API 认证令牌，防止任意本地进程访问后端
const API_TOKEN = process.env.KNOWLEDGE_IDE_API_TOKEN || null;

/**
 * 校验本地 API Token
 * - 非 Electron 环境（API_TOKEN 未设置）直接放行
 * - 优先读取请求头 X-Knowledge-IDE-Token
 * - GET /documents/:id/pdf 等浏览器直接加载的资源，允许通过 query token 携带
 */
function checkApiToken(req, parsedUrl) {
  if (!API_TOKEN) return true;
  const headerToken = req.headers['x-knowledge-ide-token'];
  if (headerToken === API_TOKEN) return true;
  // iframe / webview 无法携带自定义请求头，允许通过 URL query 携带 token
  if (parsedUrl) {
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken === API_TOKEN) return true;
  }
  return false;
}

function checkRateLimit(clientIp, path) {
  if (!RATE_LIMITED_PATHS.has(path)) return { allowed: true };
  const now = Date.now();
  const key = `${clientIp}:${path}`;
  const record = rateLimitMap.get(key);
  if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

function cleanupRateLimit() {
  const now = Date.now();
  for (const [key, record] of rateLimitMap) {
    if (now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key);
    }
  }
}
// 每分钟清理一次过期记录
// 使用 unref() 避免此定时器阻止 Node 进程正常退出（在 server.js 优雅关闭时）
const rateLimitCleanupTimer = setInterval(cleanupRateLimit, RATE_LIMIT_WINDOW_MS);
rateLimitCleanupTimer.unref();

/**
 * 检查端口是否在开发服务器白名单中
 * @param {string} port - URL 中的端口号
 * @returns {boolean}
 */
function isAllowedDevPort(port) {
  // 端口为空时（如 http://localhost 不带端口，默认 80）不允许，
  // 因为开发服务器通常都带显式端口
  if (!port) return false;
  return ALLOWED_DEV_PORTS.has(port);
}

// 路由表
const routes = [
  { method: 'GET', path: '/health', handler: () => ({ ok: true, service: 'knowsource', time: Date.now() }) },
  { method: 'POST', path: '/parse', handler: parseHandler },
  { method: 'POST', path: '/parse/pause', handler: pauseParse },
  { method: 'POST', path: '/parse/resume', handler: resumeParse },
  { method: 'POST', path: '/parse/cancel', handler: cancelParse },
  { method: 'GET', path: '/documents', handler: getDocuments },
  { method: 'POST', path: '/documents/delete', handler: deleteDocument },
  { method: 'POST', path: '/documents/import-sample', handler: importSampleDoc },
  { method: 'POST', path: '/documents/reorder', handler: reorderDocuments },
  { method: 'POST', path: '/extract', handler: extractHandler },
  { method: 'POST', path: '/extract/model-test', handler: modelTestHandler },
  { method: 'POST', path: '/graph/build', handler: graphBuildHandler },
  { method: 'POST', path: '/graph/clear', handler: clearGraphHandler },
  { method: 'POST', path: '/graph/crosslinks/rebuild', handler: rebuildCrossLinksHandler },
  { method: 'GET', path: '/graph/query', handler: graphQueryHandler },
  { method: 'POST', path: '/graph/nodes', handler: createNode },
  { method: 'POST', path: '/graph/nodes/update', handler: updateNode },
  { method: 'POST', path: '/graph/nodes/delete', handler: deleteNode },
  { method: 'POST', path: '/graph/edges', handler: createEdge },
  { method: 'POST', path: '/graph/edges/update', handler: updateEdge },
  { method: 'POST', path: '/graph/edges/delete', handler: deleteEdge },
  { method: 'POST', path: '/clear', handler: clearAll },
  { method: 'GET', path: '/clear-token', handler: () => ({ token: getClearToken() }) },
  { method: 'GET', path: '/progress', handler: () => ({ ...storage.taskProgress }) },
  { method: 'POST', path: '/match', handler: matchHandler },
  { method: 'POST', path: '/search', handler: searchHandler },
  { method: 'POST', path: '/settings/llm', handler: setLLMProviderHandler },
  { method: 'GET', path: '/settings/llm', handler: getLLMProviderHandler },
  { method: 'POST', path: '/settings/llm/test', handler: testLLMProviderHandler },
  { method: 'POST', path: '/settings/kg', handler: setKGProviderHandler },
  { method: 'GET', path: '/settings/kg', handler: getKGProviderHandler },
  { method: 'POST', path: '/settings/ollama-status', handler: ollamaStatusHandler },
  // 提示词自定义与 LLM 调用日志
  { method: 'GET', path: '/settings/prompts', handler: getPromptsHandler },
  { method: 'POST', path: '/settings/prompts', handler: setPromptHandler },
  { method: 'POST', path: '/settings/prompts/reset', handler: resetPromptHandler },
  { method: 'POST', path: '/settings/prompts/disabled', handler: setDisabledHandler },
  { method: 'GET', path: '/settings/llm-log', handler: getLLMLogHandler },
  { method: 'POST', path: '/settings/prompts/test', handler: testPromptHandler },
  { method: 'GET', path: '/ideas', handler: listIdeas },
  { method: 'POST', path: '/ideas', handler: createIdea },
  { method: 'POST', path: '/ideas/update', handler: updateIdea },
  { method: 'POST', path: '/ideas/delete', handler: deleteIdea },
  { method: 'POST', path: '/ideas/recommend', handler: recommendIdeaNodes },
  { method: 'POST', path: '/ideas/link', handler: linkIdeaToNode },
  { method: 'POST', path: '/ideas/unlink', handler: unlinkIdeaFromNode },
  // 项目（多文件夹）管理 — REST 风格路由
  { method: 'GET', path: '/projects', handler: listProjectsHandler },
  { method: 'POST', path: '/projects', handler: createProjectHandler },
  { method: 'POST', path: '/projects/switch', handler: switchProjectHandler },
  { method: 'POST', path: '/projects/import', handler: importProjectHandler },
  // 带路径参数的路由（pattern 匹配）
  { method: 'PUT', pattern: /^\/projects\/([^/]+)$/, handler: updateProjectHandler },
  { method: 'DELETE', pattern: /^\/projects\/([^/]+)$/, handler: deleteProjectHandler },
  { method: 'GET', pattern: /^\/projects\/([^/]+)\/export$/, handler: exportProjectHandler }
];

/**
 * HTTP 请求处理器
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handleHttpRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Request' }));
    return;
  }
  const path = url.pathname;
  const method = req.method;

  // CORS：仅允许本地开发服务器（localhost 和 127.0.0.1）的指定端口，
  // 以及 Electron 的 file:// 协议，禁止其他来源（防止本地恶意 HTML 文件访问后端）
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const protocol = originUrl.protocol;
      const hostname = originUrl.hostname;
      const port = originUrl.port;

      // 浏览器会把 file:// 页面的 Origin 序列化为字符串 "null"；
      // 仅在 Electron 注入了 API Token 时放行，避免普通本地 HTML 访问开发后端。
      if (origin === 'null' && API_TOKEN) {
        res.setHeader('Access-Control-Allow-Origin', 'null');
      } else if ((hostname === 'localhost' || hostname === '127.0.0.1') && isAllowedDevPort(port)) {
        // 仅允许本地开发服务器白名单端口
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      // 其他来源不设置 CORS 头，浏览器将拒绝跨域请求
    } catch (e) {
      if (origin === 'null' && API_TOKEN) {
        res.setHeader('Access-Control-Allow-Origin', 'null');
      }
    }
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Knowledge-IDE-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Electron 生产环境：校验本地 API Token，阻止其他本地进程/网页访问后端
  if (!checkApiToken(req, url)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: invalid or missing API token' }));
    return;
  }

  // 先鉴权、再计数，避免未授权请求耗尽合法用户的本地速率额度。
  const clientIp = req.socket?.remoteAddress?.replace(/^::ffff:/, '') || 'unknown';
  const rateLimit = checkRateLimit(clientIp, path);
  if (!rateLimit.allowed) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(rateLimit.retryAfter)
    });
    res.end(JSON.stringify({ error: '操作过于频繁，请稍后重试', retryAfter: rateLimit.retryAfter }));
    return;
  }

  // PDF 原始文件流式返回（避免 Electron 中 blob URL 在 iframe 内渲染异常）
  // 同时支持 HEAD 预检请求（前端 checkPdfAccessible 用 HEAD 检查可达性）
  const pdfMatch = (method === 'GET' || method === 'HEAD') && path.match(/^\/documents\/([^/]+)\/pdf$/);
  if (pdfMatch) {
    // iframe / webview 无法携带自定义请求头，允许通过 URL query 携带 token 进行认证
    const queryToken = url.searchParams.get('token');
    if (API_TOKEN && queryToken !== API_TOKEN && req.headers['x-knowledge-ide-token'] !== API_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid or missing API token' }));
      return;
    }
    try {
      const { buffer, name } = serveDocumentPdf({ id: decodeURIComponent(pdfMatch[1]) });
      // HEAD 请求只返回头部，不返回 body
      if (method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': buffer.length
        });
        res.end();
        return;
      }
      // 对文件名做 RFC 5987 编码，避免中文、括号、引号等特殊字符导致 HTTP 头非法。
      // 安全加固：name 来源于用户上传时提供的文件名，先剥离 CR/LF 等控制字符及引号/反斜杠，
      // 否则可构造 "x\r\nSet-Cookie: ..." 之类的文件名实施 HTTP 响应拆分 / 头注入。
      const sanitized = name.replace(/[\x00-\x1F\x7F"\\]/g, '_');
      const asciiName = sanitized.replace(/[^\x00-\x7F]/g, '_');
      const encodedName = encodeURIComponent(sanitized).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': buffer.length,
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
      });
      res.end(buffer);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // DOCX HTML 渲染返回（供前端 webview 完整渲染 Word 格式）
  const docxHtmlMatch = method === 'GET' && path.match(/^\/documents\/([^/]+)\/html$/);
  if (docxHtmlMatch) {
    const queryToken = url.searchParams.get('token');
    if (API_TOKEN && queryToken !== API_TOKEN && req.headers['x-knowledge-ide-token'] !== API_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid or missing API token' }));
      return;
    }
    try {
      const { html, name } = await serveDocumentDocxHtml({ id: decodeURIComponent(docxHtmlMatch[1]) });
      const buffer = Buffer.from(html, 'utf-8');
      const sanitized = name.replace(/[\x00-\x1F\x7F"\\]/g, '_');
      const asciiName = sanitized.replace(/[^\x00-\x7F]/g, '_');
      const encodedName = encodeURIComponent(sanitized).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buffer.length,
        'Content-Disposition': `inline; filename="${asciiName}.html"; filename*=UTF-8''${encodedName}.html`
      });
      res.end(buffer);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 匹配路由（支持精确匹配和 pattern 匹配）
  let pathParams = null;
  const route = routes.find(r => {
    if (r.method !== method) return false;
    if (r.pattern) {
      const match = path.match(r.pattern);
      if (match) {
        // 安全解码 URL 参数，避免非法 percent-encoding 导致 URIError
        pathParams = match.slice(1).map(s => {
          try { return decodeURIComponent(s); }
          catch { return s; }
        });
        return true;
      }
      return false;
    }
    return r.path === path;
  });
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  // 解析请求体
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    try {
      const chunks = [];
      let totalSize = 0;
      // PDF 解析放宽到 200MB；项目导入可能包含多文档，单独放宽到 250MB。
      const maxBodySizeMb = path === '/projects/import' ? 250 : (path === '/parse' ? 200 : 10);
      const MAX_BODY_SIZE = maxBodySizeMb * 1024 * 1024;
      for await (const chunk of req) {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `请求数据过大，最大允许 ${maxBodySizeMb}MB` }));
          return;
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON: ' + e.message }));
        return;
      }
    } catch (streamErr) {
      // 客户端断开连接等流读取异常
      if (!res.headersSent) {
        res.writeHead(499, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Client disconnected' }));
      }
      return;
    }
  } else if (method === 'GET') {
    body = Object.fromEntries(url.searchParams);
  }

  // 合并路径参数到 body（用于 PUT /projects/:id 等）
  const params = pathParams ? { ...body, id: pathParams[0] } : body;

  try {
    const result = await route.handler(params);
    // 检测 handler 返回的业务错误：
    // - { success: false, error: '...' } → 400
    // - { error: '...' }（不含 success:true）→ 400
    // - { status: 403|409, error: '...' } → 使用指定状态码（如 clear 的令牌校验/任务冲突）
    if (result && typeof result === 'object' && result.error && result.success !== true) {
      const status = typeof result.status === 'number' ? result.status : 400;
      const body = { ...result };
      delete body.status;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
  } catch (e) {
    const errorInfo = { error: e.message };
    // 仅在显式开发环境返回 stack trace，避免生产环境信息泄漏
    if (process.env.NODE_ENV === 'development') {
      errorInfo.stack = e.stack;
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorInfo));
  }
}

/**
 * 注册 IPC 处理器（供 Electron 主进程调用）
 * @param {import('electron').IpcMain} ipcMain
 */
export function registerIpcHandlers(ipcMain) {
  const ipcRoutes = [
    { channel: 'api:parse', handler: parseHandler },
    { channel: 'api:parse:pause', handler: pauseParse },
    { channel: 'api:parse:resume', handler: resumeParse },
    { channel: 'api:parse:cancel', handler: cancelParse },
    { channel: 'api:documents', handler: getDocuments },
    { channel: 'api:documents:delete', handler: deleteDocument },
    { channel: 'api:documents:reorder', handler: reorderDocuments },
    { channel: 'api:extract', handler: extractHandler },
    { channel: 'api:extract:model-test', handler: modelTestHandler },
    { channel: 'api:graph:build', handler: graphBuildHandler },
    { channel: 'api:graph:clear', handler: clearGraphHandler },
    { channel: 'api:graph:crosslinks:rebuild', handler: rebuildCrossLinksHandler },
    { channel: 'api:graph:query', handler: graphQueryHandler },
    { channel: 'api:graph:nodes:create', handler: createNode },
    { channel: 'api:graph:nodes:update', handler: updateNode },
    { channel: 'api:graph:nodes:delete', handler: deleteNode },
    { channel: 'api:graph:edges:create', handler: createEdge },
    { channel: 'api:graph:edges:update', handler: updateEdge },
    { channel: 'api:graph:edges:delete', handler: deleteEdge },
    { channel: 'api:clear', handler: clearAll },
    { channel: 'api:match', handler: matchHandler },
    { channel: 'api:search', handler: searchHandler },
    // 设置：KG provider 查询与 Ollama 检测
    // 注意：setLLMProvider/setKGProvider 的 IPC 由 electron/main.js 单独处理
    // （需同步更新 CSP connect-src 白名单），不在此注册以避免绕过 CSP 更新
    { channel: 'api:settings:llm:test', handler: testLLMProviderHandler },
    { channel: 'api:settings:kg:get', handler: getKGProviderHandler },
    { channel: 'api:settings:ollama-status', handler: ollamaStatusHandler },
    { channel: 'api:ideas:list', handler: listIdeas },
    { channel: 'api:ideas:create', handler: createIdea },
    { channel: 'api:ideas:update', handler: updateIdea },
    { channel: 'api:ideas:delete', handler: deleteIdea },
    { channel: 'api:ideas:recommend', handler: recommendIdeaNodes },
    { channel: 'api:ideas:link', handler: linkIdeaToNode },
    { channel: 'api:ideas:unlink', handler: unlinkIdeaFromNode },
    // 项目（多文件夹）管理
    { channel: 'api:projects:list', handler: listProjectsHandler },
    { channel: 'api:projects:create', handler: createProjectHandler },
    { channel: 'api:projects:rename', handler: renameProjectHandler },
    { channel: 'api:projects:update', handler: updateProjectHandler },
    { channel: 'api:projects:delete', handler: deleteProjectHandler },
    { channel: 'api:projects:switch', handler: switchProjectHandler },
    { channel: 'api:projects:export', handler: exportProjectHandler },
    { channel: 'api:projects:import', handler: importProjectHandler },
    // 提示词自定义与 LLM 调用日志
    { channel: 'api:settings:prompts:get', handler: getPromptsHandler },
    { channel: 'api:settings:prompts:set', handler: setPromptHandler },
    { channel: 'api:settings:prompts:reset', handler: resetPromptHandler },
    { channel: 'api:settings:prompts:disabled', handler: setDisabledHandler },
    { channel: 'api:settings:llm-log', handler: getLLMLogHandler },
    { channel: 'api:settings:prompts:test', handler: testPromptHandler }
  ];

  for (const { channel, handler } of ipcRoutes) {
    ipcMain.handle(channel, async (event, params) => {
      try {
        return await handler(params || {});
      } catch (e) {
        return { error: e.message };
      }
    });
  }
}

export { routes };
