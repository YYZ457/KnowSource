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
          <template v-if="!pdfLoadFailed">
            <div v-if="pdfLoading" class="editor__loading" role="status">
              <span class="spinner"></span>
              <span>正在加载 PDF...</span>
            </div>
            <template v-if="pdfDocument">
              <div class="editor__pdf-toolbar">
                <button class="btn btn--sm btn--ghost" :disabled="pdfPage <= 1" @click="pdfPage--">上一页</button>
                <span aria-live="polite">第 {{ pdfPage }} / {{ pdfPageCount }} 页</span>
                <button class="btn btn--sm btn--ghost" :disabled="pdfPage >= pdfPageCount" @click="pdfPage++">下一页</button>
              </div>
              <div class="editor__pdf-page">
                <div v-if="pdfRendering" class="editor__loading" role="status">
                  <span class="spinner"></span>
                  <span>正在渲染页面...</span>
                </div>
                <canvas
                  :key="pdfPage"
                  ref="pdfCanvas"
                  class="editor__pdf-canvas"
                  :style="{ visibility: pdfRendering ? 'hidden' : 'visible' }"
                  role="img"
                  :aria-label="`${docTitle}，第 ${pdfPage} 页`"
                ></canvas>
              </div>
            </template>
          </template>
          <div v-else class="editor__pdf-fallback">
            <p>PDF 加载失败，原始文件可能缺失或格式异常</p>
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
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { loadPdfPreview, renderPdfPreviewPage } from '../api/pdf-preview.mjs'

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

// 使用 PDF.js 画布，避免原生 PDF 插件被严格的 object-src CSP 阻止。
// worker 来自本应用构建产物；原始文件只通过带认证请求头的 fetch 读取。
const pdfDocument = shallowRef(null)
const pdfCanvas = ref(null)
const pdfPage = ref(1)
const pdfPageCount = ref(0)
const pdfLoading = ref(false)
const pdfRendering = ref(false)
const pdfLoadFailed = ref(false)
const pdfRetryKey = ref(0)

async function loadPdfLibrary() {
  const [mod, { pdfResourceOptions }] = await Promise.all([
    import('pdfjs-dist/build/pdf.js'),
    import('../api/pdf-resources.js'),
  ])
  const library = mod.default || mod
  library.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  return { getDocument: options => library.getDocument({ ...options, ...pdfResourceOptions }) }
}

function retryPdfLoad() {
  pdfRetryKey.value++
}

// Watch cleanup also runs on unmount. Replaced requests/workers cannot overwrite
// a newer document, and switching to text releases all PDF rendering resources.
watch([selectedDoc, pdfViewMode, pdfRetryKey], async ([doc, mode], _, onCleanup) => {
  const controller = new AbortController()
  let current = true
  let timer
  onCleanup(() => {
    current = false
    clearTimeout(timer)
    controller.abort()
  })
  pdfDocument.value = null
  pdfPage.value = 1
  pdfPageCount.value = 0
  pdfLoadFailed.value = false
  pdfLoading.value = false
  if (!doc || mode !== 'render' || !isPdf.value) return

  pdfLoading.value = true
  timer = setTimeout(() => controller.abort(), 30000)
  try {
    const pdf = await loadPdfPreview({
      docId: doc.id || doc.docId,
      electronEnv: window.KSElectron?.env,
      signal: controller.signal,
      loadLibrary: loadPdfLibrary,
    })
    if (!current) return
    pdfPageCount.value = pdf.numPages
    pdfDocument.value = pdf
  } catch (error) {
    if (current) pdfLoadFailed.value = true
  } finally {
    clearTimeout(timer)
    if (current) pdfLoading.value = false
  }
}, { immediate: true })

watch([pdfDocument, pdfPage, pdfCanvas], async ([pdf, pageNumber, canvas], _, onCleanup) => {
  const controller = new AbortController()
  let current = true
  let timer
  onCleanup(() => {
    current = false
    clearTimeout(timer)
    controller.abort()
  })
  if (!pdf || !canvas) {
    pdfRendering.value = false
    return
  }
  pdfRendering.value = true
  timer = setTimeout(() => controller.abort(), 30000)
  try {
    await renderPdfPreviewPage({
      pdf,
      pageNumber,
      canvas,
      width: canvas.parentElement.clientWidth || 800,
      pixelRatio: window.devicePixelRatio || 1,
      signal: controller.signal,
    })
  } catch (error) {
    if (current) pdfLoadFailed.value = true
  } finally {
    clearTimeout(timer)
    if (current) pdfRendering.value = false
  }
}, { flush: 'post' })

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
.editor__pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 0 12px;
  font-size: 12px;
  flex-shrink: 0;
}
.editor__pdf-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}
.editor__pdf-page {
  width: 100%;
  min-height: 200px;
}
.editor__pdf-canvas {
  display: block;
  max-width: 100%;
  background: white;
  border-radius: var(--radius-sm);
}
.editor__pdf-fallback {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
