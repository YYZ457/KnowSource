<!--
  SourcePreview.vue — 知源 KnowSource 源文件预览面板
  功能：在图谱视图中双击节点时，在左侧丝滑展开源文件内容的区域浏览框
  PDF文档使用 webview 完整渲染，非PDF文档使用文本展示
-->
<template>
  <div class="source-preview">
    <!-- Header -->
    <div class="source-preview__header">
      <div class="source-preview__title-wrap">
        <svg class="source-preview__icon" viewBox="0 0 24 24" fill="none" width="15" height="15">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M14 2v6h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <span class="source-preview__title" :title="docTitle">{{ docTitle }}</span>
      </div>
      <button class="source-preview__close" @click="close" title="关闭预览">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <!-- Node label badge -->
    <div v-if="nodeLabel" class="source-preview__badge">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <span>{{ nodeLabel }}</span>
    </div>

    <!-- Content -->
    <div class="source-preview__body">
      <!-- PDF 完整渲染 -->
      <div v-if="pdfUrl && !pdfLoadFailed" class="source-preview__pdf">
          <div v-if="pdfLoading" class="source-preview__pdf-loading">
            <span class="spinner"></span>
            <span>正在加载 PDF...</span>
          </div>
          <!-- 使用 webview 替代 iframe：Chromium 在 file:// 协议下对跨域 iframe 加载本地 PDF 有安全限制，
               webview 通过独立 partition 渲染 PDF，并在主进程中放行 persist:pdfviewer partition。 -->
          <webview
            v-if="pdfUrl && !pdfLoadFailed"
            :src="pdfUrl"
            class="source-preview__iframe"
            partition="persist:pdfviewer"
            :webpreferences="'contextIsolation=yes,nodeIntegration=no,sandbox=yes'"
            @dom-ready="onPdfLoad"
            @did-fail-load="onPdfError"
          ></webview>
          <div v-if="pdfLoadFailed" class="source-preview__pdf-fallback">
            <p>PDF 加载失败</p>
            <button class="btn btn--sm" @click="retryPdf">重试</button>
          </div>
        </div>

      <!-- 非 PDF 文档：文本展示 -->
      <template v-else-if="!isPdf">
        <div v-if="!sections.length" class="source-preview__empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span>暂无内容</span>
        </div>
        <template v-else>
          <div
            v-for="(section, i) in sections"
            :key="i"
            class="source-preview__box"
            :class="{ 'source-preview__box--highlight': i === firstHighlightIndex }"
            :ref="el => { if (i === firstHighlightIndex) highlightRef = el }"
          >
            <div class="source-preview__box-label">{{ section.label }}</div>
            <div class="source-preview__box-text" v-html="section.html"></div>
          </div>
        </template>
      </template>

      <!-- PDF 无 URL 回退 -->
      <div v-else class="source-preview__empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        <span>文档不可用</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useUiStore, useDocsStore } from '../stores'

const uiStore = useUiStore()
const docsStore = useDocsStore()

const highlightRef = ref(null)

const docId = computed(() => uiStore.sourcePreviewDocId)
const nodeLabel = computed(() => uiStore.sourcePreviewNodeLabel)

const doc = computed(() => {
  if (!docId.value) return null
  return docsStore.documents.find(d => d.id === docId.value) || null
})

const docTitle = computed(() => {
  const d = doc.value
  if (!d) return '未知文档'
  return d.name || d.filename || d.title || '未命名文档'
})

const isPdf = computed(() => {
  const d = doc.value
  if (!d) return false
  const name = (d.name || d.filename || d.title || '').toLowerCase()
  return name.endsWith('.pdf') || d.type === 'pdf'
})

// 构建 PDF URL（与 Editor.vue 逻辑一致）
const pdfUrl = computed(() => {
  const d = doc.value
  if (!d) return ''
  const id = d.id || d.docId
  if (!id) return ''
  const isElectron = typeof window !== 'undefined' && window.KSElectron
  if (isElectron) {
    const port = uiStore.backendPort || window.KSElectron?.env?.backendPort || ''
    const token = uiStore.apiToken || window.KSElectron?.env?.apiToken || ''
    if (port) {
      return `http://127.0.0.1:${port}/documents/${encodeURIComponent(id)}/pdf${token ? '?token=' + encodeURIComponent(token) : ''}`
    }
  }
  return `/api/documents/${encodeURIComponent(id)}/pdf`
})

// PDF 加载状态
const pdfLoading = ref(false)
const pdfLoadFailed = ref(false)
const pdfRetryKey = ref(0)

let pdfLoadTimeoutId = null

function onPdfLoad() {
  pdfLoading.value = false
  if (pdfLoadTimeoutId) {
    clearTimeout(pdfLoadTimeoutId)
    pdfLoadTimeoutId = null
  }
}

function onPdfError() {
  pdfLoading.value = false
  pdfLoadFailed.value = true
  if (pdfLoadTimeoutId) {
    clearTimeout(pdfLoadTimeoutId)
    pdfLoadTimeoutId = null
  }
}

function retryPdf() {
  pdfLoadFailed.value = false
  pdfRetryKey.value++
  startPdfLoad()
}

function startPdfLoad() {
  if (!isPdf.value || !pdfUrl.value) return
  pdfLoading.value = true
  pdfLoadFailed.value = false
  if (pdfLoadTimeoutId) clearTimeout(pdfLoadTimeoutId)
  pdfLoadTimeoutId = setTimeout(() => {
    if (pdfLoading.value) {
      pdfLoading.value = false
      pdfLoadFailed.value = true
    }
  }, 15000)
}

// 文档变化时启动加载
watch([docId, pdfRetryKey], () => {
  if (isPdf.value && pdfUrl.value) {
    startPdfLoad()
  }
}, { immediate: true })

// ===== 非 PDF 文档的文本展示逻辑 =====
const rawText = computed(() => {
  const d = doc.value
  if (!d) return ''
  let text = String(d.content || d.rawText || '')
  text = text.replace(/\[fs\d+(?:\.\d+)?\]/g, '')
  text = text.replace(/\[bookmark:L\d+\]/g, '')
  return text
})

const sections = computed(() => {
  const text = rawText.value
  if (!text) return []
  const result = []

  // Markdown: split by ## headings
  const headingPattern = /^(#{1,4})\s+(.+)$/gm
  const matches = []
  let m
  while ((m = headingPattern.exec(text)) !== null) {
    matches.push({ index: m.index, level: m[1].length, title: m[2].trim(), end: m.index + m[0].length })
  }

  if (matches.length > 0) {
    if (matches[0].index > 0) {
      const before = text.slice(0, matches[0].index).trim()
      if (before) {
        result.push({ label: '前言', text: before, html: highlightText(before) })
      }
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].end
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length
      const content = text.slice(start, end).trim()
      result.push({
        label: matches[i].title,
        text: content,
        html: highlightText(content)
      })
    }
  } else {
    const paragraphs = text.split(/\n{2,}/)
    paragraphs.forEach((para, i) => {
      const trimmed = para.trim()
      if (trimmed) {
        result.push({
          label: `段落 ${i + 1}`,
          text: trimmed,
          html: highlightText(trimmed)
        })
      }
    })
  }

  return result
})

const firstHighlightIndex = computed(() => {
  if (!nodeLabel.value) return -1
  const label = nodeLabel.value.toLowerCase()
  return sections.value.findIndex(s => s.text.toLowerCase().includes(label))
})

function highlightText(text) {
  if (!nodeLabel.value || !text) return escapeHtml(text)
  const label = nodeLabel.value
  const escaped = escapeHtml(text)
  try {
    const regex = new RegExp(`(${escapeRegExp(label)})`, 'gi')
    return escaped.replace(regex, '<mark class="source-preview__hl">$1</mark>')
  } catch {
    return escaped
  }
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function close() {
  uiStore.closeSourcePreview()
}

// Auto-scroll to first highlighted section (非PDF文档)
watch(firstHighlightIndex, (idx) => {
  if (idx >= 0) {
    nextTick(() => {
      if (highlightRef.value) {
        highlightRef.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }
}, { immediate: true })
</script>

<style scoped>
.source-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.source-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.source-preview__title-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}

.source-preview__icon {
  color: #6b7280;
  flex-shrink: 0;
}

.source-preview__title {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-preview__close {
  background: transparent;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.15s;
  flex-shrink: 0;
}

.source-preview__close:hover {
  color: #1f2937;
  background: #f3f4f6;
}

.source-preview__badge {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: rgba(245, 158, 11, 0.08);
  border-bottom: 1px solid #e5e7eb;
  font-size: 11px;
  color: #d97706;
  font-weight: 500;
  flex-shrink: 0;
}

.source-preview__badge svg {
  flex-shrink: 0;
  opacity: 0.8;
}

.source-preview__badge span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-preview__body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: #ffffff;
}

/* ===== PDF iframe 渲染 ===== */
.source-preview__pdf {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  min-height: 0;
}

.source-preview__iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: #ffffff;
  min-height: 0;
}

.source-preview__pdf-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6b7280;
  font-size: 12px;
  z-index: 1;
}

.source-preview__pdf-loading .spinner {
  width: 14px;
  height: 14px;
  border-width: 2px;
  border-color: #d1d5db;
  border-top-color: #6b7280;
}

.source-preview__pdf-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: #6b7280;
  font-size: 12px;
}

/* ===== 非 PDF 文本展示 ===== */
.source-preview__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: #9ca3af;
  font-size: 12px;
}

.source-preview__empty svg {
  opacity: 0.3;
}

.source-preview__box {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 9px 11px;
  margin: 6px 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.source-preview__box:hover {
  border-color: #d1d5db;
}

.source-preview__box--highlight {
  border-color: rgba(245, 158, 11, 0.4);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.15);
}

.source-preview__box-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 5px;
  letter-spacing: 0.3px;
}

.source-preview__box-text {
  font-size: 12px;
  line-height: 1.55;
  color: #374151;
  max-height: 100px;
  overflow: hidden;
  position: relative;
  word-break: break-word;
}

.source-preview__box-text::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 20px;
  background: linear-gradient(transparent, #f9fafb);
  pointer-events: none;
}

:deep(.source-preview__hl) {
  background: rgba(245, 158, 11, 0.22);
  color: #d97706;
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
}
</style>
