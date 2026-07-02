import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { documentsApi, parseApi, graphApi, settingsApi, ideaApi, searchApi, logsApi, projectsApi, testLLMConnection } from '../api/client'

// ===== UI Store =====
export const useUiStore = defineStore('ui', () => {
  const activeView = ref('documents') // documents | graph | idea
  const leftPanelVisible = ref(true)
  const rightPanelVisible = ref(false)
  const theme = ref(localStorage.getItem('ks-theme') || 'dark')
  const searchQuery = ref('')
  const searchResults = ref([])
  const searchOpen = ref(false)
  const toasts = ref([])
  const confirmDialog = ref(null)

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

  function toast(message, type = 'info') {
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message, type })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
  }

  function showConfirm(options) { confirmDialog.value = options }
  function closeConfirm() { confirmDialog.value = null }

  return { activeView, leftPanelVisible, rightPanelVisible, theme, searchQuery, searchResults, searchOpen, toasts, confirmDialog, settingsOpen, settingsTab, setView, openSettings, closeSettings, toggleTheme, toast, showConfirm, closeConfirm }
})

// ===== Documents Store =====
export const useDocsStore = defineStore('docs', () => {
  const documents = ref([])
  const selectedDocId = ref(null)
  const selectedDocContent = ref('')
  const loading = ref(false)
  const parseProgress = ref({})

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
    try {
      const result = await parseApi.parse(file)
      await load()
      return result
    } catch (e) { console.error('Parse failed:', e); throw e }
  }

  // 批量导入文件：files 为 { name, content, type } 对象数组
  async function importFiles(files) {
    const results = []
    for (const f of files) {
      try {
        const result = await parseApi.parse(f)
        results.push(result)
      } catch (e) { console.error(`Parse failed for ${f.name}:`, e) }
    }
    await load()
    return results
  }

  async function removeDoc(id) {
    try {
      await documentsApi.remove(id)
      documents.value = documents.value.filter(d => d.id !== id)
      if (selectedDocId.value === id) { selectedDocId.value = null; selectedDocContent.value = '' }
    } catch (e) { console.error('Remove failed:', e) }
  }

  async function checkProgress() {
    try {
      const data = await parseApi.getProgress()
      parseProgress.value = data || {}
      return data
    } catch (e) { console.error('Progress check failed:', e) }
  }

  return { documents, selectedDocId, selectedDocContent, loading, parseProgress, load, selectDoc, parseFile, importFiles, removeDoc, checkProgress }
})

// ===== Graph Store =====
export const useGraphStore = defineStore('graph', () => {
  const nodes = ref([])
  const edges = ref([])
  const selectedNode = ref(null)
  const building = ref(false)
  const buildProgress = ref('')
  const nodeTree = ref([])

  async function build(docIds, options = {}) {
    building.value = true
    buildProgress.value = '正在构建知识图谱...'
    try {
      const result = await graphApi.build(docIds, options)
      // 构建完成后自动加载图谱
      await loadGraph()
      buildProgress.value = ''
      return result
    } catch (e) {
      buildProgress.value = '构建失败: ' + e.message
      throw e
    } finally { building.value = false }
  }

  async function loadGraph() {
    try {
      const result = await graphApi.getStats()
      if (result.success !== false) {
        // 规范化节点：后端返回 content/meta，映射为 label/specificity
        nodes.value = (result.nodes || []).map(n => ({
          ...n,
          label: n.label || n.name || n.content || n.id,
          specificity: n.specificity ?? n.weight ?? n.meta?.textrank ?? 0.5,
          type: n.type || 'other',
        }))
        // 规范化边：后端返回 from/to（节点ID）和 source/target（元数据），优先用 from/to
        edges.value = (result.edges || []).map(e => ({
          ...e,
          source: e.from || e.source,
          target: e.to || e.target,
        }))
        // 按 type 分组生成 nodeTree
        const groups = {}
        for (const n of nodes.value) {
          const t = n.type || 'other'
          if (!groups[t]) groups[t] = []
          groups[t].push(n)
        }
        nodeTree.value = Object.entries(groups).map(([type, items]) => ({ type, items }))
      }
    } catch (e) { console.error('Load graph failed:', e) }
  }

  async function clearGraph() {
    try {
      await graphApi.clearAll()
    } catch (e) { console.error('Clear graph API failed:', e) }
    nodes.value = []
    edges.value = []
    selectedNode.value = null
    nodeTree.value = []
  }

  return { nodes, edges, selectedNode, building, buildProgress, nodeTree, build, loadGraph, clearGraph }
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
    } catch (e) { console.error('Save override failed:', e) }
  }

  async function resetOverride(taskId) {
    try {
      await settingsApi.resetPrompt(taskId)
      delete overrides.value[taskId]
    } catch (e) { console.error('Reset override failed:', e) }
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
  const testing = ref(false)
  const testResult = ref(null)

  async function load() {
    try {
      const data = await settingsApi.getModelConfig()
      config.value = { ...config.value, ...data }
    } catch (e) { console.error('Load model config failed:', e) }
  }

  async function save() {
    try {
      await settingsApi.saveModelConfig(config.value)
    } catch (e) { console.error('Save model config failed:', e) }
  }

  async function test() {
    testing.value = true
    testResult.value = null
    try {
      const result = await testLLMConnection(config.value)
      testResult.value = { success: true, response: result.response || result }
    } catch (e) {
      testResult.value = { success: false, message: e.message }
    } finally { testing.value = false }
  }

  return { config, testing, testResult, load, save, test }
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
      if (created && !created.error) {
        ideas.value.push(created)
      }
      return created
    } catch (e) { console.error('Create idea failed:', e) }
  }

  async function update(id, patch) {
    try {
      const result = await ideaApi.update(id, patch)
      const updated = result.data || result
      const idx = ideas.value.findIndex(i => i.id === id)
      if (idx >= 0) ideas.value[idx] = { ...ideas.value[idx], ...patch }
    } catch (e) { console.error('Update idea failed:', e) }
  }

  async function remove(id) {
    try {
      await ideaApi.delete(id)
      ideas.value = ideas.value.filter(i => i.id !== id)
      if (selectedIdea.value?.id === id) selectedIdea.value = null
    } catch (e) { console.error('Delete idea failed:', e) }
  }

  async function linkToNode(ideaId, nodeId) {
    try {
      await ideaApi.linkToNode(ideaId, nodeId)
    } catch (e) { console.error('Link idea failed:', e) }
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
      currentProject.value = data.current || projects.value.find(p => p.current) || null
    } catch (e) { console.error('Load projects failed:', e) }
  }

  async function switchTo(projectId) {
    try {
      await projectsApi.switch(projectId)
      await load()
    } catch (e) { console.error('Switch project failed:', e) }
  }

  return { projects, currentProject, load, switchTo }
})
