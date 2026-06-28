<script setup>
/** IdeaPanel — 右栏 Tab：Idea 列表 + 选中详情 + 推荐 + 图谱联动 */
import { ref, computed, onUnmounted, onDeactivated } from 'vue';
import { useIdeaStore } from '@/stores/idea';
import { useGraphStore } from '@/stores/graph';
import { useToastStore } from '@/stores/toast';
import { useDialog } from '@/composables/useDialog';

const ideaStore = useIdeaStore();
const graphStore = useGraphStore();
const toast = useToastStore();
const dialog = useDialog();

const newTitle = ref('');
const newContent = ref('');

// 异步操作 loading 状态
const creating = ref(false);
const deleting = ref(false);
const fetchingRecs = ref(false);
const linking = ref(null); // 正在关联/取消关联的 nodeId

async function createIdea() {
  const title = newTitle.value.trim();
  const content = newContent.value.trim();
  if (!title && !content) return;
  creating.value = true;
  try {
    await ideaStore.addIdea({
      title: title || '未命名 Idea',
      content
    });
    newTitle.value = '';
    newContent.value = '';
    await graphStore.loadGraph();
    toast.success('Idea已创建');
  } catch (e) {
    console.error('创建 Idea 失败:', e);
    toast.error('创建 Idea 失败: ' + (e.message || e));
  } finally {
    creating.value = false;
  }
}

async function deleteActiveIdea() {
  if (!ideaStore.activeIdea) return;
  const ok = await dialog.confirm('删除确认', '确定要删除这个 Idea 及其所有子 Idea 吗？', { danger: true });
  if (!ok) return;
  deleting.value = true;
  try {
    await ideaStore.removeIdea(ideaStore.activeIdea.id);
    await graphStore.loadGraph();
  } catch (e) {
    console.error('删除 Idea 失败:', e);
    toast.error('删除 Idea 失败: ' + (e.message || e));
  } finally {
    deleting.value = false;
  }
}

// 图谱重新加载防抖定时器：非结构变更（标题/颜色等）延迟重新加载，避免频繁全量加载图谱
let graphReloadTimer = null;
// 颜色保存防抖定时器：拖动选色过程中防抖保存，避免频繁 API 调用
let colorSaveTimer = null;

async function updateActiveIdea(patch) {
  if (!ideaStore.activeIdea) return;
  try {
    await ideaStore.updateIdea(ideaStore.activeIdea.id, patch);
  } catch (e) {
    console.error('更新 Idea 失败:', e);
    toast.error('更新 Idea 失败: ' + (e.message || e));
    return;
  }
  // includeInGraph 切换会改变图谱结构，需立即重新加载
  if (Object.prototype.hasOwnProperty.call(patch, 'includeInGraph')) {
    if (graphReloadTimer) {
      clearTimeout(graphReloadTimer);
      graphReloadTimer = null;
    }
    try {
      await graphStore.loadGraph();
    } catch (e) {
      console.error('重新加载图谱失败:', e);
    }
    return;
  }
  // 其他字段更新对图谱结构影响小，防抖延迟重新加载（500ms）
  if (graphReloadTimer) clearTimeout(graphReloadTimer);
  graphReloadTimer = setTimeout(() => {
    graphReloadTimer = null;
    graphStore.loadGraph().catch(e => console.error('重新加载图谱失败:', e));
  }, 500);
}

/**
 * 颜色输入实时处理：v-model 已即时更新本地状态（图谱节点颜色实时变化），
 * 此处仅防抖触发后端持久化，避免拖动选色过程中频繁调用 API。
 *
 * 重要：在设置防抖定时器时立即捕获当前 ideaId 和 color 值，
 * 而非在定时器回调中读取 ideaStore.activeIdea。
 * 否则若用户在 300ms 防抖窗口内切换到其他 Idea，回调会读取到新 Idea 的颜色，
 * 将新 Idea 的颜色保存到新 Idea（冗余保存），而原 Idea 的颜色变更则丢失（从未持久化）。
 */
function onColorInput() {
  if (!ideaStore.activeIdea) return;
  // 在防抖窗口开始时捕获目标 ideaId 和当前颜色值
  const targetIdeaId = ideaStore.activeIdea.id;
  const targetColor = ideaStore.activeIdea.color;
  if (colorSaveTimer) clearTimeout(colorSaveTimer);
  colorSaveTimer = setTimeout(() => {
    colorSaveTimer = null;
    // 直接使用捕获的 ideaId 调用 store 更新，而非 updateActiveIdea（后者读取 activeIdea.id）。
    // 这样即使用户在防抖窗口内切换了 Idea，颜色仍会保存到正确的 Idea。
    ideaStore.updateIdea(targetIdeaId, { color: targetColor }).catch(e => {
      console.error('保存颜色失败:', e);
      toast.error('保存颜色失败: ' + (e.message || e));
    });
  }, 300);
}

// KeepAlive 缓存：切出 Tab 时清理防抖定时器，避免组件不可见时仍触发图谱重载
onDeactivated(() => {
  if (graphReloadTimer) {
    clearTimeout(graphReloadTimer);
    graphReloadTimer = null;
  }
  if (colorSaveTimer) {
    clearTimeout(colorSaveTimer);
    colorSaveTimer = null;
  }
});

onUnmounted(() => {
  if (graphReloadTimer) {
    clearTimeout(graphReloadTimer);
    graphReloadTimer = null;
  }
  if (colorSaveTimer) {
    clearTimeout(colorSaveTimer);
    colorSaveTimer = null;
  }
});

async function refreshRecommendations() {
  if (!ideaStore.activeIdea) return;
  fetchingRecs.value = true;
  try {
    await ideaStore.fetchRecommendations(ideaStore.activeIdea.id);
  } catch (e) {
    console.error('获取推荐失败:', e);
    toast.error('获取推荐失败: ' + (e.message || e));
  } finally {
    fetchingRecs.value = false;
  }
}

async function linkNode(nodeId) {
  if (!ideaStore.activeIdea) return;
  linking.value = nodeId;
  try {
    await ideaStore.linkIdeaToNode(ideaStore.activeIdea.id, nodeId);
    await graphStore.loadGraph();
  } catch (e) {
    console.error('关联节点失败:', e);
    toast.error('关联节点失败: ' + (e.message || e));
  } finally {
    linking.value = null;
  }
}

async function unlinkNode(nodeId) {
  if (!ideaStore.activeIdea) return;
  linking.value = nodeId;
  try {
    await ideaStore.unlinkIdeaFromNode(ideaStore.activeIdea.id, nodeId);
    await graphStore.loadGraph();
  } catch (e) {
    console.error('取消关联失败:', e);
    toast.error('取消关联失败: ' + (e.message || e));
  } finally {
    linking.value = null;
  }
}

function isLinked(nodeId) {
  return ideaStore.activeIdea?.relatedNodeIds?.includes(nodeId);
}

function nodeLabel(nodeId) {
  const node = graphStore.nodes.find(n => n.id === nodeId);
  return node?.content || nodeId;
}

const parentIdeaTitle = computed(() => {
  if (!ideaStore.activeIdea?.parentId) return null;
  const parent = ideaStore.ideas.find(i => i.id === ideaStore.activeIdea.parentId);
  return parent?.title || '未知';
});

const childIdeas = computed(() => {
  if (!ideaStore.activeIdea) return [];
  return ideaStore.ideas.filter(i => i.parentId === ideaStore.activeIdea.id);
});

// 仅显示根 Idea（无 parentId），避免子 Idea 重复出现在列表中
const rootIdeas = computed(() => ideaStore.ideas.filter(i => !i.parentId));
</script>

<template>
  <div class="idea-panel">
    <div class="idea-form">
      <input v-model="newTitle" placeholder="Idea 标题" aria-label="新 Idea 标题" @keyup.enter="createIdea" />
      <textarea v-model="newContent" placeholder="记录你的想法..." aria-label="新 Idea 内容" rows="2" />
      <button class="btn-primary" :disabled="creating" @click="createIdea">{{ creating ? '保存中...' : '+ 保存 Idea' }}</button>
    </div>

    <div v-if="ideaStore.activeIdea" class="idea-detail">
      <h3>{{ ideaStore.activeIdea.title || '未命名' }}</h3>
      <p>{{ ideaStore.activeIdea.content }}</p>
      <div class="meta">创建于 {{ ideaStore.activeIdea.createdAt ? new Date(ideaStore.activeIdea.createdAt).toLocaleString() : '未知' }}</div>

      <div v-if="parentIdeaTitle" class="parent-info">
        上级 Idea：<strong>{{ parentIdeaTitle }}</strong>
      </div>
      <div v-if="childIdeas.length" class="children-info">
        子 Idea（{{ childIdeas.length }}）：
        <button v-for="child in childIdeas" :key="child.id" class="child-chip" :aria-label="`切换到子 Idea：${child.title}`" @click="ideaStore.setActive(child.id)">
          {{ child.title }}
        </button>
      </div>

      <div class="idea-settings">
        <label class="setting-row">
          <span>标题</span>
          <input v-model="ideaStore.activeIdea.title" type="text" @change="updateActiveIdea({ title: ideaStore.activeIdea.title?.trim() })" />
        </label>
        <label class="setting-row">
          <span>颜色</span>
          <input v-model="ideaStore.activeIdea.color" type="color" @input="onColorInput" />
        </label>
        <label class="setting-row checkbox">
          <input type="checkbox" :checked="ideaStore.activeIdea.includeInGraph !== false" @change="updateActiveIdea({ includeInGraph: $event.target.checked })" />
          <span>加入知识图谱</span>
        </label>
      </div>

      <div class="actions">
        <button class="btn-primary" :disabled="fetchingRecs" @click="refreshRecommendations">{{ fetchingRecs ? '获取中...' : '获取推荐' }}</button>
        <button class="btn-danger" :disabled="deleting" @click="deleteActiveIdea">{{ deleting ? '删除中...' : '删除 Idea' }}</button>
      </div>

      <div v-if="ideaStore.activeIdea.relatedNodeIds?.length" class="linked-nodes">
        <h5>已关联节点</h5>
        <div class="chip-list">
          <span v-for="nodeId in ideaStore.activeIdea.relatedNodeIds" :key="nodeId" class="chip">
            {{ nodeLabel(nodeId) }}
            <button class="chip-remove" aria-label="取消关联节点" :disabled="linking === nodeId" @click="unlinkNode(nodeId)">×</button>
          </span>
        </div>
      </div>
    </div>

    <div class="idea-list">
      <div v-for="idea in rootIdeas" :key="idea.id" class="idea-card"
           role="button"
           tabindex="0"
           :class="{active: ideaStore.activeIdeaId===idea.id}"
           :aria-label="`Idea: ${idea.title || '未命名'}`"
           @click="ideaStore.setActive(idea.id)"
           @keydown.enter="ideaStore.setActive(idea.id)">
        <h4>{{ idea.title || '未命名' }}</h4>
        <p>{{ (idea.content || '').slice(0, 80) }}{{ (idea.content || '').length > 80 ? '...' : '' }}</p>
      </div>
      <div v-if="rootIdeas.length===0" class="empty-guide" style="text-align:center;padding:32px 16px;">
        <div style="font-size:36px;margin-bottom:8px;">💡</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:4px;">还没有 Idea</div>
        <div style="font-size:12px;color:var(--text-tertiary);">在上方输入标题和内容，记录你的灵感</div>
      </div>
    </div>

    <div v-if="ideaStore.recommendations.length" class="recommendations" role="region" aria-label="推荐关联节点" aria-live="polite">
      <h5>推荐关联</h5>
      <div v-for="rec in ideaStore.recommendations" :key="rec.nodeId" class="rec-item">
        <div class="rec-content">
          <div v-if="rec.source?.docName" class="rec-doc">{{ rec.source.docName }}</div>
          <div class="rec-text">{{ rec.content || rec.nodeId }}</div>
        </div>
        <div class="rec-actions">
          <span class="score">{{ (rec.score*100).toFixed(0) }}%</span>
          <button v-if="!isLinked(rec.nodeId)" class="btn-link" :disabled="linking === rec.nodeId" @click="linkNode(rec.nodeId)">{{ linking === rec.nodeId ? '关联中...' : '关联' }}</button>
          <span v-else class="linked-badge">已关联</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.idea-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}
.idea-form input,
.idea-form textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: inherit;
}
.idea-form textarea {
  resize: vertical;
}
.idea-form input:focus,
.idea-form textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.idea-detail {
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}
.idea-detail h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.idea-detail p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
}
.meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.parent-info {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
}
.children-info {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.child-chip {
  display: inline-block;
  padding: 2px 8px;
  margin: 2px;
  background: var(--bg-hover);
  border-radius: 10px;
  cursor: pointer;
  font-size: 11px;
}
.child-chip:hover {
  background: var(--bg-active);
}
.idea-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.setting-row span {
  width: 70px;
  flex-shrink: 0;
}
.setting-row input[type="text"] {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.setting-row.checkbox {
  gap: 6px;
}
.setting-row.checkbox span {
  width: auto;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  margin-bottom: 12px;
}
.btn-danger {
  background: var(--danger, #ef4444);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.idea-card {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.idea-card:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong, var(--border-color));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}
.idea-card.active {
  background: var(--bg-hover);
  border-left: 3px solid var(--accent);
}
.idea-card h4 {
  margin: 0 0 4px;
  font-size: 13px;
}
.idea-card p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.rec-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  margin-bottom: 6px;
}
.rec-content {
  flex: 1;
  min-width: 0;
}
.rec-doc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.rec-text {
  font-size: 13px;
  line-height: 1.4;
  word-break: break-word;
}
.rec-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  white-space: nowrap;
}
.score {
  font-size: 12px;
  color: var(--text-secondary);
}
.btn-link {
  padding: 3px 10px;
  background: var(--accent, #3b82f6);
  border: 1px solid var(--accent, #3b82f6);
  border-radius: var(--radius-sm, 4px);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-link:hover {
  background: var(--accent-light, #60a5fa);
}
.linked-badge {
  padding: 3px 8px;
  background: var(--bg-hover, #f1f5f9);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  white-space: nowrap;
}
</style>
