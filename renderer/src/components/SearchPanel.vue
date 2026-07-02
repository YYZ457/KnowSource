<template>
  <!-- 浮动搜索结果下拉：定位在顶部搜索输入框下方 -->
  <transition name="fade">
    <div class="search-dropdown" :style="{ left: pos.left, top: pos.top, width: pos.width }">
      <div class="search-dropdown__head">
        <span class="search-dropdown__title">
          搜索结果
          <span v-if="uiStore.searchResults.length" class="search-dropdown__count">{{ uiStore.searchResults.length }}</span>
        </span>
        <button class="icon-btn" title="关闭" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="search-dropdown__body">
        <div v-if="!uiStore.searchResults.length" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <p>暂无搜索结果</p>
        </div>

        <button
          v-for="(r, i) in uiStore.searchResults"
          :key="i"
          class="search-result"
          @click="onSelect(r)"
        >
          <div class="search-result__title">{{ resultTitle(r) }}</div>
          <div
            v-if="resultSnippet(r)"
            class="search-result__snippet"
            v-html="highlight(resultSnippet(r))"
          ></div>
          <div class="search-result__meta">
            <span v-if="resultDoc(r)" class="tag tag--cyan">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
              {{ resultDoc(r) }}
            </span>
            <span v-if="r.page || r.pageNumber" class="tag tag--violet">第 {{ r.page || r.pageNumber }} 页</span>
            <span v-if="r.score != null && r.score !== ''" class="tag tag--emerald">{{ Math.round((Number(r.score) || 0) * 100) }}%</span>
            <span v-if="r.type || r.kind" class="tag tag--amber">{{ r.type || r.kind }}</span>
          </div>
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useUiStore, useDocsStore } from '../stores'

const emit = defineEmits(['close'])

const uiStore = useUiStore()
const docsStore = useDocsStore()

// 定位：跟随顶部搜索框
const pos = ref({ left: '0px', top: '0px', width: '360px' })

function updatePos() {
  const el = document.querySelector('.topbar__search-wrap')
  if (!el) return
  const rect = el.getBoundingClientRect()
  pos.value = {
    left: rect.left + 'px',
    top: rect.bottom + 6 + 'px',
    width: Math.max(rect.width, 320) + 'px',
  }
}

onMounted(() => {
  updatePos()
  window.addEventListener('resize', updatePos)
  window.addEventListener('scroll', updatePos, true)
})
onUnmounted(() => {
  window.removeEventListener('resize', updatePos)
  window.removeEventListener('scroll', updatePos, true)
})

// ===== 结果字段（兼容多种返回结构） =====
function resultTitle(r) {
  return r.title || r.heading || r.name || r.subject || '搜索结果'
}
function resultSnippet(r) {
  return r.snippet || r.text || r.content || r.preview || r.excerpt || ''
}
function resultDoc(r) {
  return r.document || r.docName || r.doc_name || r.source || r.filename || ''
}
function resultDocId(r) {
  return r.docId || r.document_id || r.documentId || r.doc_id || r.id || null
}

// ===== 高亮查询词 =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function highlight(text) {
  const q = (uiStore.searchQuery || '').trim()
  const safe = escapeHtml(text || '')
  if (!q) return safe
  try {
    const re = new RegExp('(' + escapeRegExp(q) + ')', 'gi')
    return safe.replace(re, '<mark>$1</mark>')
  } catch {
    return safe
  }
}

// ===== 选中结果：跳转到对应文档 =====
async function onSelect(r) {
  const docId = resultDocId(r)
  // 关闭下拉
  emit('close')
  // 切换到文档视图
  uiStore.setView('documents')
  if (docId) {
    try {
      await docsStore.selectDoc(docId)
    } catch (e) {
      uiStore.toast('无法打开文档：' + e.message, 'error')
    }
  }
}
</script>

<style scoped>
.search-dropdown {
  position: fixed;
  z-index: 9999;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}
.search-dropdown__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-deep);
}
.search-dropdown__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.search-dropdown__count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
}
.search-dropdown__body {
  overflow-y: auto;
  padding: 6px;
}

.search-result {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: 9px 11px;
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
  transition: background 0.12s;
  display: block;
}
.search-result:hover {
  background: var(--bg-hover);
}
.search-result + .search-result {
  border-top: 1px solid var(--border);
}
.search-result__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-result__snippet {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 6px;
}
.search-result__snippet :deep(mark) {
  background: var(--warm-dim);
  color: var(--warm);
  border-radius: 2px;
  padding: 0 2px;
  font-weight: 600;
}
.search-result__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.search-result__meta .tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
</style>
