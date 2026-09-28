/**
 * API 客户端 — 自动适配 Electron / Web 两种模式
 * Electron: 通过 http://127.0.0.1:{backendPort} 访问后端
 * Web: 通过 /api/* 相对路径（Vite 代理到后端）
 */

const isElectron = typeof window !== 'undefined' && window.KSElectron

function getBaseUrl() {
  if (isElectron && window.KSElectron?.env?.backendPort) {
    return `http://127.0.0.1:${window.KSElectron.env.backendPort}`
  }
  return '/api'
}

function getApiToken() {
  if (isElectron && window.KSElectron?.env?.apiToken) {
    return window.KSElectron.env.apiToken
  }
  return null
}

async function request(path, options = {}) {
  const baseUrl = getBaseUrl()
  const token = getApiToken()
  let url = `${baseUrl}${path}`

  // GET 请求的查询参数
  if (options.params) {
    const search = new URLSearchParams(
      Object.entries(options.params).filter(([_, v]) => v != null)
    ).toString()
    if (search) url += (url.includes('?') ? '&' : '?') + search
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Knowledge-IDE-Token': token } : {}),
    ...options.headers
  }

  // 使用 AbortController 设置超时，防止 UI 永久卡死
  const controller = new AbortController()
  const timeoutMs = options.timeout || 30000 // 默认 30 秒；长操作可传更长的 timeout
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let resp
  try {
    resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })
  } catch (fetchErr) {
    clearTimeout(timer)
    if (fetchErr.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs / 1000}s）：${options.method || 'GET'} ${path}`)
    }
    throw fetchErr
  }
  clearTimeout(timer)

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    // 尝试解析 JSON 获取友好错误消息
    let message = `API ${resp.status}`
    let parsedBody = null
    try {
      const parsed = JSON.parse(text)
      parsedBody = parsed
      if (parsed.error) message = parsed.error
      else if (parsed.message) message = parsed.message
    } catch {
      if (text) message = text.slice(0, 200)
    }
    const err = new Error(message)
    err.status = resp.status
    err.body = text
    err.data = parsedBody
    throw err
  }

  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return resp.json()
  }
  return resp.text()
}

// ===== 文档 API =====
export const documentsApi = {
  list: () => request('/documents'),
  remove: (id) => request('/documents/delete', { method: 'POST', body: { id } }),
  reorder: (docIds) => request('/documents/reorder', { method: 'POST', body: { docIds } }),
}

// ===== 解析 API =====
export const parseApi = {
  parse: (file) => request('/parse', { method: 'POST', body: file, timeout: 600000 }),
  pause: () => request('/parse/pause', { method: 'POST' }),
  resume: () => request('/parse/resume', { method: 'POST' }),
  cancel: () => request('/parse/cancel', { method: 'POST' }),
  getProgress: (docId) => request('/progress', { params: docId ? { docId } : {} }),
}

// ===== 图谱 API =====
export const graphApi = {
  build: (docIds, options = {}) => request('/graph/build', { method: 'POST', body: { docIds, options }, timeout: 600000 }),
  getProgress: () => request('/progress', { timeout: 5000 }),
  getStats: () => request('/graph/query', { params: { action: 'stats' } }),
  getNeighbors: (nodeId, depth = 1) => request('/graph/query', { params: { action: 'neighbors', nodeId, depth } }),
  findPath: (from, to) => request('/graph/query', { params: { action: 'path', from, to } }),
  searchNodes: (query, type, limit = 20) => request('/graph/query', { params: { action: 'search', query, type, limit } }),
  rebuildCrossLinks: () => request('/graph/crosslinks/rebuild', { method: 'POST' }),
  createNode: (node) => request('/graph/nodes', { method: 'POST', body: node }),
  updateNode: (node) => request('/graph/nodes/update', { method: 'POST', body: node }),
  deleteNode: (id) => request('/graph/nodes/delete', { method: 'POST', body: { id } }),
  createEdge: (edge) => request('/graph/edges', { method: 'POST', body: edge }),
  updateEdge: (edge) => request('/graph/edges/update', { method: 'POST', body: edge }),
  deleteEdge: (from, to, type) => request('/graph/edges/delete', { method: 'POST', body: { from, to, type } }),
  getClearToken: () => request('/clear-token'),
  clearAll: async () => {
    const { token } = await request('/clear-token')
    return request('/clear', { method: 'POST', body: { confirmToken: token } })
  },
}

// ===== 搜索 API =====
export const searchApi = {
  search: (keyword, docId) => request('/search', { method: 'POST', body: { keyword, docId } }),
}

// ===== 设置 API =====
export const settingsApi = {
  // LLM Provider
  getModelConfig: () => request('/settings/llm'),
  saveModelConfig: (config) => request('/settings/llm', { method: 'POST', body: config }),
  // KG Provider
  getKGConfig: () => request('/settings/kg'),
  saveKGConfig: (config) => request('/settings/kg', { method: 'POST', body: config }),
  // Ollama
  getOllamaStatus: (options) => request('/settings/ollama-status', { method: 'POST', body: options }),
  // Prompts
  getPrompts: () => request('/settings/prompts'),
  savePrompt: (taskId, template) => request('/settings/prompts', { method: 'POST', body: { taskId, system: template.system, user: template.user } }),
  resetPrompt: (taskId) => request('/settings/prompts/reset', { method: 'POST', body: { taskId } }),
  setDisabled: (ids) => request('/settings/prompts/disabled', { method: 'POST', body: { ids } }),
  // LLM Log
  getLLMLog: (limit = 50) => request('/settings/llm-log', { params: { limit } }),
  // Test Prompt
  testPrompt: (taskId, vars) => request('/settings/prompts/test', { method: 'POST', body: { taskId, vars } }),
}

// ===== Idea API =====
export const ideaApi = {
  list: () => request('/ideas'),
  create: (idea) => request('/ideas', { method: 'POST', body: idea }),
  update: (id, patch) => request('/ideas/update', { method: 'POST', body: { id, ...patch } }),
  delete: (id) => request('/ideas/delete', { method: 'POST', body: { id } }),
  recommend: (params) => request('/ideas/recommend', { method: 'POST', body: params }),
  linkToNode: (ideaId, nodeId) => request('/ideas/link', { method: 'POST', body: { ideaId, nodeId } }),
  unlinkFromNode: (ideaId, nodeId) => request('/ideas/unlink', { method: 'POST', body: { ideaId, nodeId } }),
}

// ===== 项目 API =====
export const projectsApi = {
  list: () => request('/projects'),
  create: (name) => request('/projects', { method: 'POST', body: { name } }),
  switch: (projectId) => request('/projects/switch', { method: 'POST', body: { projectId } }),
  update: (id, data) => request(`/projects/${id}`, { method: 'PUT', body: { id, ...data } }),
  remove: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  export: (id) => request(`/projects/${id}/export`),
  import: (data, name) => request('/projects/import', { method: 'POST', body: { data, name } }),
}

// ===== 日志 API (映射到 settings/llm-log) =====
export const logsApi = {
  list: (limit = 50) => request('/settings/llm-log', { params: { limit } }),
}

// 所有模型请求均由实际执行任务的后端连接，避免浏览器跨域与部署位置误判。
export async function testLLMConnection(config) {
  return request('/settings/connection-test', { method: 'POST', body: config, timeout: 70000 })
}

async function agentRequest(path, options) {
  let data
  try { data = await request(path, options) }
  catch (error) {
    // Older servers incorrectly classified terminal run snapshots as HTTP errors.
    const snapshot = error.data
    if (path === '/agent/status' && snapshot?.runId === options?.params?.runId &&
        ['running', 'completed', 'failed', 'cancelled', 'awaiting_confirmation'].includes(snapshot.status)) return snapshot
    throw error
  }
  if (data?.success === false || (data?.error && !data?.status)) throw new Error(data.error || data.message || 'Agent 请求失败')
  return data
}
export const agentApi = {
  skills: () => agentRequest('/agent/skills'),
  run: (payload) => agentRequest('/agent/run', { method: 'POST', body: payload }),
  status: (runId) => agentRequest('/agent/status', { params: { runId } }),
  confirm: (runId, actionIds) => agentRequest('/agent/confirm', { method: 'POST', body: { runId, actionIds } }),
  cancel: (runId) => agentRequest('/agent/cancel', { method: 'POST', body: { runId } }),
}

export default { documentsApi, parseApi, graphApi, searchApi, settingsApi, ideaApi, projectsApi, logsApi, agentApi, testLLMConnection }
