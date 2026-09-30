import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { documentsApi, parseApi, graphApi, settingsApi, ideaApi, searchApi, logsApi, projectsApi, testLLMConnection } from '../api/client'

// ===== UI Store =====
export const useUiStore = defineStore('ui', () => {
  const activeView = ref('documents') // documents | graph | idea
  const leftPanelVisible = ref(true)
  const rightPanelVisible = ref(false)
  const theme = ref(localStorage.getItem('ks-theme') || 'light')
  const searchQuery = ref('')
  const searchResults = ref([])
  const searchOpen = ref(false)
  const searching = ref(false)
  const toasts = ref([])
  const confirmDialog = ref(null)
  const agentEntry = ref(null)

  // 设置覆盖层状态
  const settingsOpen = ref(false)
  const settingsTab = ref('model') // model | prompts | about

  function setView(view) {
    activeView.value = view
    // 统一两栏布局：始终显示左侧面板
    leftPanelVisible.value = true
    rightPanelVisible.value = false
  }

  function openSettings(tab = 'model') {
    settingsTab.value = tab
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('ks-theme', theme.value)
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  let toastSeq = 0
  function toast(message, type = 'info') {
    const id = ++toastSeq
    toasts.value.push({ id, message, type })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
  }

  function showConfirm(options) { confirmDialog.value = options }
  function closeConfirm() { confirmDialog.value = null }

  // 图谱远程命令（菜单触发缩放/适配等，由 GraphView 监听执行）
  const graphCommand = ref(null) // { action: 'zoomIn' | 'zoomOut' | 'reset', ts: number }
  function sendGraphCommand(action) { graphCommand.value = { action, ts: Date.now() } }

  return { activeView, leftPanelVisible, rightPanelVisible, theme, searchQuery, searchResults, searchOpen, searching, toasts, confirmDialog, agentEntry, settingsOpen, settingsTab, setView, openSettings, closeSettings, toggleTheme, toast, showConfirm, closeConfirm, graphCommand, sendGraphCommand }
})

// ===== Documents Store =====
export const useDocsStore = defineStore('docs', () => {
  const documents = ref([])
  const selectedDocId = ref(null)
  const selectedDocContent = ref('')
  const loading = ref(false)
  const parseProgress = ref({})
  const importing = ref(false)
  const importQueue = ref([])
  const queuePaused = ref(false)
  const retryPayloads = new Map()
  let queueCancelled = false
  let queueProject = null

  async function load() {
    loading.value = true
    try {
      const data = await documentsApi.list()
      const raw = Array.isArray(data) ? data : (data.documents || [])
      // 规范化字段：后端返回 docId/rawText/meta.size，统一映射为 id/content/size
      documents.value = raw.map(d => {
        // 优先使用 rawText；若为空则从 sections 构建 Markdown 格式内容
        let content = d.content || d.rawText || ''
        if (!content && d.sections?.length) {
          content = d.sections.map(s => {
            const title = s.title ? `## ${s.title}\n\n` : ''
            return title + (s.content || '')
          }).join('\n\n')
        }
        return {
          ...d,
          id: d.id || d.docId,
          content,
          size: d.size ?? d.meta?.size ?? 0,
          name: d.name || d.filename || d.title || '未命名文档',
        }
      })
    } catch (e) { console.error('Failed to load documents:', e) }
    finally { loading.value = false }
  }

  function selectDoc(id) {
    selectedDocId.value = id
    if (!id) { selectedDocContent.value = ''; return }
    const doc = documents.value.find(d => d.id === id)
    let text = doc?.content || doc?.rawText || ''
    // 清理 PDF 内部标记：[fsXX] 字号标记、[bookmark:LX] 书签标记
    text = text.replace(/^\[fs\d+(?:\.\d+)?\]\s*/gm, '')
    text = text.replace(/^\[bookmark:L\d+\]\s*/gm, '')
    selectedDocContent.value = text
  }

  async function parseFile(file) {
    const results = await importFiles([file])
    if (!results.length) throw new Error(importQueue.value[0]?.error || '文献未导入，请查看处理队列')
    return results[0]
  }

  // 批量导入文件：files 为 { name, content, type } 对象数组
  async function importFiles(files) {
    if (importing.value) throw new Error('已有导入任务，请等待完成或停止当前队列')
    if (!files?.length) return []
    importing.value = true
    queuePaused.value = false
    queueCancelled = false
    queueProject = useProjectStore().currentProject?.id
    retryPayloads.clear()
    importQueue.value = files.map((f, i) => {
      const id = `${Date.now()}-${i}`
      retryPayloads.set(id, f)
      return { id, name: f.name, status: 'queued', error: '', percent: 0, detail: '等待处理' }
    })
    const results = []
    try {
      for (const item of importQueue.value) {
        while (queuePaused.value && !queueCancelled) await new Promise(resolve => setTimeout(resolve, 200))
        if (queueCancelled || queueProject !== useProjectStore().currentProject?.id) {
          item.status = 'cancelled'; item.detail = '未开始'; continue
        }
        item.status = 'running'; item.detail = '上传并提取正文'
        let polling = false
        const pollTimer = setInterval(async () => {
          if (polling) return
          polling = true
          try {
            const p = await parseApi.getProgress()
            if (item.status === 'running' && /^(?:pdf-)?parse:/.test(p?.taskId || '')) {
              parseProgress.value = p
              item.percent = Math.max(0, Math.min(100, p.percent || 0))
              item.detail = p.log || p.stage || '解析中'
            }
          } catch { /* Parsing response remains the source of completion status. */ }
          finally { polling = false }
        }, 1200)
        try {
          const result = await parseApi.parse(retryPayloads.get(item.id))
          if (!result || result.error || result.success === false) throw new Error(result?.error || result?.message || '解析失败')
          results.push(result); item.status = 'completed'; item.percent = 100; item.detail = '已提取正文，可阅读或交给 Agent'
          retryPayloads.delete(item.id)
        } catch (e) {
          item.status = queueCancelled ? 'cancelled' : 'failed'
          item.error = e.message || '解析失败'; item.detail = item.error
        } finally { clearInterval(pollTimer) }
      }
      await load()
      if (!selectedDocId.value && documents.value.length) selectDoc(documents.value.at(-1).id)
    } finally {
      importing.value = false
      queuePaused.value = false
    }
    return results
  }

  async function retryFailed() {
    if (queueProject !== useProjectStore().currentProject?.id) throw new Error('项目已改变，请在当前项目重新选择文件')
    const files = importQueue.value.filter(i => ['failed', 'cancelled'].includes(i.status)).map(i => retryPayloads.get(i.id)).filter(Boolean)
    return importFiles(files)
  }
  async function pauseImport() {
    queuePaused.value = true
    try { await parseApi.pause() } catch (e) {
      // Between files there is no backend task, but the queue can still pause.
      if (!e.message?.includes('当前没有可暂停')) { queuePaused.value = false; throw e }
    }
  }
  async function resumeImport() {
    try { await parseApi.resume() } catch (e) { if (!e.message?.includes('当前没有可恢复')) throw e }
    queuePaused.value = false
  }
  async function cancelImport() {
    queueCancelled = true
    queuePaused.value = false
    try { await parseApi.cancel() } catch (e) { if (!e.message?.includes('当前没有可取消')) throw e }
  }

  async function removeDoc(id) {
    try {
      await documentsApi.remove(id)
      documents.value = documents.value.filter(d => d.id !== id)
      if (selectedDocId.value === id) { selectedDocId.value = null; selectedDocContent.value = '' }
    } catch (e) {
      console.error('Remove failed:', e)
      // 删除失败时重新加载文档列表，确保前端状态与后端同步
      await load()
      throw e // 重新抛出错误，让调用者知道失败了
    }
  }

  async function checkProgress() {
    try {
      const data = await parseApi.getProgress()
      parseProgress.value = data || {}
      return data
    } catch (e) { console.error('Progress check failed:', e) }
  }

  return { documents, selectedDocId, selectedDocContent, loading, parseProgress, importing, importQueue, queuePaused, load, selectDoc, parseFile, importFiles, retryFailed, pauseImport, resumeImport, cancelImport, removeDoc, checkProgress }
})

// ===== Graph Store =====
export const useGraphStore = defineStore('graph', () => {
  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)
  const building = ref(false)
  const buildProgress = ref('')
  const buildPercent = ref(0)
  const buildStage = ref('')
  const buildLog = ref('')
  const nodeTree = ref([])

  async function build(docIds, options = {}) {
    building.value = true
    buildProgress.value = '正在构建知识图谱...'
    buildPercent.value = 0
    buildStage.value = ''
    buildLog.value = ''

    // 修复：轮询后端 /progress 端点获取实时进度
    let pollTimer = null
    try {
      pollTimer = setInterval(async () => {
        try {
          const p = await graphApi.getProgress()
          if (p && p.taskId) {
            if (p.status === 'running') {
              buildProgress.value = p.log || p.stage || '构建中...'
              buildPercent.value = p.percent || 0
              buildStage.value = p.stage || ''
              buildLog.value = p.log || ''
            } else if (p.status === 'error') {
              buildProgress.value = p.log || '构建出错'
              buildPercent.value = p.percent || 0
            }
          }
        } catch (e) { /* 静默忽略轮询错误 */ }
      }, 1000)

      const result = await graphApi.build(docIds, options)
      if (result?.success === false || result?.error) throw new Error(result.error || '图谱构建失败')
      await loadGraph()
      buildProgress.value = ''
      buildPercent.value = 100
      return result
    } catch (e) {
      buildProgress.value = '构建失败: ' + e.message
      buildPercent.value = 0
      setTimeout(() => { if (buildProgress.value.startsWith('构建失败')) buildProgress.value = '' }, 5000)
      throw e
    } finally {
      if (pollTimer) clearInterval(pollTimer)
      building.value = false
    }
  }

  async function loadGraph() {
    try {
      const result = await graphApi.getStats()
      if (result.success !== false) {
        nodes.value = (result.nodes || []).map(n => ({
          ...n,
          label: n.label || n.name || n.content || n.id,
          specificity: n.specificity ?? n.weight ?? n.meta?.textrank ?? 0.5,
          type: n.type || 'other',
        }))
        edges.value = (result.edges || []).map(e => ({
          ...e,
          source: e.from || e.source,
          target: e.to || e.target,
        }))
        const groups = {}
        for (const n of nodes.value) {
          const t = n.type || 'other'
          if (!groups[t]) groups[t] = []
          groups[t].push(n)
        }
        nodeTree.value = Object.entries(groups).map(([type, items]) => ({ type, items }))
        // 图谱重建后清除旧的选中节点引用，避免持有过期对象
        if (selectedNode.value && !nodes.value.find(n => n.id === selectedNode.value.id)) {
          selectedNode.value = null
        }
      } else {
        nodes.value = []
        edges.value = []
        nodeTree.value = []
        selectedNode.value = null
      }
    } catch (e) {
      console.error('Load graph failed:', e)
      nodes.value = []
      edges.value = []
      nodeTree.value = []
      selectedNode.value = null
    }
  }

  async function clearGraph() {
    try {
      await graphApi.clearAll()
    } catch (e) {
      console.error('Clear graph API failed:', e)
      throw e
    }
    nodes.value = []
    edges.value = []
    selectedNode.value = null
    nodeTree.value = []
  }

  return { nodes, edges, selectedNode, building, buildProgress, buildPercent, buildStage, buildLog, nodeTree, build, loadGraph, clearGraph }
})

// ===== Prompt Store =====
export const usePromptStore = defineStore('prompt', () => {
  const tasks = ref([])
  const templates = ref({})
  const overrides = ref({})
  const logs = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const data = await settingsApi.getPrompts()
      tasks.value = data.tasks || []
      templates.value = data.defaults || {}
      overrides.value = data.overrides || {}
    } catch (e) { console.error('Load prompts failed:', e) }
    finally { loading.value = false }
  }

  async function saveOverride(taskId, template) {
    try {
      await settingsApi.savePrompt(taskId, template)
      overrides.value[taskId] = template
    } catch (e) { console.error('Save override failed:', e); throw e }
  }

  async function resetOverride(taskId) {
    try {
      await settingsApi.resetPrompt(taskId)
      delete overrides.value[taskId]
    } catch (e) { console.error('Reset override failed:', e); throw e }
  }

  async function loadLogs() {
    try {
      const data = await settingsApi.getLLMLog()
      logs.value = data.entries || data || []
    } catch (e) { console.error('Load logs failed:', e) }
  }

  function getEffectiveTemplate(taskId) {
    const override = overrides.value[taskId]
    const builtin = templates.value[taskId] || { system: '', user: '' }
    if (override) return { system: override.system ?? builtin.system, user: override.user ?? builtin.user }
    return builtin
  }

  return { tasks, templates, overrides, logs, loading, load, saveOverride, resetOverride, loadLogs, getEffectiveTemplate }
})

// ===== Model Store =====
export const useModelStore = defineStore('model', () => {
  const config = ref({ provider: 'stub', model: '', apiKey: '', baseUrl: '', vendor: '' })
  const activeConfig = ref({ provider: 'stub', model: '', hasApiKey: false })
  const testing = ref(false)
  const testResult = ref(null)

  async function load() {
    try {
      const data = await settingsApi.getModelConfig()
      if (data?.success === false || data?.error) throw new Error(data.error || '读取模型设置失败')
      activeConfig.value = { ...data }
      config.value = { ...data, provider: data.provider === 'openai-compatible' ? (data.vendor || 'openai-compatible') : data.provider, apiKey: '' }
    } catch (e) { console.error('Load model config failed:', e) }
  }

  async function save({ syncKG = false } = {}) {
    const snapshot = { ...config.value }
    const result = await settingsApi.saveModelConfig(snapshot)
    if (result?.success === false || result?.error) throw new Error(result.error || result.message || result.warnings?.join('；') || '模型设置未保存')
    const warnings = [...(result.warnings || [])]
    let kgSynced = false
    if (syncKG) {
      try {
        const kg = await settingsApi.saveKGConfig({ ...snapshot, reuseLLMKey: true })
        if (kg?.success === false || kg?.error) throw new Error(kg.error || kg.message || kg.warnings?.join('；') || '保存失败')
        warnings.push(...(kg.warnings || []))
        kgSynced = true
      } catch (e) { warnings.push('通用模型已保存，但图谱模型同步失败：' + e.message) }
    }
    await load()
    return { success: true, warnings, kgSynced }
  }

  async function test() {
    testing.value = true
    testResult.value = null
    try {
      const result = await testLLMConnection(config.value)
      if (result?.success === false || result?.error) throw new Error(result.message || result.error || '连接失败')
      testResult.value = { success: true, response: result.response || result }
    } catch (e) {
      testResult.value = { success: false, message: e.message }
    } finally { testing.value = false }
  }

  return { config, activeConfig, testing, testResult, load, save, test }
})

// ===== Idea Store =====
export const useIdeaStore = defineStore('idea', () => {
  const ideas = ref([])
  const selectedIdea = ref(null)
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const data = await ideaApi.list()
      ideas.value = Array.isArray(data) ? data : (data.ideas || [])
    } catch (e) { console.error('Load ideas failed:', e) }
    finally { loading.value = false }
  }

  async function create(idea) {
    try {
      const result = await ideaApi.create(idea)
      const created = result.data || result
      if (created && !created.error && created.id) {
        ideas.value.push(created)
        return created
      }
      // 后端返回错误（如"项目正在切换中"），返回 null 让调用方处理
      return null
    } catch (e) { console.error('Create idea failed:', e); throw e }
  }

  async function update(id, patch) {
    try {
      const result = await ideaApi.update(id, patch)
      const updated = result.data || result
      const idx = ideas.value.findIndex(i => i.id === id)
      if (idx >= 0) {
        // 使用服务器返回的完整对象更新（包含 updatedAt 等服务端字段）
        ideas.value[idx] = { ...ideas.value[idx], ...updated }
      }
    } catch (e) { console.error('Update idea failed:', e); throw e }
  }

  async function remove(id) {
    try {
      await ideaApi.delete(id)
      ideas.value = ideas.value.filter(i => i.id !== id)
      if (selectedIdea.value?.id === id) selectedIdea.value = null
    } catch (e) { console.error('Delete idea failed:', e); throw e }
  }

  async function linkToNode(ideaId, nodeId) {
    try {
      await ideaApi.linkToNode(ideaId, nodeId)
    } catch (e) { console.error('Link idea failed:', e); throw e }
  }

  return { ideas, selectedIdea, loading, load, create, update, remove, linkToNode }
})

// ===== Project Store =====
export const useProjectStore = defineStore('project', () => {
  const projects = ref([])
  const currentProject = ref(null)

  async function load() {
    try {
      const data = await projectsApi.list()
      projects.value = Array.isArray(data) ? data : (data.projects || [])
      currentProject.value = projects.value.find(p => p.id === data.currentProjectId) || data.current || projects.value.find(p => p.current) || null
    } catch (e) { console.error('Load projects failed:', e) }
  }

  async function switchTo(projectId) {
    try {
      const result = await projectsApi.switch(projectId)
      if (result && result.error) {
        throw new Error(result.error)
      }
      await load()
    } catch (e) {
      console.error('Switch project failed:', e)
      throw e // 重新抛出，让调用方处理
    }
  }

  return { projects, currentProject, load, switchTo }
})
