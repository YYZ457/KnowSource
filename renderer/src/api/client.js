/** @module renderer/api/client
 *  职责：前端统一 API 客户端
 *  - Web 环境通过 Vite 代理访问 /api
 *  - Electron 环境直接访问本地后端服务 http://localhost:8000
 */
const isElectron = typeof window !== 'undefined' && !!window.KSElectron;
// 使用 127.0.0.1 而非 localhost，避免某些系统上 localhost 解析为 IPv6 ::1 导致连接失败
const backendPort = isElectron && window.KSElectron.env ? window.KSElectron.env.backendPort : 8000;
export const BASE = isElectron ? `http://127.0.0.1:${backendPort}` : '/api';
// 本地后端 API 认证令牌，由 Electron preload 注入
export const API_TOKEN = isElectron && window.KSElectron.env ? window.KSElectron.env.apiToken : '';

// 默认请求超时时间：5 分钟（大文档解析 / 图谱构建耗时较长，可按需配置）
const DEFAULT_TIMEOUT = 5 * 60 * 1000;
// PDF 解析超时时间：30 分钟，与后端 main.js 中 /parse 路径的服务端超时保持一致，
// 避免大型 PDF 解析超过 5 分钟时客户端提前中止请求但服务端继续处理
const PARSE_TIMEOUT = 30 * 60 * 1000;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * 根据 HTTP 状态码生成用户可理解的错误消息
 * @param {number} status - HTTP 状态码
 * @returns {string} 友好的错误提示
 */
function formatHttpError(status) {
  switch (status) {
    case 400:
      return '请求参数有误，请检查输入后重试';
    case 401:
      return '未授权，请重新打开应用';
    case 403:
      return '访问被拒绝，请确认应用权限';
    case 404:
      return '请求的资源不存在';
    case 408:
      return '请求超时，请稍后重试';
    case 413:
      return '请求内容过大，请尝试使用更小的文件';
    case 429:
      return '操作过于频繁，请稍后再试';
    case 500:
      return '服务器内部错误，请稍后重试';
    case 502:
    case 503:
      return '后端服务暂时不可用，请稍后重试';
    case 504:
      return '网关超时，请稍后重试';
    default:
      return `请求失败（${status}）`;
  }
}

/**
 * 发起 HTTP 请求
 * @param {string} method HTTP 方法
 * @param {string} path 路径（拼接到 BASE 之后）
 * @param {*} body 请求体（undefined 表示无 body）
 * @param {{ timeout?: number }} [opts] 可选配置，timeout 为超时毫秒数
 */
async function request(method, path, body, opts = {}) {
  const { timeout = DEFAULT_TIMEOUT } = opts;
  const url = `${BASE}${path}`;
  const options = {
    method,
    headers: {}
  };
  // Electron 环境下携带本地后端认证令牌，防止其他本地进程/网页访问后端
  if (API_TOKEN) {
    options.headers['X-Knowledge-IDE-Token'] = API_TOKEN;
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  // 请求超时控制：使用 AbortController，超时后中止请求
  const controller = new AbortController();
  options.signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    // 网络错误（DNS/连接失败/超时 abort 等）统一包装为 ApiError，携带 status 字段
    // 网络层错误无 HTTP 状态码，status 置为 null 以与 HTTP 错误区分
    if (e && e.name === 'AbortError') {
      throw new ApiError('请求超时，请检查网络连接或稍后重试', null);
    }
    // 区分连接被拒绝（后端服务不可用）和其他网络错误，给出更友好的提示
    const msg = (e && e.message) || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED') || msg.includes('ERR_CONNECTION_REFUSED')) {
      throw new ApiError('无法连接到后端服务，请确认应用已正常启动', null);
    }
    throw new ApiError('网络请求失败，请检查网络连接后重试', null);
  } finally {
    clearTimeout(timer);
  }

  // 检查响应 Content-Type：非 JSON 响应不强制按 JSON 解析
  const contentType = res.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    if (!res.ok) {
      throw new ApiError(formatHttpError(res.status), res.status);
    }
    // 成功的非 JSON 响应（如空响应 / 纯文本）返回 null
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 优先使用后端返回的错误消息，否则按状态码生成友好提示
    const errorMsg = data.error || formatHttpError(res.status);
    throw new ApiError(errorMsg, res.status);
  }
  return data;
}

const get = (path, opts) => request('GET', path, undefined, opts);
const post = (path, body, opts) => request('POST', path, body, opts);
const put = (path, body, opts) => request('PUT', path, body, opts);
// HTTP DELETE 请求通常不带 body（部分代理/服务器不支持 DELETE body）。
// 当前所有调用方均未传递 body，故移除 body 参数；如未来需要带 body 请改用 POST。
const del = (path, opts) => request('DELETE', path, undefined, opts);

export const client = {
  // 文档
  parseDocument: (name, content, type) => post('/parse', { name, content, type }, { timeout: PARSE_TIMEOUT }),
  pauseParse: () => post('/parse/pause'),
  resumeParse: () => post('/parse/resume'),
  cancelParse: () => post('/parse/cancel'),
  listDocuments: () => get('/documents'),
  deleteDocument: (id) => post('/documents/delete', { id }),
  reorderDocuments: (docIds) => post('/documents/reorder', { docIds }),

  // 图谱
  buildGraph: (options, docIds) => post('/graph/build', { options, docIds }),
  getGraphStats: () => get('/graph/query?action=stats'),
  createGraphNode: (node) => post('/graph/nodes', node),
  updateGraphNode: (id, patch) => post('/graph/nodes/update', { id, ...patch }),
  deleteGraphNode: (id) => post('/graph/nodes/delete', { id }),
  createGraphEdge: (edge) => post('/graph/edges', edge),
  deleteGraphEdge: (from, to, type) => post('/graph/edges/delete', { from, to, type }),
  // 任务进度查询（轮询）
  getProgress: () => get('/progress'),
  getClearToken: () => get('/clear-token'),
  clearAll: (confirmToken) => post('/clear', { confirmToken }),

  // 搜索
  search: (query, strategy = 'hybrid') => post('/match', { query, strategy }),
  // 文档内容搜索（按页定位 + 上下文片段）
  searchContent: (keyword, docId) => post('/search', { keyword, docId }),

  // 设置
  setLLMProvider: (config) => post('/settings/llm', config),
  setKGProvider: (config) => post('/settings/kg', config),
  getKGProvider: () => get('/settings/kg'),
  checkOllama: (baseUrl, customPath) => post('/settings/ollama-status', { baseUrl, customPath }),

  // 模型实验室
  modelTest: (docId, text, options = {}) => post('/extract/model-test', { docId, text, ...options }),
  // 仅重建跨文档关联；可传入 sourceDocIds/targetDocIds 只重建指定文档间的关联
  rebuildCrossLinks: (options = {}) => post('/graph/crosslinks/rebuild', { options }),

  // 提示词实验室
  getPrompts: () => get('/settings/prompts'),
  setPrompt: (taskId, override) => post('/settings/prompts', { taskId, ...override }),
  resetPrompt: (taskId) => post('/settings/prompts/reset', { taskId }),
  setDisabledTasks: (ids) => post('/settings/prompts/disabled', { ids }),
  getLLMLog: (limit = 50) => get('/settings/llm-log?limit=' + limit),
  testPrompt: (taskId, vars) => post('/settings/prompts/test', { taskId, vars }),

  // Idea
  listIdeas: () => get('/ideas'),
  createIdea: (idea) => post('/ideas', idea),
  updateIdea: (id, patch) => post('/ideas/update', { id, ...patch }),
  deleteIdea: (id) => post('/ideas/delete', { id }),
  recommendIdeaNodes: (id, topN = 5) => post('/ideas/recommend', { id, topN }),
  linkIdeaToNode: (ideaId, nodeId) => post('/ideas/link', { ideaId, nodeId }),
  unlinkIdeaFromNode: (ideaId, nodeId) => post('/ideas/unlink', { ideaId, nodeId }),

  // ============ 项目（多文件夹）管理 ============
  listProjects: () => get('/projects'),
  createProject: (name) => post('/projects', { name }),
  switchProject: (projectId) => post('/projects/switch', { projectId }),
  deleteProject: (id) => del('/projects/' + encodeURIComponent(id)),
  renameProject: (id, name) => put('/projects/' + encodeURIComponent(id), { name }),
  updateProject: (id, patch) => put('/projects/' + encodeURIComponent(id), patch),
  exportProject: (id) => get('/projects/' + encodeURIComponent(id) + '/export'),
  importProject: (data, name) => post('/projects/import', { data, name })
};

export { ApiError };
