<template>
  <div class="node-tree">
    <!-- ===== Header ===== -->
    <div class="node-tree__header">
      <div class="header-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="6" height="6" rx="1"/>
          <rect x="15" y="3" width="6" height="6" rx="1"/>
          <rect x="9" y="15" width="6" height="6" rx="1"/>
          <path d="M6 9v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/>
          <path d="M12 14v1"/>
        </svg>
        <span>知识节点</span>
        <span class="header-count">{{ graphStore.nodes.length }}</span>
      </div>
    </div>

    <!-- ===== Search ===== -->
    <div class="node-tree__search">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索节点..."
      />
      <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''" title="清除">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
    </div>

    <!-- ===== Body ===== -->
    <div class="node-tree__body" v-if="graphStore.nodes.length">
      <div v-for="group in groups" :key="group.type" class="node-group">
        <div class="group-header" @click="toggleGroup(group.type)">
          <svg
            class="chevron"
            :class="{ 'chevron--collapsed': collapsed[group.type] }"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          >
            <polyline points="9 6 15 12 9 18"/>
          </svg>
          <span class="group-dot" :style="{ background: group.color, boxShadow: `0 0 7px ${group.color}` }"></span>
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.nodes.length }}</span>
        </div>

        <transition name="group-collapse">
          <div v-show="!collapsed[group.type]" class="group-items">
            <div
              v-for="node in group.nodes"
              :key="node.id"
              class="node-item"
              :class="{ 'node-item--active': isSelected(node) }"
              @click="selectNode(node)"
            >
              <span class="node-bar" :style="{ background: group.color }"></span>
              <span class="node-name">{{ nodeLabel(node) }}</span>
              <span
                v-if="node.specificity != null"
                class="node-badge"
                :style="{ color: group.color, background: group.color + '22' }"
                :title="'specificity: ' + specificityText(node)"
              >{{ specificityText(node) }}</span>
            </div>
          </div>
        </transition>
      </div>

      <div v-if="!groups.length" class="no-match">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4">
          <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>未找到匹配节点</p>
      </div>
    </div>

    <!-- ===== Empty state ===== -->
    <div v-else class="empty-state node-tree-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
        <line x1="12" y1="7" x2="5.8" y2="17"/><line x1="12" y1="7" x2="18.2" y2="17"/>
      </svg>
      <p>暂无节点</p>
      <p class="empty-hint">构建图谱后在此显示</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { useGraphStore } from '../stores'

const graphStore = useGraphStore()

// ===== Type metadata =====
const TYPE_COLORS = {
  concept: '#06b6d4',
  method: '#8b5cf6',
  theorem: '#f59e0b',
  term: '#10b981',
  entity: '#06b6d4',    // cyan — 实体节点
  document: '#64748b',  // slate — 文档节点
  idea: '#f43f5e',      // rose — 灵感节点
  other: '#f43f5e',
}
const TYPE_LABELS = {
  concept: '概念',
  method: '方法',
  theorem: '定理',
  term: '术语',
  entity: '实体',
  document: '文档',
  idea: '灵感',
  other: '其他',
}
const TYPE_ORDER = ['entity', 'document', 'idea', 'concept', 'method', 'theorem', 'term', 'other']

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.other
}
function labelFor(type) {
  return TYPE_LABELS[type] || '其他'
}

// ===== Search =====
const searchQuery = ref('')

// ===== Group collapse state (default: expanded) =====
const collapsed = reactive({})
function toggleGroup(type) {
  collapsed[type] = !collapsed[type]
}

// ===== Computed grouped nodes =====
const groups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const buckets = {}

  graphStore.nodes.forEach((n) => {
    const text = nodeLabel(n).toLowerCase()
    if (q && !text.includes(q)) return
    const type = n.type || 'other'
    if (!buckets[type]) buckets[type] = []
    buckets[type].push(n)
  })

  // return in canonical order
  return TYPE_ORDER
    .filter((t) => buckets[t] && buckets[t].length)
    .map((t) => ({
      type: t,
      label: labelFor(t),
      color: colorFor(t),
      nodes: buckets[t],
    }))
    .concat(
      Object.keys(buckets)
        .filter((t) => !TYPE_ORDER.includes(t))
        .map((t) => ({ type: t, label: labelFor(t), color: colorFor(t), nodes: buckets[t] }))
    )
})

// ===== Helpers =====
function nodeLabel(node) {
  return node.label || node.name || node.id || '未命名'
}
function specificityText(node) {
  const s = Number(node.specificity)
  if (isNaN(s)) return '—'
  return s.toFixed(2)
}
function isSelected(node) {
  return graphStore.selectedNode && graphStore.selectedNode.id === node.id
}

// ===== Actions =====
function selectNode(node) {
  graphStore.selectedNode = node
}
</script>

<style scoped>
.node-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-card);
}

/* ===== Header ===== */
.node-tree__header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.header-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.header-title svg { color: var(--accent); flex-shrink: 0; }
.header-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 8px;
  border-radius: 10px;
  min-width: 22px;
  text-align: center;
}

/* ===== Search ===== */
.node-tree__search {
  position: relative;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.node-tree__search > svg {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 6px 26px 6px 28px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  transition: border 0.15s;
}
.search-input::placeholder { color: var(--text-3); }
.search-input:focus { outline: none; border-color: var(--accent); }
.search-clear {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-3); border-radius: 4px;
  transition: color 0.15s;
}
.search-clear:hover { color: var(--text); }

/* ===== Body ===== */
.node-tree__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0 12px;
}

.node-group { margin-bottom: 2px; }

.group-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.group-header:hover { background: var(--bg-hover); }
.chevron {
  color: var(--text-3);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.chevron--collapsed { transform: rotate(0deg); }
.chevron:not(.chevron--collapsed) { transform: rotate(90deg); }

.group-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
}
.group-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-transform: none;
}
.group-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-3);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.group-items {
  padding: 2px 0 6px;
}

.node-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px 5px 22px;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}
.node-item:hover { background: var(--bg-hover); }
.node-item--active { background: var(--accent-dim); }
.node-item--active .node-name { color: var(--text); font-weight: 500; }

.node-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
  opacity: 0.7;
}
.node-item--active .node-bar { opacity: 1; box-shadow: 0 0 6px currentColor; }

.node-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.12s;
}

.node-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  line-height: 1.4;
}

/* collapse transition */
.group-collapse-enter-active,
.group-collapse-leave-active {
  transition: max-height 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
}
.group-collapse-enter-from,
.group-collapse-leave-to {
  max-height: 0;
  opacity: 0;
}
.group-collapse-enter-to,
.group-collapse-leave-from {
  max-height: 600px;
  opacity: 1;
}

/* no match */
.no-match {
  text-align: center;
  padding: 30px 16px;
  color: var(--text-3);
}
.no-match p { font-size: 12px; margin-top: 8px; }

/* empty */
.node-tree-empty {
  padding: 48px 20px;
  text-align: center;
}
.node-tree-empty svg {
  color: var(--text-3);
  opacity: 0.3;
  margin-bottom: 10px;
}
.node-tree-empty p { font-size: 13px; color: var(--text-3); }
.empty-hint { font-size: 11px; margin-top: 3px; color: var(--text-3); opacity: 0.7; }
</style>
