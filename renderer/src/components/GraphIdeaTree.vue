<script setup>
/**
 * GraphIdeaTree — 图谱节点列表中 Idea 栏的递归树项
 * 支持展开子 Idea（idea-hierarchy）、展开关联节点（idea-link/belong）
 * 支持切换该 Idea 是否在图谱中显示（includeInGraph）
 */
import { computed } from 'vue';

const props = defineProps({
  item: { type: Object, required: true },
  level: { type: Number, default: 0 },
  selectedId: { type: String, default: null },
  expandedHierarchyIds: { type: Set, default: () => new Set() },
  expandedLinksIds: { type: Set, default: () => new Set() },
  // Idea 可见性切换 loading 状态：切换期间禁用可见性按钮，防止重复点击（L-3）
  ideaToggling: { type: Boolean, default: false }
});

const emit = defineEmits([
  'select', 'toggle-hierarchy', 'toggle-links',
  'dblclick', 'toggle-visibility'
]);

const hasHierarchyChildren = computed(() => props.item.hierarchyChildren && props.item.hierarchyChildren.length > 0);
const hasLinkChildren = computed(() => props.item.linkChildren && props.item.linkChildren.length > 0);
const isHierarchyExpanded = computed(() => props.expandedHierarchyIds.has(props.item.id));
const isLinksExpanded = computed(() => props.expandedLinksIds.has(props.item.id));
const isSelected = computed(() => props.selectedId === props.item.id);
const isInGraph = computed(() => props.item.includeInGraph !== false);

const indentStyle = computed(() => ({
  paddingLeft: `${10 + props.level * 16}px`
}));

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

function onToggleVisibility(e) {
  e.stopPropagation();
  emit('toggle-visibility', props.item);
}

function onDblClick(e) {
  e.stopPropagation();
  emit('dblclick', props.item);
}
</script>

<template>
  <div class="idea-graph-tree-node" role="treeitem" :aria-expanded="hasHierarchyChildren ? isHierarchyExpanded : undefined" :aria-selected="isSelected">
    <div
      class="tree-row"
      :class="{ active: isSelected, 'not-in-graph': !isInGraph, 'is-idea': item.type === 'idea' }"
      :style="indentStyle"
      role="button"
      tabindex="0"
      :aria-label="item.label"
      @click="onClick"
      @dblclick="onDblClick"
      @keydown.enter="onClick"
    >
      <button
        v-if="hasHierarchyChildren"
        class="tree-chevron hierarchy"
        :class="{ expanded: isHierarchyExpanded }"
        :aria-expanded="isHierarchyExpanded"
        aria-label="展开/收起子 Idea"
        title="展开/收起子 Idea"
        @click="onToggleHierarchy"
      >
        <svg width="9" height="9" viewBox="0 0 10 10"><path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span v-else class="tree-chevron-placeholder" />
      <button
        v-if="hasLinkChildren"
        class="tree-chevron link"
        :class="{ expanded: isLinksExpanded }"
        :aria-expanded="isLinksExpanded"
        aria-label="展开/收起关联节点"
        title="展开/收起关联节点"
        @click="onToggleLinks"
      >
        <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 9L9 3M5 3h4v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span v-else class="tree-chevron-placeholder" />
      <span v-if="item.type === 'idea'" class="tree-icon idea-icon" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16"><path d="M8 1.5C5.5 1.5 4 3 4 5c0 1 .5 2 1 2.5C4 8 3 9.5 3 11c0 2 2 3.5 5 3.5s5-1.5 5-3.5c0-1.5-1-3-2-3.5.5-.5 1-1.5 1-2.5 0-2-1.5-3.5-4-3.5z" fill="currentColor"/></svg>
      </span>
      <span v-else-if="item.type === 'heading'" class="tree-icon heading-icon" aria-hidden="true">H</span>
      <span v-else-if="item.type === 'entity'" class="tree-icon entity-icon" aria-hidden="true">E</span>
      <span v-else-if="item.type === 'document'" class="tree-icon doc-icon" aria-hidden="true">D</span>
      <span v-else class="tree-icon default-icon" aria-hidden="true">•</span>
      <span class="tree-label">{{ item.label }}</span>
      <button
        v-if="item.type === 'idea'"
        class="tree-visibility-btn"
        :class="{ visible: isInGraph, 'is-toggling': ideaToggling }"
        :title="isInGraph ? '在图谱中显示（点击隐藏）' : '已隐藏（点击显示）'"
        :aria-label="isInGraph ? '在图谱中显示，点击隐藏' : '已隐藏，点击显示'"
        :aria-pressed="isInGraph"
        :disabled="ideaToggling"
        @click="onToggleVisibility"
      >
        <svg v-if="isInGraph" width="13" height="13" viewBox="0 0 16 16"><path d="M8 3C4 3 1 8 1 8s3 5 7 5 7-5 7-5-3-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
        <svg v-else width="13" height="13" viewBox="0 0 16 16"><path d="M2 2l12 12M8 3C4 3 1 8 1 8s3 5 7 5c1.5 0 2.8-.5 3.8-1.2M5 4.2C3 5 1 8 1 8s3 5 7 5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div v-if="hasHierarchyChildren && isHierarchyExpanded" class="tree-children">
      <GraphIdeaTree
        v-for="child in item.hierarchyChildren"
        :key="'h-' + child.id"
        :item="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-hierarchy-ids="expandedHierarchyIds"
        :expanded-links-ids="expandedLinksIds"
        :idea-toggling="ideaToggling"
        @select="emit('select', $event)"
        @toggle-hierarchy="emit('toggle-hierarchy', $event)"
        @toggle-links="emit('toggle-links', $event)"
        @dblclick="emit('dblclick', $event)"
        @toggle-visibility="emit('toggle-visibility', $event)"
      />
    </div>
    <div v-if="hasLinkChildren && isLinksExpanded" class="tree-children link-children">
      <GraphIdeaTree
        v-for="child in item.linkChildren"
        :key="'l-' + child.id"
        :item="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-hierarchy-ids="expandedHierarchyIds"
        :expanded-links-ids="expandedLinksIds"
        :idea-toggling="ideaToggling"
        @select="emit('select', $event)"
        @toggle-hierarchy="emit('toggle-hierarchy', $event)"
        @toggle-links="emit('toggle-links', $event)"
        @dblclick="emit('dblclick', $event)"
        @toggle-visibility="emit('toggle-visibility', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.idea-graph-tree-node {
  user-select: none;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px 4px 0;
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  transition: background 0.12s;
}
.tree-row:hover {
  background: var(--bg-hover, #eef2f7);
}
.tree-row.active {
  background: var(--accent-bg);
  color: var(--accent, #3b82f6);
}
.tree-row.not-in-graph {
  opacity: 0.4;
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
  cursor: pointer;
  transition: transform 0.15s;
  padding: 0;
  flex-shrink: 0;
  border-radius: 3px;
}
.tree-chevron:hover {
  background: var(--bg-hover);
}
.tree-chevron.expanded {
  transform: rotate(90deg);
}
.tree-chevron.link {
  color: var(--warning);
}
.tree-chevron.link.expanded {
  transform: rotate(0deg);
}
.tree-chevron-placeholder {
  width: 16px;
  flex-shrink: 0;
}
.tree-icon {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
}
.idea-icon {
  background: var(--tree-icon-idea);
  color: #fff;
}
.heading-icon {
  background: var(--tree-icon-heading);
}
.entity-icon {
  background: var(--tree-icon-entity);
}
.doc-icon {
  background: var(--tree-icon-doc);
}
.default-icon {
  background: var(--tree-icon-default);
}
.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-visibility-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 0.12s, color 0.12s;
}
.tree-row:hover .tree-visibility-btn {
  opacity: 0.7;
}
.tree-visibility-btn:hover {
  opacity: 1 !important;
  background: var(--bg-hover);
}
.tree-visibility-btn.visible {
  color: var(--tree-icon-visible);
  opacity: 0.6;
}
.tree-visibility-btn:disabled {
  cursor: wait;
  opacity: 0.5;
}
.tree-visibility-btn.is-toggling svg {
  animation: idea-toggle-spin 0.8s linear infinite;
}
@keyframes idea-toggle-spin {
  to { transform: rotate(360deg); }
}
.tree-children {
  position: relative;
}
.link-children {
  border-left: 2px dashed var(--tree-link-border);
  margin-left: 18px;
}
</style>
