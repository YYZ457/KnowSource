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

    <!-- ===== Visibility toggles ===== -->
    <div class="node-tree__toggles">
      <label class="toggle-row" title="在图谱中显示灵感胶囊节点">
        <input
          type="checkbox"
          :checked="uiStore.showIdeasInGraph"
          @change="uiStore.setShowIdeasInGraph($event.target.checked)"
        />
        <span class="toggle-pill toggle-pill--idea"></span>
        <span class="toggle-label">显示灵感</span>
        <span class="toggle-count">{{ ideaNodes.length }}</span>
      </label>
    </div>

    <!-- ===== Body ===== -->
    <div class="node-tree__body" v-if="graphStore.nodes.length">
      <!-- Hierarchical tree: 文档 → 章节 → 实体 -->
      <div v-for="docNode in tree" :key="docNode.id" class="node-group">
        <!-- Document level -->
        <div
          class="group-header group-header--doc"
          @click="toggleGroup(docNode.id)"
        >
          <svg
            class="chevron"
            :class="{ 'chevron--collapsed': collapsed[docNode.id] }"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          >
            <polyline points="9 6 15 12 9 18"/>
          </svg>
          <span class="group-dot" :style="{ background: docNode.color, boxShadow: `0 0 7px ${docNode.color}` }"></span>
          <span class="group-label">{{ docNode.label }}</span>
          <span class="group-count">{{ docNode.totalCount }}</span>
        </div>

        <transition name="group-collapse">
          <div v-show="!collapsed[docNode.id]" class="group-items">
            <!-- Heading level -->
            <div v-for="heading in docNode.headings" :key="heading.id" class="sub-group">
              <div
                class="sub-header"
                @click="toggleGroup(heading.id)"
              >
                <svg
                  class="chevron chevron--sm"
                  :class="{ 'chevron--collapsed': collapsed[heading.id] }"
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                >
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <span class="sub-bar" :style="{ background: docNode.color }"></span>
                <span class="sub-label">{{ heading.label }}</span>
                <span v-if="heading.entities.length" class="sub-count">{{ heading.entities.length }}</span>
              </div>

              <transition name="group-collapse">
                <div v-show="!collapsed[heading.id]" class="entity-items">
                  <div
                    v-for="entity in heading.entities"
                    :key="entity.id"
                    class="node-item"
                    :class="{ 'node-item--active': isSelected(entity) }"
                    :style="{ '--node-color': docNode.color }"
                    @click="selectNode(entity)"
                  >
                    <span class="node-bar" :style="{ background: docNode.color }"></span>
                    <span class="node-name">{{ nodeLabel(entity) }}</span>
                    <span
                      v-if="entity.specificity != null"
                      class="node-badge"
                      :style="{ color: docNode.color, background: docNode.color + '22' }"
                    >{{ specificityText(entity) }}</span>
                  </div>
                </div>
              </transition>
            </div>

            <!-- Orphan entities (not linked to any heading) -->
            <div v-if="docNode.orphanEntities.length" class="sub-group">
              <div
                class="sub-header sub-header--orphan"
                @click="toggleGroup(docNode.id + '_orphan')"
              >
                <svg
                  class="chevron chevron--sm"
                  :class="{ 'chevron--collapsed': collapsed[docNode.id + '_orphan'] }"
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                >
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
                <span class="sub-bar" :style="{ background: docNode.color, opacity: 0.4 }"></span>
                <span class="sub-label sub-label--muted">未归属实体</span>
                <span class="sub-count">{{ docNode.orphanEntities.length }}</span>
              </div>
              <transition name="group-collapse">
                <div v-show="!collapsed[docNode.id + '_orphan']" class="entity-items">
                  <div
                    v-for="entity in docNode.orphanEntities"
                    :key="entity.id"
                    class="node-item"
                    :class="{ 'node-item--active': isSelected(entity) }"
                    :style="{ '--node-color': docNode.color }"
                    @click="selectNode(entity)"
                  >
                    <span class="node-bar" :style="{ background: docNode.color, opacity: 0.5 }"></span>
                    <span class="node-name">{{ nodeLabel(entity) }}</span>
                  </div>
                </div>
              </transition>
            </div>
          </div>
        </transition>
      </div>

      <!-- Idea nodes -->
      <div v-if="ideaNodes.length" class="node-group">
        <div
          class="group-header group-header--idea"
          @click="toggleGroup('_idea')"
        >
          <svg
            class="chevron"
            :class="{ 'chevron--collapsed': collapsed['_idea'] }"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          >
            <polyline points="9 6 15 12 9 18"/>
          </svg>
          <span class="group-dot group-dot--pill" :style="{ background: '#f43f5e', boxShadow: '0 0 7px #f43f5e' }"></span>
          <span class="group-label">灵感</span>
          <span class="group-count">{{ ideaNodes.length }}</span>
        </div>
        <transition name="group-collapse">
          <div v-show="!collapsed['_idea']" class="group-items">
            <div
              v-for="node in ideaNodes"
              :key="node.id"
              class="node-item node-item--idea"
              :class="{ 'node-item--active': isSelected(node) }"
              :style="{ '--node-color': node.color || '#f43f5e' }"
              @click="selectNode(node)"
            >
              <span class="node-bar node-bar--pill" :style="{ background: node.color || '#f43f5e' }"></span>
              <span class="node-name">{{ nodeLabel(node) }}</span>
            </div>
          </div>
        </transition>
      </div>

      <!-- Non-document nodes (manual nodes, etc.) -->
      <div v-if="otherNodes.length" class="node-group">
        <div
          class="group-header group-header--other"
          @click="toggleGroup('_other')"
        >
          <svg
            class="chevron"
            :class="{ 'chevron--collapsed': collapsed['_other'] }"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          >
            <polyline points="9 6 15 12 9 18"/>
          </svg>
          <span class="group-dot" :style="{ background: '#14b8a6', boxShadow: '0 0 7px #14b8a6' }"></span>
          <span class="group-label">其他节点</span>
          <span class="group-count">{{ otherNodes.length }}</span>
        </div>
        <transition name="group-collapse">
          <div v-show="!collapsed['_other']" class="group-items">
            <div
              v-for="node in otherNodes"
              :key="node.id"
              class="node-item"
              :class="{ 'node-item--active': isSelected(node) }"
              :style="{ '--node-color': colorFor(node.type) }"
              @click="selectNode(node)"
            >
              <span class="node-bar" :style="{ background: colorFor(node.type) }"></span>
              <span class="node-name">{{ nodeLabel(node) }}</span>
            </div>
          </div>
        </transition>
      </div>

      <div v-if="!tree.length && !otherNodes.length" class="no-match">
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
import { useGraphStore, useUiStore, useIdeaStore } from '../stores'

const graphStore = useGraphStore()
const uiStore = useUiStore()
const ideaStore = useIdeaStore()

// ===== Type metadata =====
const TYPE_COLORS = {
  concept: '#06b6d4',
  method: '#8b5cf6',
  theorem: '#f59e0b',
  term: '#10b981',
  entity: '#06b6d4',    // cyan — 实体节点
  document: '#64748b',  // slate — 文档节点
  idea: '#f43f5e',      // rose — 灵感节点
  heading: '#3b82f6',   // blue — 标题节点
  manual: '#14b8a6',    // teal — 手册节点
  other: '#f43f5e',
}

// Document color palette (matched with GraphView)
const DOC_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#3b82f6', '#ec4899', '#14b8a6']

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.other
}

function docColorForIndex(idx) {
  return DOC_COLORS[idx % DOC_COLORS.length]
}

// ===== Search =====
const searchQuery = computed({
  get: () => uiStore.searchQuery || '',
  set: (v) => { uiStore.searchQuery = v }
})

// ===== Group collapse state =====
const collapsed = reactive({})
function toggleGroup(key) {
  collapsed[key] = !collapsed[key]
}

// ===== Build hierarchical tree: 文档 → 章节 → 实体 =====
function getDocId(node) {
  return node.docId || node.source?.docId || node.meta?.docId || null
}

function getHeadingIndex(node) {
  // Heading IDs are like "h_doc-xxxx_N" — extract N for ordering
  const m = node.id && node.id.match(/_+(\d+)$/)
  return m ? parseInt(m[1], 10) : 999
}

const tree = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const nodes = graphStore.nodes
  const edges = graphStore.edges

  // 1. Collect document nodes
  const docNodes = nodes.filter(n => n.type === 'document')
  // Assign colors by document order
  const docColorMap = {}
  docNodes.forEach((d, i) => { docColorMap[d.id] = docColorForIndex(i) })

  // 2. Build heading→entity map from "contains" edges
  const headingToEntities = {}  // headingId → [entityId]
  const entityToHeading = {}    // entityId → headingId
  for (const e of edges) {
    const src = typeof e.source === 'string' ? e.source : e.source?.id
    const tgt = typeof e.target === 'string' ? e.target : e.target?.id
    const rel = e.type || e.relation || ''
    if (rel === 'contains' && src && tgt) {
      // Check if source is a heading and target is an entity
      const srcNode = nodes.find(n => n.id === src)
      const tgtNode = nodes.find(n => n.id === tgt)
      if (srcNode && tgtNode && srcNode.type === 'heading' && tgtNode.type === 'entity') {
        if (!headingToEntities[src]) headingToEntities[src] = []
        headingToEntities[src].push(tgt)
        entityToHeading[tgt] = src
      }
    }
  }

  // 3. Group headings by docId, sort by index
  const headingsByDoc = {}  // docId → [heading nodes]
  for (const n of nodes) {
    if (n.type !== 'heading') continue
    const did = getDocId(n)
    if (!did) continue
    if (!headingsByDoc[did]) headingsByDoc[did] = []
    headingsByDoc[did].push(n)
  }
  // Sort headings by their index
  for (const did of Object.keys(headingsByDoc)) {
    headingsByDoc[did].sort((a, b) => getHeadingIndex(a) - getHeadingIndex(b))
  }

  // 4. Group entities by docId (for orphan detection)
  const entitiesByDoc = {}  // docId → [entity nodes]
  for (const n of nodes) {
    if (n.type !== 'entity') continue
    const did = getDocId(n)
    if (!did) continue
    if (!entitiesByDoc[did]) entitiesByDoc[did] = []
    entitiesByDoc[did].push(n)
  }

  // 5. Build the tree
  const result = []
  for (const doc of docNodes) {
    const did = doc.id
    const color = docColorMap[did] || '#64748b'
    const docLabel = nodeLabel(doc)
    // Filter by search query
    if (q && !docLabel.toLowerCase().includes(q)) {
      // Document doesn't match — but its children might; we still include it
      // but only show matching children
    }

    const headings = (headingsByDoc[did] || []).map(h => {
      const entityIds = headingToEntities[h.id] || []
      let entities = entityIds
        .map(eid => nodes.find(n => n.id === eid))
        .filter(Boolean)
      // Apply search filter
      if (q) {
        const hLabel = nodeLabel(h).toLowerCase()
        entities = entities.filter(e => nodeLabel(e).toLowerCase().includes(q))
        if (!hLabel.includes(q) && entities.length === 0) return null
      }
      // Sort entities alphabetically
      entities.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b), 'zh'))
      return {
        id: h.id,
        label: nodeLabel(h),
        entities,
      }
    }).filter(Boolean)

    // Orphan entities (belong to this doc but not linked to any heading)
    const allDocEntities = entitiesByDoc[did] || []
    const orphanEntities = allDocEntities.filter(e => !entityToHeading[e.id])
    // Apply search filter
    let filteredOrphans = orphanEntities
    if (q) {
      filteredOrphans = orphanEntities.filter(e => nodeLabel(e).toLowerCase().includes(q))
    }
    filteredOrphans.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b), 'zh'))

    // Skip document if no visible children and doc doesn't match search
    const hasVisibleChildren = headings.length > 0 || filteredOrphans.length > 0
    if (q && !docLabel.toLowerCase().includes(q) && !hasVisibleChildren) continue

    const totalCount = headings.reduce((sum, h) => sum + h.entities.length, 0) + filteredOrphans.length + headings.length

    result.push({
      id: did,
      label: docLabel,
      color,
      headings,
      orphanEntities: filteredOrphans,
      totalCount,
    })
  }

  return result
})

// ===== Idea nodes =====
const ideaNodes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return graphStore.nodes.filter(n => {
    if (n.type !== 'idea') return false
    if (q && !nodeLabel(n).toLowerCase().includes(q)) return false
    return true
  })
})

// ===== Other nodes (manual, etc. that are not document/heading/entity/idea) =====
const otherNodes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return graphStore.nodes.filter(n => {
    if (n.type === 'document' || n.type === 'heading' || n.type === 'entity' || n.type === 'idea') return false
    if (q && !nodeLabel(n).toLowerCase().includes(q)) return false
    return true
  })
})

// ===== Helpers =====
function nodeLabel(node) {
  return node.content || node.label || node.name || node.id || '未命名'
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
.group-header--doc {
  font-weight: 600;
}
.chevron {
  color: var(--text-3);
  transition: transform 0.2s ease;
  flex-shrink: 0;
}
.chevron--sm {
  color: var(--text-3);
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* ===== Sub-group (heading level) ===== */
.sub-group {
  margin-left: 8px;
}
.sub-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px 5px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.sub-header:hover { background: var(--bg-hover); }
.sub-bar {
  width: 3px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
  opacity: 0.6;
}
.sub-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub-label--muted {
  color: var(--text-3);
  font-style: italic;
}
.sub-count {
  margin-left: auto;
  font-size: 9px;
  color: var(--text-3);
  font-weight: 500;
}

.entity-items {
  padding: 1px 0 4px;
}

.node-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px 4px 28px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  position: relative;
  border-radius: 0 8px 8px 0;
  margin-right: 6px;
}
.node-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 0;
  background: var(--node-color, var(--accent));
  border-radius: 0 3px 3px 0;
  transition: height 0.2s ease;
}
.node-item:hover {
  background: var(--bg-hover);
  transform: translateX(3px);
}
.node-item--active {
  background: rgba(6, 182, 212, 0.14);
  transform: translateX(5px) scale(1.02);
  box-shadow: 0 2px 12px rgba(6, 182, 212, 0.22),
              0 0 0 1px rgba(6, 182, 212, 0.10);
}
.node-item--active::before {
  height: 70%;
}
.node-item--active .node-name {
  color: var(--text);
  font-weight: 700;
}

.node-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.18s ease, height 0.18s ease, box-shadow 0.18s ease;
}
.node-item:hover .node-bar { opacity: 0.9; }
.node-item--active .node-bar {
  opacity: 1;
  height: 18px;
  box-shadow: 0 0 8px var(--node-color, currentColor);
}

.node-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.18s ease, font-weight 0.18s ease;
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
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.node-item--active .node-badge {
  transform: scale(1.05);
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
  max-height: 800px;
  opacity: 1;
}

/* no match */
.no-match {
  text-align: center;
  padding: 30px 16px;
  color: var(--text-3);
}
.no-match p { font-size: 12px; margin-top: 8px; }

/* ===== Visibility toggles ===== */
.node-tree__toggles {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-2);
  user-select: none;
}
.toggle-row input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-pill {
  width: 28px;
  height: 14px;
  border-radius: 7px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  position: relative;
  transition: background 0.2s, border-color 0.2s;
}
.toggle-pill::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-3);
  transition: transform 0.2s, background 0.2s;
}
.toggle-row input:checked + .toggle-pill {
  background: #f43f5e22;
  border-color: #f43f5e88;
}
.toggle-row input:checked + .toggle-pill::after {
  transform: translateX(14px);
  background: #f43f5e;
}
.toggle-pill--idea { background: #f43f5e15; border-color: #f43f5e55; }
.toggle-label { flex: 1; }
.toggle-count {
  font-size: 10px;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 7px;
  border-radius: 10px;
}

/* Idea group styling */
.group-header--idea .group-dot--pill {
  border-radius: 4px;
  width: 12px;
  height: 6px;
}
.node-item--idea {
  border-radius: 12px;
  margin-right: 10px;
  margin-left: 4px;
}
.node-bar--pill {
  border-radius: 2px;
  height: 10px;
}

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
