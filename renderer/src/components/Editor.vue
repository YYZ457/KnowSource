<!--
  Editor.vue — 知源 KnowSource 文档查看器
  功能:展示选中文档内容,支持 PDF 原始渲染、Markdown 渲染(回退纯文本),空状态,标题栏
-->
<template>
  <div class="editor">
    <!-- 空状态 -->
    <div v-if="!selectedDoc" class="empty-state editor__empty">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <p>未选择文档</p>
      <p class="editor__empty-hint">从左侧文件列表中选择一个文档以查看内容</p>
    </div>

    <!-- 文档查看器 -->
    <template v-else>
      <!-- 标题栏 -->
      <div class="editor__titlebar">
        <span class="editor__icon" :style="{ color: typeMeta.color }">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </span>
        <h2 class="editor__title" :title="docTitle">{{ docTitle }}</h2>
        <div class="editor__titlebar-meta">
          <span class="tag tag--cyan">{{ typeMeta.ext }}</span>
          <span v-if="docSize" class="editor__size">{{ docSize }}</span>
          <!-- PDF 视图切换按钮 -->
          <div v-if="isPdf" class="editor__view-toggle">
            <button
              class="view-btn"
              :class="{ active: pdfViewMode === 'render' }"
              @click="pdfViewMode = 'render'"
              title="原始渲染"
            >原始视图</button>
            <button
              class="view-btn"
              :class="{ active: pdfViewMode === 'text' }"
              @click="pdfViewMode = 'text'"
              title="文本模式"
            >文本</button>
          </div>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="editor__content">
        <!-- 加载中 -->
        <div v-if="contentLoading" class="editor__loading">
          <span class="spinner"></span>
          <span>正在加载内容...</span>
        </div>

        <!-- PDF 原始渲染 -->
        <div
          v-else-if="isPdf && pdfViewMode === 'render'"
          class="editor__pdf-viewer"
        >
          <iframe
            v-if="pdfUrl && !pdfLoadFailed"
            :src="pdfUrl"
            class="editor__pdf-iframe"
            frameborder="0"
            allowfullscreen
          ></iframe>
          <div v-else class="editor__pdf-fallback">
            <p>{{ pdfLoadFailed ? 'PDF 加载失败，可能是文件较大或格式异常' : 'PDF 原始文件不可用' }}</p>
            <button class="btn btn--sm" @click="pdfViewMode = 'text'">切换到文本视图</button>
            <button v-if="pdfLoadFailed" class="btn btn--sm btn--ghost" @click="retryPdfLoad">重试加载</button>
            <pre v-if="rawContent" class="editor__plain editor__plain--fallback">{{ rawContent }}</pre>
            <p v-else class="editor__empty--inline">该文档暂无提取文本</p>
          </div>
        </div>

        <!-- Markdown 渲染 -->
        <article
          v-else-if="renderedHtml"
          class="markdown-body"
          v-html="renderedHtml"
        ></article>

        <!-- 纯文本回退 -->
        <pre v-else-if="hasContent" class="editor__plain">{{ rawContent }}</pre>

        <!-- 无内容 -->
        <div v-else class="empty-state editor__empty editor__empty--inline">
          <p>该文档暂无内容</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, onMounted, nextTick } from 'vue'
import { useDocsStore } from '../stores'
import DOMPurify from 'dompurify'

const docsStore = useDocsStore()

const md = shallowRef(null)
const pdfViewMode = ref('render') // 'render' | 'text'

// 动态加载 markdown-it,失败则回退纯文本
onMounted(async () => {
  try {
    const mod = await import('markdown-it')
    const MarkdownIt = mod.default || mod
    md.value = new MarkdownIt({
      html: false,
      breaks: true,
      linkify: true,
      typographer: true,
    })
  } catch (e) {
    // 加载失败时 md 保持 null,内容将以纯文本展示
    md.value = null
  }
})

// ===== 计算属性 =====
const selectedDoc = computed(() =>
  docsStore.documents.find(d => d.id === docsStore.selectedDocId) || null
)

const docTitle = computed(() => {
  const d = selectedDoc.value
  if (!d) return ''
  return d.name || d.filename || d.title || '未命名文档'
})

const rawContent = computed(() => {
  const c = docsStore.selectedDocContent
  return typeof c === 'string' ? c : ''
})

const hasContent = computed(() => rawContent.value.length > 0)

// ===== PDF 视觉渲染 =====
const isPdf = computed(() => {
  const ext = getExt(selectedDoc.value)
  return ext === 'pdf'
})

// 构建 PDF 原始文件 URL
// Web 模式: /api/documents/:docId/pdf (Vite 代理)
// Electron 模式: http://127.0.0.1:{port}/documents/:docId/pdf?token=xxx
const pdfUrl = computed(() => {
  const doc = selectedDoc.value
  if (!doc) return ''
  const docId = doc.id || doc.docId
  if (!docId) return ''

  // Electron 模式
  const isElectron = typeof window !== 'undefined' && window.KSElectron
  if (isElectron && window.KSElectron?.env?.backendPort) {
    const port = window.KSElectron.env.backendPort
    const token = window.KSElectron.env.apiToken || ''
    return `http://127.0.0.1:${port}/documents/${encodeURIComponent(docId)}/pdf${token ? '?token=' + encodeURIComponent(token) : ''}`
  }
  // Web 模式 — Vite 代理 /api -> 后端
  return `/api/documents/${encodeURIComponent(docId)}/pdf`
})

// PDF 加载失败处理
const pdfLoadFailed = ref(false)
const pdfRetryKey = ref(0) // 用于触发重试

// 预检 PDF 可达性，失败则回退到文本视图
async function checkPdfAccessible(docId) {
  if (!docId) return false
  try {
    const isElectron = typeof window !== 'undefined' && window.KSElectron
    let checkUrl
    if (isElectron && window.KSElectron?.env?.backendPort) {
      const port = window.KSElectron.env.backendPort
      const token = window.KSElectron.env.apiToken || ''
      checkUrl = `http://127.0.0.1:${port}/documents/${encodeURIComponent(docId)}/pdf${token ? '?token=' + encodeURIComponent(token) : ''}`
    } else {
      checkUrl = `/api/documents/${encodeURIComponent(docId)}/pdf`
    }
    const resp = await fetch(checkUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    if (resp.ok || resp.status === 206) return true
    // 403/404 等视为不可用
    console.warn('[Editor] PDF 预检失败:', resp.status)
    return false
  } catch (e) {
    console.warn('[Editor] PDF 预检异常:', e.message)
    return false
  }
}

function retryPdfLoad() {
  pdfLoadFailed.value = false
  pdfRetryKey.value++
}

// 选中文档变化时预检 PDF
watch([() => docsStore.selectedDocId, () => pdfViewMode.value, pdfRetryKey], async ([docId, mode]) => {
  if (docId && mode === 'render' && isPdf.value) {
    pdfLoadFailed.value = false
    const ok = await checkPdfAccessible(docId)
    if (!ok) {
      pdfLoadFailed.value = true
    }
  }
}, { immediate: true })

// 本地跟踪内容加载状态(store 内部异步获取内容,无独立标志位)
// 切换文档时置为 true,内容到达后置为 false
const contentLoading = ref(false)

const renderedHtml = computed(() => {
  if (!md.value || !hasContent.value) return ''
  try {
    const raw = md.value.render(rawContent.value)
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] })
  } catch (e) {
    return ''
  }
})

// 文件类型信息
const TYPE_META = {
  pdf:      { color: 'var(--rose)',    ext: 'PDF' },
  doc:      { color: 'var(--accent)',  ext: 'DOC' },
  docx:     { color: 'var(--accent)',  ext: 'DOCX' },
  md:       { color: 'var(--violet)',  ext: 'MD' },
  markdown: { color: 'var(--violet)',  ext: 'MD' },
  txt:      { color: 'var(--text-3)',  ext: 'TXT' },
  html:     { color: 'var(--warm)',    ext: 'HTML' },
  htm:      { color: 'var(--warm)',    ext: 'HTML' },
  csv:      { color: 'var(--emerald)', ext: 'CSV' },
  xlsx:     { color: 'var(--emerald)', ext: 'XLSX' },
  json:     { color: 'var(--warm)',    ext: 'JSON' },
}

function getExt(doc) {
  const name = doc?.name || doc?.filename || doc?.title || ''
  const m = name.match(/\.([a-zA-Z0-9]+)$/)
  return m ? m[1].toLowerCase() : ''
}

const typeMeta = computed(() => {
  const ext = getExt(selectedDoc.value)
  return TYPE_META[ext] || { color: 'var(--text-2)', ext: (ext || 'FILE').toUpperCase() }
})

const docSize = computed(() => {
  const bytes = selectedDoc.value?.size
  if (bytes == null) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
})

// 选中文档切换时滚动到顶部,重置PDF视图模式,并标记内容加载中
watch(() => docsStore.selectedDocId, (id) => {
  const el = document.querySelector('.editor__content')
  if (el) el.scrollTop = 0
  // 切换文档时重置PDF视图模式为默认渲染模式
  pdfViewMode.value = 'render'
  if (id) {
    contentLoading.value = true
    // 使用 nextTick 确保 contentLoading 不会因 selectedDocContent 未变化而卡住
    nextTick(() => {
      contentLoading.value = false
    })
  }
})
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* ===== 空状态 ===== */
.editor__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.editor__empty--inline {
  padding: 32px 20px;
}
.editor__empty svg {
  width: 44px;
  height: 44px;
}
.editor__empty-hint {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
  opacity: 0.7;
}

/* ===== 标题栏 ===== */
.editor__titlebar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-deep);
  flex-shrink: 0;
}
.editor__icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.editor__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  letter-spacing: 0.3px;
}
.editor__titlebar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.editor__size {
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

/* ===== 内容区 ===== */
.editor__content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 36px;
  position: relative;
}

.editor__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--text-3);
  font-size: 13px;
}

.editor__plain {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

/* ===== Markdown 排版 ===== */
.markdown-body {
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.8;
  color: var(--text);
  max-width: 820px;
  margin: 0 auto;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-family: var(--font);
  font-weight: 600;
  color: var(--text);
  margin: 1.6em 0 0.7em;
  line-height: 1.3;
}
.markdown-body :deep(h1) {
  font-size: 1.7em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
.markdown-body :deep(h2) {
  font-size: 1.4em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--border);
}
.markdown-body :deep(h3) { font-size: 1.2em; }
.markdown-body :deep(h4) { font-size: 1.05em; color: var(--text-2); }

.markdown-body :deep(p) {
  margin: 0 0 1em;
}

.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--accent-dim);
  transition: border-color 0.15s;
}
.markdown-body :deep(a:hover) {
  border-bottom-color: var(--accent);
}

.markdown-body :deep(strong) { font-weight: 600; color: var(--text); }
.markdown-body :deep(em) { font-style: italic; color: var(--text); }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 1em;
  padding-left: 1.6em;
}
.markdown-body :deep(li) { margin: 0.3em 0; }
.markdown-body :deep(li::marker) { color: var(--accent); }

.markdown-body :deep(blockquote) {
  margin: 1em 0;
  padding: 0.6em 1em;
  border-left: 3px solid var(--accent);
  background: var(--accent-glow);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-2);
}
.markdown-body :deep(blockquote p) { margin: 0; }

.markdown-body :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.15em 0.4em;
  color: var(--accent);
}
.markdown-body :deep(pre) {
  font-family: var(--font-mono);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1em 0;
  font-size: 13px;
  line-height: 1.6;
}
.markdown-body :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--text);
  font-size: inherit;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 13px;
  font-family: var(--font);
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}
.markdown-body :deep(th) {
  background: var(--bg-deep);
  font-weight: 600;
  color: var(--text);
}
.markdown-body :deep(tr:nth-child(even) td) {
  background: var(--bg-hover);
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.8em 0;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
  margin: 1em 0;
}

/* ===== PDF 视觉渲染 ===== */
.editor__pdf-viewer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.editor__pdf-iframe {
  width: 100%;
  flex: 1;
  border: none;
  border-radius: var(--radius-sm);
  background: white;
  min-height: 600px;
}
.editor__pdf-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-3);
  font-size: 13px;
}

/* ===== 视图切换按钮 ===== */
.editor__view-toggle {
  display: flex;
  gap: 2px;
  margin-left: 8px;
  background: var(--bg-input);
  border-radius: 6px;
  padding: 2px;
}
.view-btn {
  padding: 3px 10px;
  font-size: 11px;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s;
  font-family: var(--font);
}
.view-btn:hover {
  color: var(--text-2);
}
.view-btn.active {
  background: var(--accent);
  color: white;
}
</style>
