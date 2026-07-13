<template>
  <!-- 灵感管理面板：listOnly 仅列表 / editorOnly 仅编辑器 / 默认两者并存 -->
  <div class="idea-panel" :class="{ 'idea-panel--dual': showList && showEditor }">
    <!-- ===== 列表模式 ===== -->
    <div v-if="showList" class="panel ip-list">
      <div class="panel__header">
        <h2>Idea 灵感</h2>
        <button class="btn btn--sm btn--primary" @click="onCreate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          新建
        </button>
      </div>
      <div class="panel__body ip-cards">
        <div v-if="ideaStore.loading && !ideaStore.ideas.length" class="empty-state">
          <span class="spinner"></span>
          <p>加载中...</p>
        </div>
        <div v-else-if="!ideaStore.ideas.length" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>
          <p>还没有灵感记录<br />点击「新建」开始记录</p>
        </div>
        <template v-else>
          <div
            v-for="idea in ideaStore.ideas"
            :key="idea.id"
            class="ip-card"
            :class="{ 'ip-card--active': isSelected(idea) }"
            @click="onSelect(idea)"
          >
            <div class="ip-card__title">{{ idea.title || '未命名灵感' }}</div>
            <div class="ip-card__preview">{{ preview(idea) }}</div>
            <div v-if="ideaTags(idea).length" class="ip-card__tags">
              <span v-for="tag in ideaTags(idea)" :key="tag" class="tag tag--cyan">{{ tag }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ===== 编辑器模式 ===== -->
    <div v-if="showEditor" class="panel ip-editor">
      <div class="panel__header">
        <h2>{{ editorTitle }}</h2>
        <div class="ip-editor__actions" v-if="ideaStore.selectedIdea">
          <button class="btn btn--sm btn--danger" @click="onDelete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            删除
          </button>
        </div>
      </div>
      <div class="panel__body">
        <div v-if="!ideaStore.selectedIdea" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
          <p>选择一个灵感或新建灵感<br />在此编辑内容</p>
        </div>
        <template v-else>
          <div class="field">
            <label>标题</label>
            <input type="text" v-model="ideaStore.selectedIdea.title" placeholder="灵感标题" />
          </div>
          <div class="field">
            <label>内容</label>
            <textarea
              v-model="ideaStore.selectedIdea.content"
              rows="10"
              placeholder="记录你的灵感、思路与发现..."
            ></textarea>
          </div>
          <div class="field">
            <label>标签（逗号分隔）</label>
            <input
              type="text"
              v-model="tagInputStr"
              @blur="onTagsBlur"
              placeholder="知识图谱, 待验证"
            />
          </div>

          <!-- 关联信息 -->
          <div v-if="ideaStore.selectedIdea.nodeId || ideaStore.selectedIdea.node_id" class="ip-linked">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>
            <span>已关联节点：{{ ideaStore.selectedIdea.nodeLabel || ideaStore.selectedIdea.node_label || ideaStore.selectedIdea.nodeId || ideaStore.selectedIdea.node_id }}</span>
          </div>

          <div class="actions">
            <button class="btn btn--primary" :disabled="saving" @click="onSave">
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button class="btn" :disabled="linking" @click="onLinkNode">
              {{ linking ? '关联中...' : '关联节点' }}
            </button>
          </div>
          <div v-if="linkMsg" class="hint" :class="{ 'hint--err': linkErr, 'hint--ok': !linkErr }">{{ linkMsg }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useIdeaStore, useGraphStore, useUiStore } from '../stores'
import { ideaApi } from '../api/client'

const props = defineProps({
  listOnly: { type: Boolean, default: false },
  editorOnly: { type: Boolean, default: false },
})

const ideaStore = useIdeaStore()
const graphStore = useGraphStore()
const uiStore = useUiStore()

// 模式判定：listOnly 仅列表 / editorOnly 仅编辑器 / 默认两者并存
const showList = computed(() => !props.editorOnly)
const showEditor = computed(() => !props.listOnly)

const editorTitle = computed(() => {
  if (props.listOnly) return 'Idea 灵感'
  return ideaStore.selectedIdea ? '编辑灵感' : '灵感详情'
})

function isSelected(idea) {
  return ideaStore.selectedIdea?.id === idea.id
}

function cloneIdea(idea) {
  if (!idea) return null
  // Pinia exposes list entries as Vue reactive proxies. Passing a proxy
  // directly to structuredClone throws DataCloneError in Chromium, which
  // made clicking an existing idea silently fail before the editor opened.
  // JSON cloning also matches the plain-data shape returned by the API.
  return JSON.parse(JSON.stringify(idea))
}

function onSelect(idea) {
  // 编辑草稿与列表数据隔离，只有保存成功后才同步到列表。
  ideaStore.selectedIdea = cloneIdea(idea)
}

function preview(idea) {
  const c = idea.content || ''
  return c.trim() ? c.trim().slice(0, 90) + (c.length > 90 ? '…' : '') : '暂无内容'
}

function ideaTags(idea) {
  const t = idea.tags
  if (Array.isArray(t)) return t.filter(Boolean)
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

const tagsString = computed(() => {
  const idea = ideaStore.selectedIdea
  if (!idea) return ''
  return ideaTags(idea).join(', ')
})

// 标签输入使用本地字符串，避免每次输入时立即分割导致逗号被吞掉
const tagInputStr = ref('')
watch(tagsString, (v) => { tagInputStr.value = v }, { immediate: true })

function onTagsInput(e) {
  tagInputStr.value = e.target.value
}

function onTagsBlur() {
  const idea = ideaStore.selectedIdea
  if (!idea) return
  idea.tags = tagInputStr.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ===== 操作 =====
const saving = ref(false)
const linking = ref(false)
const linkMsg = ref('')
const linkErr = ref(false)

async function onCreate() {
  try {
    const idea = await ideaStore.create({
      title: '新建灵感',
      content: '',
      tags: [],
    })
    if (idea && idea.id) {
      ideaStore.selectedIdea = cloneIdea(idea)
      uiStore.toast('已新建灵感', 'success')
    } else {
      uiStore.toast('新建灵感失败', 'error')
    }
  } catch (e) {
    uiStore.toast('新建失败：' + e.message, 'error')
  }
}

async function onSave() {
  const idea = ideaStore.selectedIdea
  if (!idea) return
  // 保存前确保标签输入框的内容已同步到 idea.tags（防止用户直接点保存但 blur 未触发）
  onTagsBlur()
  saving.value = true
  try {
    await ideaStore.update(idea.id, {
      title: idea.title,
      content: idea.content,
      tags: idea.tags || [],
    })
    // 保存后 store 中 ideas 数组的元素已被替换为新对象
    // 同步更新 selectedIdea 引用，避免编辑器与列表不同步
    ideaStore.selectedIdea = cloneIdea(ideaStore.ideas.find(i => i.id === idea.id) || ideaStore.selectedIdea)
    uiStore.toast('灵感已保存', 'success')
  } catch (e) {
    uiStore.toast('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  const idea = ideaStore.selectedIdea
  if (!idea) return
  uiStore.showConfirm({
    title: '删除灵感',
    message: `确定删除「${idea.title || '未命名灵感'}」吗？此操作不可恢复。`,
    cancelText: '取消',
    confirmText: '删除',
    onConfirm: async () => {
      try {
        await ideaStore.remove(idea.id)
        uiStore.toast('已删除', 'success')
      } catch (e) {
        uiStore.toast('删除失败：' + e.message, 'error')
      }
    },
  })
}

async function onLinkNode() {
  const idea = ideaStore.selectedIdea
  if (!idea) return
  const node = graphStore.selectedNode
  if (!node) {
    linkErr.value = true
    linkMsg.value = '请先在图谱视图中选中一个节点，再进行关联。'
    return
  }
  linking.value = true
  linkMsg.value = ''
  linkErr.value = false
  try {
    await ideaApi.linkToNode(idea.id, node.id)
    // 本地更新关联信息
    idea.nodeId = node.id
    idea.nodeLabel = node.label || node.name || node.id
    linkErr.value = false
    linkMsg.value = `已关联到节点：${node.label || node.name || node.id}`
    uiStore.toast('节点关联成功', 'success')
  } catch (e) {
    linkErr.value = true
    linkMsg.value = '关联失败：' + e.message
    uiStore.toast('关联失败：' + e.message, 'error')
  } finally {
    linking.value = false
  }
}
</script>

<style scoped>
.idea-panel {
  height: 100%;
}
.idea-panel--dual {
  display: flex;
  gap: 12px;
}
.idea-panel--dual .ip-list {
  width: 320px;
  flex-shrink: 0;
}
.idea-panel--dual .ip-editor {
  flex: 1;
  min-width: 0;
}
.ip-list,
.ip-editor {
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
}
.ip-list .panel__body,
.ip-editor .panel__body {
  flex: 1;
  overflow-y: auto;
}
.ip-editor__actions {
  display: flex;
  gap: 6px;
}

/* 灵感卡片 */
.ip-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ip-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  cursor: pointer;
  background: var(--bg-input);
  transition: all 0.15s;
}
.ip-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
.ip-card--active {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.ip-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ip-card__preview {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ip-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.ip-linked {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--violet-dim);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--violet);
  margin-bottom: 12px;
}
.hint--ok {
  color: var(--emerald);
}
.hint--err {
  color: var(--rose);
}
</style>
