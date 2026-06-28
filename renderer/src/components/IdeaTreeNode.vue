<script setup>
/** IdeaTreeNode — 递归展示 Idea 树，支持父子嵌套、添加子 Idea */
import { computed, ref } from 'vue';

const props = defineProps({
  node: { type: Object, required: true },
  activeId: { type: String, default: null },
  expandedIds: { type: Set, default: () => new Set() }
});
const emit = defineEmits(['select', 'delete', 'toggle', 'add-child']);

const isExpanded = computed(() => props.expandedIds.has(props.node.id));
const hasChildren = computed(() => props.node.children && props.node.children.length > 0);
const showAddForm = ref(false);
const newChildTitle = ref('');

function onAddChild() {
  const t = newChildTitle.value.trim();
  if (!t) {
    showAddForm.value = false;
    return;
  }
  emit('add-child', { parentId: props.node.id, title: t });
  newChildTitle.value = '';
  showAddForm.value = false;
  // 自动展开当前节点
  if (!props.expandedIds.has(props.node.id)) {
    emit('toggle', props.node.id);
  }
}
</script>

<template>
  <div class="idea-tree-node" role="treeitem" :aria-expanded="hasChildren ? isExpanded : undefined" :aria-selected="activeId === node.id">
    <div
      class="tree-item"
      :class="{ active: activeId === node.id, 'not-in-graph': node.includeInGraph === false }"
      role="button"
      tabindex="0"
      :aria-label="`Idea: ${node.title || '未命名'}`"
      @click="$emit('select', node.id)"
      @keydown.enter="$emit('select', node.id)"
    >
      <button
        v-if="hasChildren"
        class="tree-chevron"
        :class="{ expanded: isExpanded }"
        :aria-expanded="isExpanded"
        aria-label="展开/收起子 Idea"
        @click.stop="$emit('toggle', node.id)"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span v-else class="tree-chevron-placeholder" />
      <span class="icon-wrap" :style="{ background: node.color || '#f59e0b' }" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 16 16"><path d="M8 1.5C5.5 1.5 4 3 4 5c0 1 .5 2 1 2.5C4 8 3 9.5 3 11c0 2 2 3.5 5 3.5s5-1.5 5-3.5c0-1.5-1-3-2-3.5.5-.5 1-1.5 1-2.5 0-2-1.5-3.5-4-3.5z" fill="rgba(255,255,255,0.9)"/></svg>
      </span>
      <span class="label">{{ node.title || '未命名' }}</span>
      <span v-if="node.includeInGraph !== false" class="in-graph-dot" title="已加入知识图谱" aria-label="已加入知识图谱" />
      <button class="tree-action add-child" aria-label="添加子 Idea" title="添加子 Idea" @click.stop="showAddForm = !showAddForm">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button class="tree-action delete" aria-label="删除 Idea" title="删除" @click.stop="$emit('delete', node.id)">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>

    <!-- 添加子 Idea 表单 -->
    <div v-if="showAddForm" class="add-child-form">
      <input
        v-model="newChildTitle"
        placeholder="输入子 Idea 标题..."
        class="add-child-input"
        aria-label="子 Idea 标题"
        @keyup.enter="onAddChild"
        @keyup.esc="showAddForm = false"
      />
      <button class="btn-mini primary" @click="onAddChild">添加</button>
      <button class="btn-mini" @click="showAddForm = false">取消</button>
    </div>

    <!-- 递归子节点 -->
    <div v-if="hasChildren && isExpanded" class="idea-tree-children">
      <IdeaTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :active-id="activeId"
        :expanded-ids="expandedIds"
        @select="$emit('select', $event)"
        @delete="$emit('delete', $event)"
        @toggle="$emit('toggle', $event)"
        @add-child="$emit('add-child', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.idea-tree-node {
  user-select: none;
}
.tree-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.15s, box-shadow 0.15s;
  position: relative;
}
.tree-item:hover {
  background: var(--bg-hover, rgba(99, 102, 241, 0.06));
}
.tree-item.active {
  background: rgba(99, 102, 241, 0.12);
  box-shadow: inset 2px 0 0 var(--accent, #3b82f6);
}
.tree-item.not-in-graph {
  opacity: 0.45;
}
.tree-chevron {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: transform 0.2s ease;
  padding: 0;
  flex-shrink: 0;
  border-radius: 4px;
}
.tree-chevron:hover {
  background: var(--bg-hover);
}
.tree-chevron.expanded {
  transform: rotate(90deg);
}
.tree-chevron-placeholder {
  width: 18px;
  flex-shrink: 0;
}
.icon-wrap {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}
.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.in-graph-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
}
.tree-action {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 5px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.tree-item:hover .tree-action {
  opacity: 1;
}
.tree-action:hover {
  background: var(--bg-hover);
}
.tree-action.add-child {
  color: var(--accent, #3b82f6);
}
.tree-action.add-child:hover {
  background: rgba(99, 102, 241, 0.12);
  color: var(--accent, #3b82f6);
}
.tree-action.delete:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}
.add-child-form {
  display: flex;
  gap: 5px;
  padding: 6px 8px 6px 48px;
  animation: slideDown 0.2s ease;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.add-child-input {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  font-size: 12px;
  background: var(--bg-card, #fff);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.add-child-input:focus {
  border-color: var(--accent, #3b82f6);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}
.btn-mini {
  padding: 5px 10px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  background: var(--bg-card, #fff);
  color: var(--text-primary);
  transition: all 0.15s;
}
.btn-mini:hover {
  background: var(--bg-hover);
}
.btn-mini.primary {
  background: var(--accent, #3b82f6);
  color: #fff;
  border-color: var(--accent, #3b82f6);
}
.btn-mini.primary:hover {
  opacity: 0.9;
}
.idea-tree-children {
  padding-left: 18px;
  position: relative;
}
.idea-tree-children::before {
  content: '';
  position: absolute;
  left: 18px;
  top: 0;
  bottom: 4px;
  width: 1px;
  background: var(--border-color, #e5e7eb);
}
</style>
