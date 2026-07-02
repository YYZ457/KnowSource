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
          @change="onProjectChange"
        >
          <option :value="null">全部文档</option>
          <option v-for="p in projectStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>
      <button class="btn btn--primary btn--sm" @click="onImport" :disabled="importing">
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
            <!-- 解析进度条 -->
            <div v-if="getParsePercent(doc.id) != null" class="doc-item__progress">
              <div class="progress-bar">
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
import { useDocsStore, useProjectStore, useUiStore } from '../stores'
import { parseApi } from '../api/client'

const docsStore = useDocsStore()
const projectStore = useProjectStore()
const uiStore = useUiStore()

const fileInput = ref(null)
const importing = ref(false)
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
async function pollProgress() {
  const parsingDocs = docsStore.documents.filter(d => getStatus(d) === 'parsing')
  if (parsingDocs.length === 0) return
  for (const doc of parsingDocs) {
    try {
      const result = await parseApi.getProgress(doc.id)
      const percent = typeof result === 'number' ? result : (result?.percent ?? result?.progress)
      if (percent != null) {
        docsStore.parseProgress[doc.id] = percent
      }
      // 解析完成则清理进度并刷新列表
      if (percent >= 100 || result?.status === 'done' || result?.status === 'completed') {
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

async function onProjectChange() {
  if (selectedProjectId.value != null) {
    await projectStore.switchTo(selectedProjectId.value)
    await docsStore.load()
  } else {
    await docsStore.load()
  }
}

// ===== 文件导入辅助 =====
function getFileType(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  const typeMap = {
    pdf: 'pdf', doc: 'doc', docx: 'docx',
    md: 'md', markdown: 'md', txt: 'txt',
    html: 'html', htm: 'html',
    csv: 'csv', json: 'json',
    ppt: 'ppt', pptx: 'pptx',
    jpg: 'jpg', jpeg: 'jpg', png: 'png',
  }
  return typeMap[ext] || ext || 'txt'
}

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
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
        await docsStore.importFiles(files)
        uiStore.toast(`已导入 ${files.length} 个文档`, 'success')
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

async function handleFileInput(event) {
  const files = Array.from(event.target.files || [])
  if (files.length === 0) return
  importing.value = true
  try {
    const fileObjs = []
    for (const f of files) {
      const buffer = await f.arrayBuffer()
      fileObjs.push({ name: f.name, content: arrayBufferToBase64(buffer), type: getFileType(f.name) })
    }
    await docsStore.importFiles(fileObjs)
    uiStore.toast(`已导入 ${fileObjs.length} 个文档`, 'success')
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
  await Promise.all([docsStore.load(), projectStore.load()])
  if (projectStore.currentProject) {
    selectedProjectId.value = projectStore.currentProject.id
  }
  pollTimer = setInterval(pollProgress, 1500)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
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
