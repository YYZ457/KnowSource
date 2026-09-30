<!--
  FileExplorer.vue — 知源 KnowSource 文档管理面板
  功能:项目切换 / 文档列表 / 导入 / 删除 / 解析状态与进度
-->
<template>
  <div class="file-explorer panel">
    <!-- 顶部:项目选择 + 导入 -->
    <div class="panel__header file-explorer__header">
      <div class="file-explorer__project">
        <label class="file-explorer__project-label">项目</label>
        <select
          v-model="selectedProjectId"
          class="file-explorer__select"
          :disabled="importing || graphStore.building || switchingProject"
          @change="onProjectChange"
        >
          <option :value="null" disabled>选择项目</option>
          <option v-for="p in projectStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>
      <button class="btn btn--primary btn--sm" @click="onImport" :disabled="importing || graphStore.building || switchingProject">
        <span v-if="importing" class="spinner"></span>
        <svg v-else viewBox="0 0 24 24" fill="none" width="14" height="14">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        导入
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="file-explorer__file-input"
        @change="handleFileInput"
      />
    </div>

    <div class="import-guide">导入 → 阅读 → AI 提炼 / 图谱<br><span>单文件 {{ hostedTrial ? '10' : '50' }} MB 内，每批合计 50 MB 内</span></div>
    <section v-if="queue.length" class="import-queue" aria-label="文献导入队列">
      <button class="queue-heading" @click="queueExpanded = !queueExpanded" :aria-expanded="queueExpanded"><strong>导入队列 · {{ completedCount }}/{{ queue.length }} 完成</strong><span>{{ queueExpanded ? '收起' : '展开' }}</span></button>
      <template v-if="queueExpanded">
        <div class="queue-actions">
          <button v-if="docsStore.importing && !docsStore.queuePaused" class="btn btn--sm" :disabled="queueActionPending" @click="controlQueue('pause')">暂停</button>
          <button v-if="docsStore.importing && docsStore.queuePaused" class="btn btn--sm" :disabled="queueActionPending" @click="controlQueue('resume')">继续</button>
          <button v-if="docsStore.importing" class="btn btn--sm" :disabled="queueActionPending" @click="controlQueue('cancel')">停止</button>
          <button v-if="failedCount && !importing" class="btn btn--sm" :disabled="graphStore.building || switchingProject || queueActionPending" @click="retryFailed">重试失败项（{{ failedCount }}）</button>
        </div>
        <p v-if="docsStore.importing" class="queue-help">{{ docsStore.queuePaused ? '已请求暂停；PDF 在页间暂停，其他格式在下一文件前暂停。' : '暂停将在 PDF 页间或下一文件前生效。' }}</p>
        <ul class="queue-list">
          <li v-for="item in queue" :key="item.id" class="queue-item" :class="{ 'queue-item--failed': item.status === 'failed' }">
            <div class="queue-item-title"><span :title="item.name">{{ item.name }}</span><span>{{ queueStatus(item.status) }}</span></div>
            <div v-if="item.status === 'running'" class="doc-item__progress"><div class="progress-bar"><div class="progress-bar__fill" :style="{ width: queuePercent(item) + '%' }"></div></div><span class="doc-item__progress-text">{{ queuePercent(item) }}%</span></div>
            <p v-if="item.error" class="queue-error">{{ item.error }}</p>
            <p v-else-if="item.detail" class="queue-help">{{ item.detail }}</p>
          </li>
        </ul>
      </template>
    </section>
    <button v-if="docsStore.selectedDocId" class="btn btn--sm agent-read" @click="openAgent">交给 Agent 精读当前文献 →</button>

    <!-- 文档列表 -->
    <div class="panel__body file-explorer__body">
      <!-- 加载中 -->
      <div v-if="docsStore.loading && docsStore.documents.length === 0" class="file-explorer__loading">
        <span class="spinner"></span>
        <span>正在加载文档...</span>
      </div>

      <!-- 空状态 -->
      <div v-else-if="docsStore.documents.length === 0" class="empty-state">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <p>暂无文档</p>
        <p class="file-explorer__empty-hint">点击右上角「导入」按钮添加文档</p>
      </div>

      <!-- 文档列表 -->
      <ul v-else class="doc-list">
        <li
          v-for="doc in docsStore.documents"
          :key="doc.id"
          class="doc-item"
          :class="{ 'doc-item--active': doc.id === docsStore.selectedDocId }"
          @click="onDocClick(doc)"
        >
          <span class="doc-item__icon" :style="{ color: typeMeta(doc).color }">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </span>

          <div class="doc-item__info">
            <div class="doc-item__name" :title="docName(doc)">
              {{ docName(doc) }}
            </div>
            <div class="doc-item__meta">
              <span class="tag" :class="parseStatusTag(doc)">
                <span v-if="getStatus(doc) === 'parsing'" class="tag__dot"></span>
                {{ parseStatusText(doc) }}
              </span>
              <span class="doc-item__ext">{{ getExt(doc).toUpperCase() || 'FILE' }}</span>
              <span v-if="doc.size != null" class="doc-item__size">{{ formatSize(doc.size) }}</span>
            </div>
          </div>

          <button
            class="doc-item__delete icon-btn"
            title="删除文档"
            :disabled="importing || graphStore.building || switchingProject"
            @click.stop="onDelete(doc)"
          >
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDocsStore, useProjectStore, useUiStore, useGraphStore, useIdeaStore } from '../stores'

const docsStore = useDocsStore()
const projectStore = useProjectStore()
const uiStore = useUiStore()
const graphStore = useGraphStore()
const ideaStore = useIdeaStore()

const fileInput = ref(null)
const preparingFiles = ref(false)
const importing = computed(() => preparingFiles.value || docsStore.importing)
const selectedProjectId = ref(null)
const switchingProject = ref(false)
const hostedTrial = Boolean(window.__KS_HOSTED_TRIAL__)
const queueExpanded = ref(true)
const queueActionPending = ref(false)
const queue = computed(() => docsStore.importQueue || [])
const completedCount = computed(() => queue.value.filter(item => item.status === 'completed').length)
const failedCount = computed(() => queue.value.filter(item => item.status === 'failed').length)
const MAX_FILE_SIZE = (hostedTrial ? 10 : 50) * 1024 * 1024
const MAX_BATCH_SIZE = 50 * 1024 * 1024
watch(() => projectStore.currentProject?.id, id => { selectedProjectId.value = id || null }, { immediate: true })

function queueStatus(status) { return ({ queued: '排队中', running: '解析中', completed: '已完成', failed: '失败', cancelled: '已停止' })[status] || status }
function queuePercent(item) { return Math.max(0, Math.min(100, Math.round(Number(item.percent) || 0))) }
async function controlQueue(action) {
  queueActionPending.value = true
  try { await docsStore[{ pause: 'pauseImport', resume: 'resumeImport', cancel: 'cancelImport' }[action]]() }
  catch (e) { uiStore.toast('队列操作失败：' + (e.message || e), 'error') }
  finally { queueActionPending.value = false }
}
async function retryFailed() {
  if (importing.value || graphStore.building || switchingProject.value) return
  try { reportImport(await docsStore.retryFailed()) }
  catch (e) { uiStore.toast('重试失败：' + (e.message || e), 'error') }
}
function reportImport(results) {
  const failed = failedCount.value
  const stopped = queue.value.filter(item => item.status === 'cancelled').length
  uiStore.toast(`本次导入完成 ${results.length} 个${failed ? `，失败 ${failed} 个（可重试）` : ''}${stopped ? `，已停止 ${stopped} 个` : ''}`, failed ? 'warn' : 'success')
}

// ===== 文件类型映射 =====
const TYPE_META = {
  pdf:      { color: 'var(--rose)' },
  doc:      { color: 'var(--accent)' },
  docx:     { color: 'var(--accent)' },
  md:       { color: 'var(--violet)' },
  markdown: { color: 'var(--violet)' },
  txt:      { color: 'var(--text-3)' },
  html:     { color: 'var(--warm)' },
  htm:      { color: 'var(--warm)' },
  csv:      { color: 'var(--emerald)' },
  xlsx:     { color: 'var(--emerald)' },
  xls:      { color: 'var(--emerald)' },
  json:     { color: 'var(--warm)' },
}

function getExt(doc) {
  const name = doc.name || doc.filename || doc.title || ''
  const m = name.match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

function typeMeta(doc) {
  const ext = getExt(doc)
  return TYPE_META[ext] || { color: 'var(--text-2)' }
}

function docName(doc) {
  return doc.name || doc.filename || doc.title || '未命名文档'
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ===== 解析状态 =====
function getStatus(doc) {
  const s = doc.status || doc.parseStatus || doc.parsed || 'none'
  if (s === true) return 'parsed'
  if (s === false) return 'none'
  // 后端未返回 status 字段时，根据内容判断是否已解析
  if (s === 'none' && (doc.rawText || doc.content || (doc.sections?.length))) return 'parsed'
  return String(s).toLowerCase()
}

const STATUS_TEXT = {
  parsed: '已解析', completed: '已解析', done: '已解析',
  parsing: '解析中', processing: '解析中', running: '解析中',
  failed: '解析失败', error: '解析失败',
  pending: '待解析', queued: '待解析',
  none: '未解析', unparsed: '未解析',
}

const STATUS_TAG = {
  parsed: 'tag--emerald', completed: 'tag--emerald', done: 'tag--emerald',
  parsing: 'tag--amber', processing: 'tag--amber', running: 'tag--amber',
  failed: 'tag--rose', error: 'tag--rose',
  pending: 'tag--cyan', queued: 'tag--cyan',
  none: 'tag--cyan', unparsed: 'tag--cyan',
}

function parseStatusText(doc) {
  return STATUS_TEXT[getStatus(doc)] || '未解析'
}

function parseStatusTag(doc) {
  return STATUS_TAG[getStatus(doc)] || 'tag--cyan'
}

// ===== 交互 =====
function closeMobilePanel() {
  if (window.matchMedia('(max-width: 900px)').matches) uiStore.leftPanelVisible = false
}
function onDocClick(doc) {
  docsStore.selectDoc(doc.id)
  closeMobilePanel()
}
function openAgent() {
  uiStore.agentEntry = {
    docId: docsStore.selectedDocId,
    prompt: '精读这篇文献，梳理研究问题、方法、结论、局限与原文依据。',
  }
  uiStore.setView('agent')
  closeMobilePanel()
}

async function onProjectChange() {
  const previousId = projectStore.currentProject?.id || null
  const nextId = selectedProjectId.value
  if (!nextId || nextId === previousId || importing.value || graphStore.building) {
    selectedProjectId.value = previousId
    return
  }
  switchingProject.value = true
  try {
    await projectStore.switchTo(nextId)
    docsStore.selectDoc(null)
    graphStore.selectedNode = null
    await Promise.all([docsStore.load(), graphStore.loadGraph(), ideaStore.load()])
  } catch (e) {
    selectedProjectId.value = projectStore.currentProject?.id || previousId
    uiStore.toast('切换项目失败：' + (e.message || e), 'error')
  } finally { switchingProject.value = false }
}

// ===== 文件导入辅助 =====
function getFileType(name) {
  const parts = name.split('.')
  if (parts.length < 2) return 'txt' // 无扩展名文件
  const ext = parts.pop().toLowerCase()
  const typeMap = {
    pdf: 'pdf', doc: 'doc', docx: 'docx',
    md: 'md', markdown: 'md', txt: 'txt',
    html: 'html', htm: 'html',
    csv: 'csv', json: 'json',
    ppt: 'ppt', pptx: 'pptx',
    jpg: 'jpg', jpeg: 'jpg', png: 'png',
  }
  return typeMap[ext] || 'txt'
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  const CHUNK = 0x8000 // 32KB 分块处理，避免大文件时字符串拼接 O(n²)
  let binary = ''
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, len)))
  }
  return btoa(binary)
}

async function onImport() {
  if (importing.value || graphStore.building || switchingProject.value) return
  const importProjectId = projectStore.currentProject?.id
  const isElectron = typeof window !== 'undefined' && window.KSElectron
  if (isElectron && typeof window.KSElectron.openFileDialog === 'function') {
    preparingFiles.value = true
    try {
      const result = await window.KSElectron.openFileDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '文档', extensions: ['pdf', 'doc', 'docx', 'md', 'markdown', 'txt', 'html', 'csv', 'json', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      if (result && !result.canceled && result.filePaths?.length) {
        const files = []
        let totalBytes = 0
        for (const fp of result.filePaths) {
          const buffer = await window.KSElectron.readFile(fp)
          const name = fp.split(/[\\/]/).pop()
          const bytes = buffer.byteLength ?? buffer.length ?? 0
          if (bytes > MAX_FILE_SIZE) throw new Error(`文件「${name}」超过单文件 ${hostedTrial ? 10 : 50} MB 限制，请缩小后重新选择`)
          totalBytes += bytes
          if (totalBytes > MAX_BATCH_SIZE) throw new Error('本批文件合计超过 50 MB，请分批选择；本批尚未导入')
          files.push({ name, content: arrayBufferToBase64(buffer), type: getFileType(name) })
        }
        if (projectStore.currentProject?.id !== importProjectId) throw new Error('准备文件期间项目已切换，请在目标项目重新导入')
        queueExpanded.value = true
        const results = await docsStore.importFiles(files)
        reportImport(results)
      }
    } catch (e) {
      uiStore.toast('导入失败: ' + (e.message || e), 'error')
    } finally {
      preparingFiles.value = false
    }
  } else {
    fileInput.value && fileInput.value.click()
  }
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || [])
  if (files.length === 0) return
  if (importing.value || graphStore.building || switchingProject.value) { event.target.value = ''; return }
  const importProjectId = projectStore.currentProject?.id
  preparingFiles.value = true
  try {
    const oversized = files.find(f => f.size > MAX_FILE_SIZE)
    if (oversized) throw new Error(`文件「${oversized.name}」超过单文件 ${hostedTrial ? 10 : 50} MB 限制，请重新选择`)
    if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BATCH_SIZE) throw new Error('本批文件合计超过 50 MB，请分批选择；本批尚未导入')
    const fileObjs = []
    for (const f of files) {
      const buffer = await f.arrayBuffer()
      fileObjs.push({ name: f.name, content: arrayBufferToBase64(buffer), type: getFileType(f.name) })
    }
    if (fileObjs.length === 0) return
    if (projectStore.currentProject?.id !== importProjectId) throw new Error('准备文件期间项目已切换，请在目标项目重新导入')
    queueExpanded.value = true
    reportImport(await docsStore.importFiles(fileObjs))
  } catch (e) {
    uiStore.toast('导入失败: ' + (e.message || e), 'error')
  } finally {
    preparingFiles.value = false
    event.target.value = ''
  }
}

function onDelete(doc) {
  uiStore.showConfirm({
    title: '删除文档',
    message: `确定要删除「${docName(doc)}」吗?该操作不可撤销。`,
    confirmText: '删除',
    onConfirm: async () => {
      try {
        if (importing.value || graphStore.building || switchingProject.value) throw new Error('请等待当前导入或图谱任务完成后再删除')
        await docsStore.removeDoc(doc.id)
        uiStore.toast('文档已删除', 'success')
      } catch (e) {
        uiStore.toast('删除失败: ' + (e.message || e), 'error')
      }
    },
  })
}

// ===== 生命周期 =====
onMounted(async () => {
  try { await Promise.all([docsStore.load(), projectStore.load()]) }
  catch (e) { uiStore.toast('文献列表加载失败：' + (e.message || e), 'error') }
})
</script>

<style scoped>
.import-guide { padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 12px; line-height: 1.7; }
.import-guide span { color: var(--text-3); font-size: 11px; }
.import-queue { flex-shrink: 0; border-bottom: 1px solid var(--border); background: var(--bg-input); }
.queue-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: none; color: var(--text); cursor: pointer; text-align: left; font-size: 12px; }
.queue-heading > span { color: var(--text-3); font-size: 11px; }
.queue-actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 10px 6px; }
.queue-help { font-size: 11px; line-height: 1.5; color: var(--text-3); margin: 3px 0; overflow-wrap: anywhere; }
.import-queue > .queue-help { padding: 0 12px; }
.queue-list { list-style: none; padding: 0 8px 6px; max-height: min(220px, 30vh); overflow-y: auto; }
.queue-item { padding: 8px 4px; border-top: 1px solid var(--border); }
.queue-item-title { display: flex; gap: 8px; font-size: 11px; }
.queue-item-title > span:first-child { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.queue-item-title > span:last-child { flex-shrink: 0; color: var(--text-3); }
.queue-error { color: var(--rose); overflow-wrap: anywhere; font-size: 11px; line-height: 1.6; margin: 4px 0 0; }
.queue-item--failed .queue-item-title > span:last-child { color: var(--rose); }
.agent-read { margin: 8px 10px; flex-shrink: 0; white-space: normal; }
@media (hover: none) { .doc-item .doc-item__delete { opacity: 1; } }
.file-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin-bottom: 0;
}

.file-explorer__header {
  flex-wrap: wrap;
  gap: 10px;
}

.file-explorer__project {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.file-explorer__project-label {
  font-size: 11px;
  color: var(--text-3);
  margin: 0;
  white-space: nowrap;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.file-explorer__select {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  font-size: 12px;
}

.file-explorer__file-input {
  display: none;
}

.file-explorer__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
}

.file-explorer__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--text-3);
  font-size: 13px;
}

.file-explorer__empty-hint {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
  opacity: 0.7;
}

/* ===== 文档列表 ===== */
.doc-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
  transition: background 0.15s, transform 0.1s;
}
.doc-item:hover {
  background: var(--bg-hover);
}
.doc-item--active {
  background: var(--accent-dim);
}
.doc-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.doc-item__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 1px;
}

.doc-item__info {
  flex: 1;
  min-width: 0;
}

.doc-item__name {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.doc-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.doc-item__ext,
.doc-item__size {
  font-size: 10px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

.tag__dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  margin-right: 4px;
  vertical-align: middle;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* ===== 进度条 ===== */
.doc-item__progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.progress-bar {
  flex: 1;
  height: 3px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--violet));
  border-radius: 2px;
  transition: width 0.3s ease;
}
.doc-item__progress-text {
  font-size: 10px;
  color: var(--text-3);
  font-family: var(--font-mono);
  min-width: 28px;
  text-align: right;
}

.doc-item__delete {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}
.doc-item:hover .doc-item__delete {
  opacity: 1;
}
.doc-item__delete:hover {
  color: var(--rose);
  background: var(--rose-dim);
}
</style>
