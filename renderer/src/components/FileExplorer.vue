<!--
  FileExplorer.vue — 知源 KnowSource 文档管理面板
  功能:项目切换 / 文档列表 / 导入 / 删除 / 解析状态与进度
-->
<template>
  <div class="file-explorer panel">
    <!-- 顶部:项目选择 + 导入 -->
    <div class="panel__header file-explorer__header">
      <div class="file-explorer__project">
        <label class="file-explorer__project-label" for="project-filter">项目</label>
        <select
          id="project-filter"
          v-model="selectedProjectId"
          class="file-explorer__select"
          @change="onProjectChange"
        >
          <option :value="null">全部文档</option>
          <option v-for="p in projectStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>
      <button class="btn btn--primary btn--sm" @click="onImport" :disabled="importing" aria-label="导入本地文档">
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
        accept=".pdf,.doc,.docx,.md,.markdown,.txt,.html,.htm,.csv,.json,.ppt,.pptx,.jpg,.jpeg,.png"
        class="file-explorer__file-input"
        @change="handleFileInput"
      />
    </div>

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
        <p class="file-explorer__empty-hint">导入研究资料，或先用示例快速体验。</p>
        <div class="file-explorer__empty-actions">
          <button class="btn btn--primary btn--sm" type="button" :disabled="importing" @click="onImport">导入文档</button>
          <button class="btn btn--sm" type="button" :disabled="sampleImporting" @click="importSample">
            <span v-if="sampleImporting" class="spinner" aria-hidden="true"></span>
            {{ sampleImporting ? '载入中…' : '载入示例' }}
          </button>
        </div>
      </div>

      <!-- 文档列表 -->
      <ul v-else class="doc-list" role="listbox" aria-label="文档列表">
        <li
          v-for="(doc, index) in docsStore.documents"
          :key="doc.id"
          class="doc-item"
          :class="{ 'doc-item--active': doc.id === docsStore.selectedDocId }"
          role="option"
          :aria-selected="doc.id === docsStore.selectedDocId"
          :tabindex="docTabIndex(doc, index)"
          @click="onDocClick(doc)"
          @keydown="onDocKeydown($event, doc, index)"
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
            <!-- 解析进度条 -->
            <div v-if="getParsePercent(doc.id) != null" class="doc-item__progress">
              <div class="progress-bar" role="progressbar" aria-label="解析进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(getParsePercent(doc.id))">
                <div
                  class="progress-bar__fill"
                  :style="{ width: getParsePercent(doc.id) + '%' }"
                ></div>
              </div>
              <span class="doc-item__progress-text">{{ Math.round(getParsePercent(doc.id)) }}%</span>
            </div>
          </div>

          <button
            class="doc-item__delete icon-btn"
            title="删除文档"
            :aria-label="`删除文档：${docName(doc)}`"
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
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useDocsStore, useProjectStore, useUiStore, useGraphStore, useIdeaStore } from '../stores'
import { parseApi, documentsApi } from '../api/client'

const docsStore = useDocsStore()
const projectStore = useProjectStore()
const uiStore = useUiStore()
const graphStore = useGraphStore()
const ideaStore = useIdeaStore()

const fileInput = ref(null)
const importing = ref(false)
const sampleImporting = ref(false)
const selectedProjectId = ref(null)

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
  // 优先读取实时的解析进度
  if (docsStore.parseProgress[doc.id] != null) return 'parsing'
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

function getParsePercent(docId) {
  const p = docsStore.parseProgress[docId]
  if (p == null) return null
  if (typeof p === 'number') return p
  return p.percent ?? p.progress ?? null
}

// ===== 解析进度轮询 =====
let pollTimer = null
const pollRetries = {} // 记录每个文档的连续轮询次数，超过上限则停止
const MAX_POLL_RETRIES = 200 // 200 × 1.5s = 5 分钟超时

async function pollProgress() {
  const parsingDocs = docsStore.documents.filter(d => getStatus(d) === 'parsing')
  if (parsingDocs.length === 0) return
  for (const doc of parsingDocs) {
    // 超过最大轮询次数，停止轮询该文档并刷新列表
    pollRetries[doc.id] = (pollRetries[doc.id] || 0) + 1
    if (pollRetries[doc.id] > MAX_POLL_RETRIES) {
      delete pollRetries[doc.id]
      delete docsStore.parseProgress[doc.id]
      await docsStore.load()
      uiStore.toast(`文档「${doc.name}」解析超时，请重试`, 'error')
      continue
    }
    try {
      const result = await parseApi.getProgress(doc.id)
      const percent = typeof result === 'number' ? result : (result?.percent ?? result?.progress)
      if (percent != null) {
        docsStore.parseProgress[doc.id] = percent
      }
      // 解析完成则清理进度并刷新列表
      if (percent >= 100 || result?.status === 'done' || result?.status === 'completed') {
        delete pollRetries[doc.id]
        delete docsStore.parseProgress[doc.id]
        await docsStore.load()
      }
    } catch (e) {
      /* 静默忽略轮询错误 */
    }
  }
}

// ===== 交互 =====
function onDocClick(doc) {
  docsStore.selectDoc(doc.id)
}

function docTabIndex(doc, index) {
  if (doc.id === docsStore.selectedDocId) return 0
  return !docsStore.selectedDocId && index === 0 ? 0 : -1
}

function onDocKeydown(event, doc, index) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onDocClick(doc)
    return
  }
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  let nextIndex = index
  if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, docsStore.documents.length - 1)
  if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = docsStore.documents.length - 1
  const nextDoc = docsStore.documents[nextIndex]
  if (nextDoc) docsStore.selectDoc(nextDoc.id)
  requestAnimationFrame(() => {
    event.currentTarget.closest('.doc-list')?.querySelectorAll('.doc-item')[nextIndex]?.focus()
  })
}

async function onProjectChange() {
  if (selectedProjectId.value != null) {
    await projectStore.switchTo(selectedProjectId.value)
  }
  // 重置所有依赖项目的状态
  docsStore.selectDoc(null)
  graphStore.selectedNode = null
  await Promise.all([
    docsStore.load(),
    graphStore.loadGraph(),
    ideaStore.load(),
  ]).catch(() => {})
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
  const isElectron = typeof window !== 'undefined' && window.KSElectron
  if (isElectron && typeof window.KSElectron.openFileDialog === 'function') {
    importing.value = true
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
        for (const fp of result.filePaths) {
          const buffer = await window.KSElectron.readFile(fp)
          const name = fp.split(/[\\/]/).pop()
          files.push({ name, content: arrayBufferToBase64(buffer), type: getFileType(name) })
        }
        uiStore.toast(`正在解析 ${files.length} 个文档，请稍候...`, 'info')
        const { results, errors } = await docsStore.importFiles(files)
        const successCount = results.length
        const failCount = files.length - successCount
        if (failCount > 0) {
          uiStore.toast(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个\n${errors.join('\n')}`, 'error')
        } else {
          uiStore.toast(`已导入 ${successCount} 个文档`, 'success')
        }
      }
    } catch (e) {
      uiStore.toast('导入失败: ' + (e.message || e), 'error')
    } finally {
      importing.value = false
    }
  } else {
    fileInput.value && fileInput.value.click()
  }
}

async function importSample() {
  if (sampleImporting.value) return
  sampleImporting.value = true
  uiStore.toast('正在导入示例文档，首次解析可能需要几分钟...', 'info')
  try {
    const result = await documentsApi.importSample()
    if (result?.success === false && !result?.skipped) throw new Error(result.error || '示例导入失败')
    await docsStore.load()
    if (!docsStore.selectedDocId && docsStore.documents[0]?.id) docsStore.selectDoc(docsStore.documents[0].id)
    const allSkipped = result?.docs?.length > 0 && result.docs.every(d => d.skipped)
    uiStore.toast(allSkipped ? '示例文档已存在' : '示例文档已载入', 'success')
  } catch (e) {
    uiStore.toast('载入示例失败：' + (e.message || e), 'error')
  } finally {
    sampleImporting.value = false
  }
}

async function handleFileInput(event) {
  const files = Array.from(event.target.files || [])
  if (files.length === 0) return
  const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB，与 Electron 模式一致
  importing.value = true
  try {
    const fileObjs = []
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        uiStore.toast(`文件「${f.name}」超过 50MB 限制，已跳过`, 'error')
        continue
      }
      const buffer = await f.arrayBuffer()
      fileObjs.push({ name: f.name, content: arrayBufferToBase64(buffer), type: getFileType(f.name) })
    }
    if (fileObjs.length === 0) return
    uiStore.toast(`正在解析 ${fileObjs.length} 个文档，请稍候...`, 'info')
    const { results, errors } = await docsStore.importFiles(fileObjs)
    const successCount = results.length
    const failCount = fileObjs.length - successCount
    if (failCount > 0) {
      uiStore.toast(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个\n${errors.join('\n')}`, 'error')
    } else {
      uiStore.toast(`已导入 ${successCount} 个文档`, 'success')
    }
  } catch (e) {
    uiStore.toast('导入失败: ' + (e.message || e), 'error')
  } finally {
    importing.value = false
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
  window.addEventListener('ks-import-files', onImport)
  await Promise.all([docsStore.load(), projectStore.load()])
  if (projectStore.currentProject) {
    selectedProjectId.value = projectStore.currentProject.id
  }
  pollTimer = setInterval(pollProgress, 1500)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  window.removeEventListener('ks-import-files', onImport)
})
</script>

<style scoped>
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
.file-explorer__empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
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
.doc-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
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
.doc-item:hover .doc-item__delete,
.doc-item:focus-within .doc-item__delete {
  opacity: 1;
}
.doc-item__delete:hover {
  color: var(--rose);
  background: var(--rose-dim);
}
</style>
