<script setup>
/**
 * GraphNodeTree — 知识图谱下方分级展开列表的递归树项
 * 与 GraphView 联动：单击选中、双击跳转
 * 展开分为“次级标题（层级）”和“link 邻居”两个独立按钮
 */
import { computed } from 'vue';

const props = defineProps({
  item: { type: Object, required: true },
  level: { type: Number, default: 0 },
  selectedId: { type: String, default: null },
  expandedHierarchyIds: { type: Set, default: () => new Set() },
  expandedLinksIds: { type: Set, default: () => new Set() }
});

const emit = defineEmits(['select', 'toggle-hierarchy', 'toggle-links', 'dblclick', 'build-graph', 'contextmenu']);

const hasHierarchyChildren = computed(() => props.item.hierarchyChildren && props.item.hierarchyChildren.length > 0);
const hasLinkChildren = computed(() => props.item.linkChildren && props.item.linkChildren.length > 0);
const isHierarchyExpanded = computed(() => props.expandedHierarchyIds.has(props.item.id));
const isLinksExpanded = computed(() => props.expandedLinksIds.has(props.item.id));
const isSelected = computed(() => props.selectedId === props.item.id);

const docId = computed(() => {
  if (props.item.type !== 'document') return null;
  return props.item.source?.docId || props.item.id.replace(/^doc-/, '');
});

const indentStyle = computed(() => ({
  paddingLeft: `${12 + props.level * 16}px`
}));

function iconFor(type) {
  if (type === 'document') return '📄';
  if (type === 'heading') return '📑';
  if (type === 'idea') return '💡';
  if (type === 'question') return '❓';
  return '🔹';
}

function onClick() {
  emit('select', props.item);
}

function onToggleHierarchy(e) {
  e.stopPropagation();
  emit('toggle-hierarchy', props.item);
}

function onToggleLinks(e) {
  e.stopPropagation();
  emit('toggle-links', props.item);
}

function onDblClick(e) {
  e.stopPropagation();
  emit('dblclick', props.item);
}

function onBuildGraph(e) {
  e.stopPropagation();
  if (docId.value) emit('build-graph', docId.value);
}

function onContextMenu(e) {
  e.stopPropagation();
  e.preventDefault();
  emit('contextmenu', props.item, e);
}
</script>

<template>
  <div class="tree-node" role="treeitem" :aria-expanded="hasHierarchyChildren ? isHierarchyExpanded : undefined" :aria-selected="isSelected">
    <div
      class="tree-row"
      :class="{ active: isSelected }"
      :style="indentStyle"
      role="button"
      tabindex="0"
      :aria-label="`${item.label}${item.level ? '，层级 ' + item.level : ''}`"
      @click="onClick"
      @dblclick="onDblClick"
      @keydown.enter="onClick"
      @contextmenu.prevent.stop="onContextMenu"
    >
      <button
        v-if="hasHierarchyChildren"
        class="tree-chevron hierarchy"
        :class="{ expanded: isHierarchyExpanded }"
        :aria-expanded="isHierarchyExpanded"
        aria-label="展开/收起次级标题"
        title="展开/收起次级标题"
        @click="onToggleHierarchy"
      >▶</button>
      <span v-else class="tree-chevron-placeholder" />
      <button
        v-if="hasLinkChildren"
        class="tree-chevron link"
        :class="{ expanded: isLinksExpanded }"
        :aria-expanded="isLinksExpanded"
        aria-label="展开/收起 link 邻居"
        title="展开/收起 link 邻居"
        @click="onToggleLinks"
      >↗</button>
      <span v-else class="tree-chevron-placeholder" />
      <span class="tree-icon" aria-hidden="true">{{ iconFor(item.type) }}</span>
      <span class="tree-label">{{ item.label }}</span>
      <span v-if="item.level" class="tree-meta" aria-hidden="true">L{{ item.level }}</span>
      <button
        v-if="docId"
        class="tree-build-btn"
        aria-label="生成/重新生成该文档知识图谱"
        title="生成/重新生成该文档知识图谱"
        @click="onBuildGraph"
      >⚡</button>
    </div>
    <div v-if="hasHierarchyChildren && isHierarchyExpanded" class="tree-children">
      <GraphNodeTree
        v-for="child in item.hierarchyChildren"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-hierarchy-ids="expandedHierarchyIds"
        :expanded-links-ids="expandedLinksIds"
        @select="emit('select', $event)"
        @toggle-hierarchy="emit('toggle-hierarchy', $event)"
        @toggle-links="emit('toggle-links', $event)"
        @dblclick="emit('dblclick', $event)"
        @build-graph="emit('build-graph', $event)"
        @contextmenu="emit('contextmenu', $event)"
      />
    </div>
    <div v-if="hasLinkChildren && isLinksExpanded" class="tree-children">
      <GraphNodeTree
        v-for="child in item.linkChildren"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-hierarchy-ids="expandedHierarchyIds"
        :expanded-links-ids="expandedLinksIds"
        @select="emit('select', $event)"
        @toggle-hierarchy="emit('toggle-hierarchy', $event)"
        @toggle-links="emit('toggle-links', $event)"
        @dblclick="emit('dblclick', $event)"
        @build-graph="emit('build-graph', $event)"
        @contextmenu="emit('contextmenu', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-node {
  user-select: none;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px 5px 0;
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-primary);
  transition: background 0.12s;
}
.tree-row:hover {
  background: var(--bg-hover);
}
.tree-row.active {
  background: var(--bg-active);
  color: var(--accent);
}
.tree-chevron {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  font-size: 10px;
  cursor: pointer;
  transition: transform 0.15s, color 0.12s;
  padding: 0;
  flex-shrink: 0;
}
.tree-chevron.expanded {
  transform: rotate(90deg);
}
.tree-chevron.link {
  font-size: 11px;
  transform: none;
}
.tree-chevron.link.expanded {
  transform: rotate(0deg);
  color: var(--accent);
}
.tree-chevron:hover {
  color: var(--accent);
}
.tree-chevron-placeholder {
  width: 16px;
  flex-shrink: 0;
}
.tree-icon {
  font-size: 12px;
  flex-shrink: 0;
}
.tree-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-meta {
  font-size: 10px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.tree-build-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  flex-shrink: 0;
  margin-left: 2px;
}
.tree-row:hover .tree-build-btn {
  opacity: 1;
}
.tree-build-btn:hover {
  background: var(--accent);
  color: #fff;
}
</style>
