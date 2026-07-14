<!--
  Editor.vue — 知源 KnowSource 文档查看器
  功能:展示选中文档内容,支持 PDF 原始渲染、Markdown 渲染(回退纯文本),空状态,标题栏
-->
<template>
  <div class="editor">
    <!-- 空状态 -->
    <div v-if="!selectedDoc" class="empty-state editor__empty">
      <div class="editor__empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M14 2v6h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="editor__empty-eyebrow">快速开始</span>
      <h2>{{ docsStore.documents.length ? '选择资料，继续阅读' : '从第一份资料开始构建知识库' }}</h2>
      <p class="editor__empty-hint">
        {{ docsStore.documents.length ? '从左侧选择文档，或继续导入新的研究材料。' : '导入 PDF、Markdown 或文本，知源会为你整理内容并连接成图谱。' }}
      </p>
      <div class="editor__empty-actions">
        <button v-if="docsStore.documents.length" class="btn btn--primary" type="button" @click="openFirstDocument">打开第一篇</button>
        <button class="btn btn--primary" type="button" @click="triggerImport">导入本地文档</button>
        <button class="btn" type="button" :disabled="importingSample" @click="importSample">
          <span v-if="importingSample" class="spinner" aria-hidden="true"></span>
          {{ importingSample ? '载入中…' : '体验示例文档' }}
        </button>
      </div>
      <p class="editor__empty-support">支持 PDF、DOCX、Markdown、TXT · 单文件最大 50MB</p>
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
          <div v-if="pdfUrl && !pdfLoadFailed" class="editor__pdf-iframe-wrapper">
            <iframe
              :src="pdfUrl"
              class="editor__pdf-iframe"
              frameborder="0"
              allowfullscreen
              @load="onPdfIframeLoad"
              @error="onPdfIframeError"
            ></iframe>
            <div v-if="pdfLoading" class="editor__pdf-loading">
              <span class="spinner"></span>
              <span>正在加载 PDF...</span>
            </div>
          </div>
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
import { useDocsStore, useUiStore } from '../stores'
import { documentsApi } from '../api/client'
import DOMPurify from 'dompurify'

const docsStore = useDocsStore()
const uiStore = useUiStore()

const md = shallowRef(null)
const pdfViewMode = ref('render') // 'render' | 'text'
const importingSample = ref(false)

function triggerImport() {
  window.dispatchEvent(new CustomEvent('ks-import-files'))
}

function openFirstDocument() {
  const first = docsStore.documents[0]
  if (first?.id) docsStore.selectDoc(first.id)
}

async function importSample() {
  if (importingSample.value) return
  importingSample.value = true
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
    importingSample.value = false
  }
}

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

  // Electron 模式：优先从响应式 store 获取 token，回退到 window.KSElectron
  const isElectron = typeof window !== 'undefined' && window.KSElectron
  if (isElectron) {
    const port = uiStore.backendPort || window.KSElectron?.env?.backendPort || ''
    const token = uiStore.apiToken || window.KSElectron?.env?.apiToken || ''
    if (port) {
      return `http://127.0.0.1:${port}/documents/${encodeURIComponent(docId)}/pdf${token ? '?token=' + encodeURIComponent(token) : ''}`
    }
  }
  // Web 模式 — Vite 代理 /api -> 后端
  return `/api/documents/${encodeURIComponent(docId)}/pdf`
})

// PDF 加载失败处理
const pdfLoadFailed = ref(false)
const pdfLoading = ref(false)
const pdfRetryKey = ref(0) // 用于触发重试

// 预检 PDF 可达性，失败则回退到文本视图
async function checkPdfAccessible(docId) {
  if (!docId) return false
  try {
    const isElectron = typeof window !== 'undefined' && window.KSElectron
    let checkUrl
    if (isElectron) {
      const port = uiStore.backendPort || window.KSElectron?.env?.backendPort || ''
      const token = uiStore.apiToken || window.KSElectron?.env?.apiToken || ''
      if (port) {
        checkUrl = `http://127.0.0.1:${port}/documents/${encodeURIComponent(docId)}/pdf${token ? '?token=' + encodeURIComponent(token) : ''}`
      } else {
        checkUrl = `/api/documents/${encodeURIComponent(docId)}/pdf`
      }
    } else {
      checkUrl = `/api/documents/${encodeURIComponent(docId)}/pdf`
    }
    // 使用传统 AbortController 替代 AbortSignal.timeout，兼容性更好
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    try {
      const resp = await fetch(checkUrl, { method: 'HEAD', signal: controller.signal })
      clearTimeout(timeoutId)
      if (resp.ok || resp.status === 206) return true
      // 403/404 等视为不可用（静默处理，避免控制台噪音）
      return false
    } catch (fetchErr) {
      clearTimeout(timeoutId)
      // HEAD 请求可能被浏览器/Vite代理中断（ERR_ABORTED），或不被支持
      // 任何 HEAD 失败都尝试 GET 请求 range=0-0 作为回退
      try {
          const getController = new AbortController()
          const getTimeoutId = setTimeout(() => getController.abort(), 5000)
          const getResp = await fetch(checkUrl, {
            method: 'GET',
            headers: { 'Range': 'bytes=0-0' },
            signal: getController.signal
          })
          clearTimeout(getTimeoutId)
          if (getResp.ok || getResp.status === 206 || getResp.status === 200) return true
          return false
        } catch (getErr) {
          // GET 也失败了，但仍允许 iframe 尝试加载（返回 true 让 iframe 自行处理）
          return true
        }
    }
  } catch (e) {
    // 预检完全失败时，仍允许 iframe 尝试加载
    return true
  }
}

function retryPdfLoad() {
  pdfLoadFailed.value = false
  pdfRetryKey.value++
}

// iframe 加载事件处理
let pdfLoadTimeoutId = null
function onPdfIframeLoad() {
  pdfLoading.value = false
  if (pdfLoadTimeoutId) {
    clearTimeout(pdfLoadTimeoutId)
    pdfLoadTimeoutId = null
  }
}
function onPdfIframeError() {
  pdfLoading.value = false
  pdfLoadFailed.value = true
  if (pdfLoadTimeoutId) {
    clearTimeout(pdfLoadTimeoutId)
    pdfLoadTimeoutId = null
  }
}

// 选中文档变化时预检 PDF（使用版本号防止竞态条件）
let pdfCheckVersion = 0
watch([() => docsStore.selectedDocId, () => pdfViewMode.value, pdfRetryKey], async ([docId, mode]) => {
  // 仅当文档存在于文档列表中时才预检，避免过期 docId 产生无效请求
  const docExists = docId && docsStore.documents.some(d => d.id === docId)
  if (docExists && mode === 'render' && isPdf.value) {
    const myVersion = ++pdfCheckVersion
    pdfLoadFailed.value = false
    pdfLoading.value = true
    // 设置超时：如果 15 秒内 iframe 没有触发 load 事件，标记为失败
    if (pdfLoadTimeoutId) clearTimeout(pdfLoadTimeoutId)
    pdfLoadTimeoutId = setTimeout(() => {
      if (pdfLoading.value) {
        pdfLoading.value = false
        pdfLoadFailed.value = true
      }
    }, 15000)
    const ok = await checkPdfAccessible(docId)
    // 如果在等待期间用户又切换了文档，丢弃过期的检查结果
    if (myVersion !== pdfCheckVersion) return
    if (!ok) {
      pdfLoadFailed.value = true
      pdfLoading.value = false
      if (pdfLoadTimeoutId) {
        clearTimeout(pdfLoadTimeoutId)
        pdfLoadTimeoutId = null
      }
    }
  } else {
    pdfLoading.value = false
    if (pdfLoadTimeoutId) {
      clearTimeout(pdfLoadTimeoutId)
      pdfLoadTimeoutId = null
    }
  }
}, { immediate: true })

// 本地跟踪内容加载状态(store 内部异步获取内容,无独立标志位)
// 切换文档时置为 true,内容到达后置为 false
const contentLoading = ref(false)

const renderedHtml = computed(() => {
  if (!md.value || !hasContent.value) return ''
  try {
    // 对 PDF 提取文本进行预处理：清理标记、重组段落
    let text = rawContent.value
    if (isPdf.value) {
      text = preprocessPdfText(text)
    }
    const raw = md.value.render(text)
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] })
  } catch (e) {
    return ''
  }
})

// PDF 文本预处理：清理标记、重组段落、美化分页符
function preprocessPdfText(text) {
  if (!text) return ''
  let lines = text.split('\n')
  const result = []
  let paraBuffer = []

  function flushPara() {
    if (paraBuffer.length > 0) {
      result.push(paraBuffer.join(''))
      paraBuffer = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    // 去除 [fsXX] 字体大小标记
    line = line.replace(/\[fs\d+\]/g, '')
    // 去除行首行尾多余空白
    line = line.trim()
    if (!line) {
      flushPara()
      continue
    }
    // 页码分隔线：--- 第X页 --- → 转为 markdown 分隔线 + 页码标注
    const pageMatch = line.match(/^[-—]+\s*第\s*(\d+)\s*页\s*[-—]+$/)
    if (pageMatch) {
      flushPara()
      result.push(`\n\n---\n\n<span class="pdf-page-marker">— 第 ${pageMatch[1]} 页 —</span>\n\n`)
      continue
    }
    // 表格行（含 | 分隔）
    if (line.includes('|') && line.split('|').length >= 3) {
      flushPara()
      result.push(line)
      continue
    }
    // 判断是否为段落结束（以句末标点结尾）
    const endsWithSentence = /[。．！？!?"」』）)；;]$/.test(line)
    // 判断是否为标题行：含中文且长度适中，不以标点结尾，不是公式/数字行
    const hasChinese = /[\u4e00-\u9fff]/.test(line)
    const hasFormulaChars = /^[∑⎛⎜⎝⎞⎟⎠∑√−+×÷=<>≤≥≠≈∞αβγδεθλμπσφωΔΣΠNdxyzk=0-9\s.,;:(){}[\]|/−+*^]+$/.test(line)
    const isNumericOrSymbol = /^[0-9\s.,;:(){}[\]|/−+*^=<>≤≥√∑⎛⎜⎝⎞⎟⎠TPN\s]+$/.test(line)
    const isShortTitle = hasChinese && !hasFormulaChars && !isNumericOrSymbol && line.length <= 50 && !endsWithSentence && !line.match(/^[（(]/)
    
    if (endsWithSentence) {
      // 以句末标点结尾，视为段落结束
      paraBuffer.push(line)
      flushPara()
    } else if (isShortTitle && paraBuffer.length === 0) {
      // 短行作为标题
      flushPara()
      result.push(`### ${line}`)
    } else {
      // 段落延续行，合并到缓冲区
      paraBuffer.push(line)
    }
  }
  flushPara()
  return result.join('\n')
}

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
  padding: 40px 28px;
  text-align: center;
}
.editor__empty--inline {
  padding: 32px 20px;
}
.editor__empty-icon {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  margin-bottom: 18px;
  color: var(--accent);
  background: var(--accent-dim);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  transform: rotate(-3deg);
}
.editor__empty-icon svg {
  width: 44px;
  height: 44px;
}
.editor__empty-eyebrow {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.editor__empty h2 {
  margin-top: 8px;
  font-family: var(--font-serif);
  font-size: clamp(20px, 3vw, 28px);
  line-height: 1.25;
  color: var(--text);
}
.editor__empty-hint {
  max-width: 520px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
  margin-top: 10px;
}
.editor__empty-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}
.editor__empty-support {
  margin-top: 14px;
  color: var(--text-3);
  font-family: var(--font-mono);
  font-size: 10px;
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

.markdown-body :deep(.pdf-page-marker) {
  display: block;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-3);
  background: var(--bg-deep);
  padding: 4px 0;
  border-radius: var(--radius-sm);
  margin: 1.2em 0;
  letter-spacing: 0.1em;
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
.editor__pdf-iframe-wrapper {
  position: relative;
  width: 100%;
  flex: 1;
  display: flex;
}
.editor__pdf-iframe {
  width: 100%;
  flex: 1;
  border: none;
  border-radius: var(--radius-sm);
  background: white;
  min-height: 600px;
}
.editor__pdf-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 13px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.editor__pdf-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--text-3);
  font-size: 13px;
}
.editor__pdf-fallback .editor__plain {
  max-height: 400px;
  overflow-y: auto;
  width: 100%;
  max-width: 800px;
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
