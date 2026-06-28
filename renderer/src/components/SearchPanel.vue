<script setup>
/** SearchPanel — 顶部搜索，支持图谱节点 / 文档内容 / 全部三种范围 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useGraphStore } from '@/stores/graph';
import { useDocumentStore } from '@/stores/document';
import { useIdeaStore } from '@/stores/idea';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';
import { client } from '@/api/client.js';

const graphStore = useGraphStore();
const docStore = useDocumentStore();
const ideaStore = useIdeaStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const toast = useToastStore();
const query = ref('');
const strategy = ref('hybrid');
// 搜索范围：graph（图谱节点）/ content（文档内容）/ all（全部）
const scope = ref('all');
const searching = ref(false);
const graphResults = ref([]);
const contentResults = ref([]);
const showResults = ref(false);
// 搜索错误状态：记录搜索过程中发生的错误，用于在结果区显示错误提示
const searchError = ref('');
const panelRef = ref(null);
// 显示更多：控制搜索结果展示数量，点击"显示更多"时递增
const graphDisplayCount = ref(8);
const contentDisplayCount = ref(12);
// 搜索请求序号，用于丢弃过期请求结果，防止竞态覆盖
let searchSeq = 0;

// 监听项目切换：清空搜索状态，避免旧项目结果残留
watch(() => projectStore.currentProjectId, () => {
  query.value = '';
  graphResults.value = [];
  contentResults.value = [];
  graphDisplayCount.value = 8;
  contentDisplayCount.value = 12;
  showResults.value = false;
  searching.value = false;
  searchError.value = '';
  // 递增序号，使任何正在进行的旧搜索请求结果失效
  searchSeq++;
});

const hasResults = computed(() => graphResults.value.length > 0 || contentResults.value.length > 0);
const showStrategy = computed(() => scope.value === 'graph' || scope.value === 'all');
const hasMoreGraph = computed(() => graphResults.value.length > graphDisplayCount.value);
const hasMoreContent = computed(() => contentResults.value.length > contentDisplayCount.value);

function docName(docId) {
  const doc = docStore.documents.find(d => d.meta.docId === docId);
  return doc ? doc.meta.name : docId;
}

function sectionTitle(docId, sectionId) {
  const doc = docStore.documents.find(d => d.meta.docId === docId);
  if (!doc || !doc.sections) return '';
  const sec = doc.sections.find(s => s.id === sectionId);
  return sec ? sec.title : '';
}

/**
 * 将片段按关键词拆分为 {text, match} 段，供模板高亮渲染（避免 v-html）
 */
function highlightSnippet(snippet, kw) {
  if (!snippet) return [{ text: '', match: false }];
  if (!kw) return [{ text: snippet, match: false }];
  const lower = snippet.toLowerCase();
  const kwLower = kw.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < snippet.length) {
    const idx = lower.indexOf(kwLower, i);
    if (idx === -1) {
      parts.push({ text: snippet.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ text: snippet.slice(i, idx), match: false });
    parts.push({ text: snippet.slice(idx, idx + kw.length), match: true });
    i = idx + kw.length;
  }
  return parts;
}

/**
 * 提取图谱节点内容片段（截取前 100 字符），用于搜索结果预览
 */
function graphSnippet(r) {
  const text = r.content || r.snippet || r.title || '';
  if (!text) return '';
  return text.length > 100 ? text.slice(0, 100) + '...' : text;
}

/** 点击"显示更多"时增加图谱结果展示数量 */
function showMoreGraph() {
  graphDisplayCount.value += 10;
}

/** 点击"显示更多"时增加文档内容结果展示数量 */
function showMoreContent() {
  contentDisplayCount.value += 10;
}

async function search() {
  if (!query.value.trim()) return;
  const seq = ++searchSeq;
  searching.value = true;
  showResults.value = true;
  searchError.value = '';
  graphResults.value = [];
  contentResults.value = [];
  graphDisplayCount.value = 8;
  contentDisplayCount.value = 12;
  try {
    const tasks = [];
    // 图谱节点搜索
    if (scope.value === 'graph' || scope.value === 'all') {
      tasks.push(
        client.search(query.value, strategy.value)
          .then(res => {
            if (seq !== searchSeq) return;
            graphResults.value = (res && res.results) || [];
          })
          .catch(e => {
            if (seq !== searchSeq) return;
            console.error('图谱搜索失败:', e);
            graphResults.value = [];
            // 记录错误信息，在结果区显示错误提示而非静默吞掉
            searchError.value = e.message || '图谱搜索失败';
          })
      );
    }
    // 文档内容搜索
    if (scope.value === 'content' || scope.value === 'all') {
      tasks.push(
        client.searchContent(query.value)
          .then(res => {
            if (seq !== searchSeq) return;
            contentResults.value = (res && res.results) || [];
          })
          .catch(e => {
            if (seq !== searchSeq) return;
            console.error('文档搜索失败:', e);
            contentResults.value = [];
            // 记录错误信息，在结果区显示错误提示而非静默吞掉
            if (!searchError.value) searchError.value = e.message || '文档搜索失败';
          })
      );
    }
    await Promise.all(tasks);

    // 当前请求已过期，不再更新高亮和查询结果
    if (seq !== searchSeq) return;

    // 高亮命中的图谱节点（优先使用 nodeId，回退到 sectionId）
    const hitIds = graphResults.value.map(r => r.nodeId || r.sectionId).filter(Boolean);
    graphStore.setHighlightedNodes(hitIds);
    graphStore.setQueryResults(graphResults.value);
  } catch (e) {
    if (seq !== searchSeq) return;
    console.error('搜索失败:', e);
    searchError.value = e.message || '搜索失败';
    toast.error('搜索失败，请重试');
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
}

/**
 * 打开图谱节点结果：跳转到对应文档/章节，并在文档中高亮定位
 */
function openGraphResult(r) {
  if (r.docId) {
    docStore.setActive(r.docId, { page: r.page, keyword: r.keyword || r.content || r.title });
    ideaStore.setActive(null);
  }
  if (r.sectionId) {
    graphStore.setHighlightedNodes([r.nodeId || r.sectionId].filter(Boolean));
  }
  showResults.value = false;
}

/**
 * 打开文档内容结果：跳转到对应文档页码并高亮关键词
 */
function openContentResult(r) {
  if (r.docId) {
    const page = r.page && r.page > 0 ? r.page : 1;
    docStore.setActive(r.docId, { page, keyword: query.value });
    ideaStore.setActive(null);
    if (!uiStore.leftPanelVisible) uiStore.toggleLeftPanel();
  }
  showResults.value = false;
}

function closeResults() {
  showResults.value = false;
}

function onKeydown(e) {
  if (e.key === 'Escape') showResults.value = false;
}

function onDocumentClick(e) {
  if (panelRef.value && !panelRef.value.contains(e.target)) {
    showResults.value = false;
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('mousedown', onDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mousedown', onDocumentClick);
});
</script>

<template>
  <div ref="panelRef" class="search-panel" role="search" aria-label="知识搜索">
    <input
      v-model="query"
      placeholder="搜索知识..."
      class="search-input"
      aria-label="搜索关键词"
      @keyup.enter="search"
      @focus="showResults = hasResults"
    />
    <select v-model="scope" class="search-scope" title="搜索范围" aria-label="搜索范围">
      <option value="all">全部</option>
      <option value="graph">图谱节点</option>
      <option value="content">文档内容</option>
    </select>
    <select v-if="showStrategy" v-model="strategy" class="search-strategy" aria-label="搜索策略">
      <option value="hybrid">混合</option>
      <option value="tfidf">关键词</option>
      <option value="semantic">语义</option>
      <option value="graph">图结构</option>
    </select>
    <button @click="search" :disabled="searching" class="search-btn" aria-label="执行搜索">
      {{ searching ? '搜索中...' : '搜索' }}
    </button>

    <div v-if="showResults" class="search-results" role="list" aria-live="polite">
      <!-- 搜索错误状态：显示错误信息并提供重试按钮 -->
      <div v-if="searchError && !hasResults" class="result-error">
        <div class="result-error-msg">搜索失败：{{ searchError }}</div>
        <button class="result-retry-btn" @click="search">重试</button>
      </div>
      <div v-else-if="!hasResults" class="result-empty">
        {{ searching ? '搜索中...' : '未找到匹配结果，试试更换关键词或调整搜索范围' }}
      </div>

      <!-- 图谱节点结果 -->
      <template v-if="graphResults.length">
        <div class="result-group-title">图谱节点 ({{ graphResults.length }})</div>
        <div
          v-for="(r, i) in graphResults.slice(0, graphDisplayCount)"
          :key="'g' + i"
          class="result-item"
          role="listitem"
          tabindex="0"
          :aria-label="`图谱节点结果：${docName(r.docId)}，匹配度 ${((r.score || 0) * 100).toFixed(0)}%`"
          @click="openGraphResult(r)"
          @keydown.enter="openGraphResult(r)"
        >
          <div class="row">
            <span class="title">{{ docName(r.docId) }}</span>
            <span class="score">{{ ((r.score || 0) * 100).toFixed(0) }}%</span>
          </div>
          <div v-if="sectionTitle(r.docId, r.sectionId)" class="meta">
            {{ sectionTitle(r.docId, r.sectionId) }}
          </div>
          <div v-if="graphSnippet(r)" class="snippet">
            <template v-for="(seg, si) in highlightSnippet(graphSnippet(r), query)" :key="si">
              <mark v-if="seg.match" class="snippet-hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <div v-if="r.matchedKeywords && r.matchedKeywords.length" class="keywords">
            <span v-for="kw in r.matchedKeywords.slice(0, 5)" :key="kw">{{ kw }}</span>
          </div>
        </div>
        <div v-if="hasMoreGraph" class="show-more" role="button" tabindex="0" aria-label="显示更多图谱节点结果" @click="showMoreGraph" @keydown.enter="showMoreGraph">
          显示更多（剩余 {{ graphResults.length - graphDisplayCount }} 条）
        </div>
      </template>

      <!-- 文档内容结果 -->
      <template v-if="contentResults.length">
        <div class="result-group-title">文档内容 ({{ contentResults.length }})</div>
        <div
          v-for="(r, i) in contentResults.slice(0, contentDisplayCount)"
          :key="'c' + i"
          class="result-item"
          role="listitem"
          tabindex="0"
          :aria-label="`文档内容结果：${r.docName || docName(r.docId)}，第 ${r.page} 页`"
          @click="openContentResult(r)"
          @keydown.enter="openContentResult(r)"
        >
          <div class="row">
            <span class="title">{{ r.docName || docName(r.docId) }}</span>
            <span class="page-badge">第 {{ r.page }} 页</span>
          </div>
          <div class="snippet">
            <template v-for="(seg, si) in highlightSnippet(r.snippet, query)" :key="si">
              <mark v-if="seg.match" class="snippet-hit">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
        </div>
        <div v-if="hasMoreContent" class="show-more" role="button" tabindex="0" aria-label="显示更多文档内容结果" @click="showMoreContent" @keydown.enter="showMoreContent">
          显示更多（剩余 {{ contentResults.length - contentDisplayCount }} 条）
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-scope {
  padding: 6px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.result-group-title {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-bg);
  border-bottom: 1px solid var(--border);
}
.page-badge {
  color: var(--text-tertiary);
  font-size: 11px;
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 10px;
}
/* 搜索错误状态提示 */
.result-error {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--danger, #ef4444);
  font-size: 13px;
}
.result-error-msg {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-retry-btn {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity 0.15s;
}
.result-retry-btn:hover {
  opacity: 0.8;
}
.snippet {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}
.snippet-hit {
  background: #fde047;
  color: #1f2937;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
}
/* 搜索结果标题与元信息溢出省略，避免长文本撑破容器 */
.result-item .title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: calc(100% - 50px);
}
.result-item .meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* "显示更多"按钮：居中文字，hover 高亮 */
.show-more {
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
  user-select: none;
}
.show-more:hover {
  background: var(--accent-bg);
}

/* ============ 响应式样式 ============ */

/* 中等屏幕（max-width: 1200px）*/
@media (max-width: 1200px) {
  /* 搜索范围选择器：紧凑 */
  .search-scope {
    padding: 5px 6px;
    font-size: 11px;
  }
  /* 搜索策略选择器：紧凑 */
  .search-strategy {
    padding: 5px 6px;
    font-size: 11px;
  }
  /* 搜索结果：最大高度收窄 */
  .search-results {
    max-height: 280px;
  }
}

/* 小屏幕（max-width: 768px）*/
@media (max-width: 768px) {
  /* 搜索面板：占据剩余空间 */
  .search-panel {
    max-width: none;
    flex: 1;
    min-width: 0;
    gap: 4px;
  }
  /* 搜索输入框：紧凑 */
  .search-input {
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 16px;
  }
  /* 搜索范围选择器：紧凑 */
  .search-scope {
    padding: 4px 4px;
    font-size: 10px;
    border-radius: 4px;
  }
  /* 搜索策略选择器：紧凑 */
  .search-strategy {
    padding: 4px 4px;
    font-size: 10px;
    border-radius: 4px;
  }
  /* 搜索按钮：紧凑 */
  .search-btn {
    padding: 5px 10px;
    font-size: 11px;
    border-radius: 16px;
    flex-shrink: 0;
  }
  /* 搜索结果：全宽固定定位显示 */
  .search-results {
    position: fixed;
    top: 44px;
    left: 0;
    width: 100%;
    max-height: 60vh;
    border-radius: 0;
    border-left: none;
    border-right: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  }
  /* 结果分组标题：紧凑 */
  .result-group-title {
    padding: 5px 10px;
    font-size: 10px;
  }
  /* 结果项：紧凑 */
  .result-item {
    padding: 8px 10px;
    font-size: 11px;
  }
  .result-item .title {
    font-size: 12px;
    max-width: calc(100% - 40px);
  }
  .result-item .meta {
    font-size: 10px;
  }
  .result-item .score {
    font-size: 10px;
  }
  /* 搜索结果为空提示：紧凑 */
  .result-empty {
    padding: 14px 10px;
    font-size: 11px;
  }
  /* 片段文字：紧凑 */
  .snippet {
    font-size: 11px;
    line-height: 1.4;
  }
}

/* 超小屏幕（max-width: 480px）*/
@media (max-width: 480px) {
  /* 搜索面板：最小间距 */
  .search-panel {
    gap: 3px;
  }
  /* 搜索输入框：最小 */
  .search-input {
    padding: 4px 8px;
    font-size: 11px;
  }
  /* 搜索按钮：最小 */
  .search-btn {
    padding: 4px 8px;
    font-size: 10px;
  }
  /* 搜索范围选择器：隐藏文字仅保留图标式紧凑 */
  .search-scope {
    padding: 4px 2px;
    font-size: 9px;
  }
  /* 搜索策略选择器：隐藏（超小屏空间不足时） */
  .search-strategy {
    display: none;
  }
}
</style>
