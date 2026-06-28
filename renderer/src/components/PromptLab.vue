<template>
  <div class="prompt-lab">
    <!-- 加载中状态 -->
    <div v-if="loading" class="prompt-lab__loading">
      <p>正在加载提示词模板...</p>
    </div>
    <!-- 加载错误状态 -->
    <div v-else-if="loadError" class="prompt-lab__error">
      <p>加载失败：{{ loadError }}</p>
      <button class="btn btn--primary" @click="loadData">重试</button>
    </div>
    <template v-else>
    <!-- 左侧：任务列表 -->
    <div class="prompt-lab__sidebar">
      <div class="sidebar__header">
        <h3>LLM 任务列表</h3>
        <span class="sidebar__count">{{ tasks.length }} 个任务</span>
      </div>
      <div class="sidebar__filter">
        <input
          v-model="filterKeyword"
          class="sidebar__search"
          placeholder="搜索任务名称…"
          aria-label="搜索任务"
        >
        <select v-model="filterCategory" class="sidebar__category" aria-label="按分类筛选">
          <option value="">全部分类</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
      </div>
      <div class="sidebar__list" role="listbox" aria-label="任务列表">
        <button
          v-for="task in filteredTasks"
          :key="task.id"
          class="task-item"
          :class="{ 'task-item--active': selectedTaskId === task.id }"
          role="option"
          :aria-selected="selectedTaskId === task.id"
          @click="selectTask(task.id)"
        >
          <span class="task-item__name">{{ task.name }}</span>
          <span class="task-item__category">{{ task.category }}</span>
          <span
            v-if="disabledSet.has(task.id)"
            class="task-item__badge task-item__badge--disabled"
            title="已禁用"
          >禁用</span>
          <span
            v-if="overrideMap[task.id]"
            class="task-item__badge task-item__badge--custom"
            title="已自定义模板"
          >已改</span>
        </button>
      </div>
    </div>

    <!-- 右侧：模板编辑 + 测试 + 日志 -->
    <div class="prompt-lab__main">
      <template v-if="selectedTask">
        <!-- 任务信息 -->
        <div class="task-header">
          <div class="task-header__title">
            <h2>{{ selectedTask.name }}</h2>
            <span class="task-header__category">{{ selectedTask.category }}</span>
            <span
              v-if="overrideMap[selectedTask.id]"
              class="task-header__custom-badge"
            >已自定义</span>
          </div>
          <p class="task-header__desc">{{ selectedTask.description }}</p>
          <div class="task-header__meta">
            <span class="meta-item">文件：<code>{{ selectedTask.file }}</code></span>
            <span class="meta-item">变量：<code>{{ selectedTask.variables.join(', ') }}</code></span>
          </div>
        </div>

        <!-- 提示词模板编辑 -->
        <section class="section">
          <div class="section__header">
            <h3>提示词模板</h3>
            <div class="section__actions">
              <button
                v-if="hasUnsavedChanges"
                class="btn btn--primary"
                @click="saveTemplate"
              >保存修改</button>
              <button
                v-if="overrideMap[selectedTask.id] || hasUnsavedChanges"
                class="btn btn--ghost"
                @click="resetTemplate"
              >恢复内置模板</button>
            </div>
          </div>
          <p class="section__hint">
            直接编辑下方模板。模板中的 <code v-pre>{{ 变量名 }}</code> 占位符在运行时会被替换为实际值。
            保存后即生效，所有后续调用都会使用你修改后的模板。
          </p>

          <!-- System Prompt -->
          <div class="prompt-field" v-if="effectiveTemplate.system || editingSystem">
            <label class="prompt-field__label">
              System Prompt
              <button
                v-if="!editingSystem && effectiveTemplate.system"
                class="prompt-field__toggle"
                @click="editingSystem = false"
              >收起</button>
              <button
                v-if="!editingSystem && !effectiveTemplate.system"
                class="prompt-field__toggle"
                @click="editingSystem = true"
              >添加 System Prompt</button>
            </label>
            <textarea
              v-if="editingSystem || effectiveTemplate.system"
              v-model="editSystem"
              class="prompt-field__textarea"
              rows="6"
              spellcheck="false"
              :placeholder="'（此任务无 System Prompt，点击上方按钮添加）'"
            ></textarea>
          </div>

          <!-- User Prompt -->
          <div class="prompt-field">
            <label class="prompt-field__label">User Prompt</label>
            <textarea
              v-model="editUser"
              class="prompt-field__textarea prompt-field__textarea--user"
              rows="18"
              spellcheck="false"
            ></textarea>
          </div>
        </section>

        <!-- 测试区域 -->
        <section class="section">
          <div class="section__header">
            <h3>模板测试</h3>
            <button
              class="btn btn--primary"
              :disabled="testing"
              @click="runTest"
            >{{ testing ? '测试中…' : '运行测试' }}</button>
          </div>
          <p class="section__hint">
            输入测试变量值（JSON 格式），运行后将用当前模板渲染并调用 LLM。
          </p>
          <textarea
            v-model="testVars"
            class="prompt-field__textarea prompt-field__textarea--test"
            rows="4"
            spellcheck="false"
            :placeholder='`例如：{"sample": "这是一段测试文本"}`'
          ></textarea>
          <!-- 渲染后的提示词 + LLM 响应 -->
          <div v-if="testRenderedUser || testResult" class="test-output">
            <!-- 元信息 -->
            <div v-if="testMeta" class="test-output__meta">
              <span v-if="testMeta.provider">{{ testMeta.provider }}</span>
              <span v-if="testMeta.model">{{ testMeta.model }}</span>
              <span v-if="testMeta.durationMs != null">{{ testMeta.durationMs }}ms</span>
            </div>
            <!-- 渲染后的 System Prompt -->
            <div v-if="testRenderedSystem" class="test-output__field">
              <strong>System（渲染后）：</strong>
              <pre>{{ testRenderedSystem }}</pre>
            </div>
            <!-- 渲染后的 User Prompt：模板占位符已替换为实际值 -->
            <div v-if="testRenderedUser" class="test-output__field">
              <strong>User（渲染后，模板填入实际内容）：</strong>
              <pre>{{ testRenderedUser }}</pre>
            </div>
            <!-- LLM 响应 -->
            <div v-if="testResult" class="test-output__field" :class="{ 'test-output__field--error': testError }">
              <strong>{{ testError ? '错误' : 'LLM 响应' }}：</strong>
              <pre>{{ testResult }}</pre>
            </div>
          </div>
        </section>

        <!-- LLM 调用日志 -->
        <section class="section">
          <div class="section__header">
            <h3>调用日志</h3>
            <button class="btn btn--ghost" @click="refreshLogs">刷新</button>
          </div>
          <div v-if="logs.length === 0" class="logs-empty">
            暂无调用日志。运行任务后，此处会显示渲染后的提示词（占位符已替换为实际值）。
          </div>
          <div v-else class="logs-list">
            <details
              v-for="(log, idx) in logs"
              :key="idx"
              class="log-entry"
              :class="{ 'log-entry--error': !log.success, 'log-entry--disabled': log.disabled }"
            >
              <summary class="log-entry__summary">
                <span class="log-entry__time">{{ formatTime(log.timestamp) }}</span>
                <span class="log-entry__task">{{ log.taskName || log.taskId }}</span>
                <span class="log-entry__status" :class="log.success ? 'log-entry__status--ok' : 'log-entry__status--fail'">
                  {{ log.disabled ? '已禁用' : (log.success ? '成功' : '失败') }}
                </span>
                <span class="log-entry__duration">{{ log.durationMs }}ms</span>
                <span v-if="log.overridden" class="log-entry__badge">自定义</span>
              </summary>
              <div class="log-entry__body">
                <div v-if="log.system" class="log-entry__field">
                  <strong>System:</strong>
                  <pre>{{ log.system }}</pre>
                </div>
                <div class="log-entry__field">
                  <strong>User (渲染后):</strong>
                  <pre>{{ log.user }}</pre>
                </div>
                <div v-if="log.response" class="log-entry__field">
                  <strong>响应:</strong>
                  <pre>{{ log.response }}</pre>
                </div>
                <div v-if="log.error" class="log-entry__field log-entry__field--error">
                  <strong>错误:</strong>
                  <pre>{{ log.error }}</pre>
                </div>
              </div>
            </details>
          </div>
        </section>
      </template>

      <!-- 未选择任务时的提示 -->
      <div v-else class="prompt-lab__placeholder">
        <p>← 从左侧选择一个任务查看和编辑其提示词模板</p>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { client as apiClient } from '../api/client.js';

const tasks = ref([]);
const selectedTaskId = ref('');
const filterKeyword = ref('');
const filterCategory = ref('');
const defaultPrompts = ref({});   // 内置模板
const overrideMap = ref({});       // 用户自定义模板
const disabledSet = ref(new Set());
const loading = ref(true);         // 初始加载中
const loadError = ref('');         // 加载错误信息

// 编辑状态
const editSystem = ref('');
const editUser = ref('');
const editingSystem = ref(false);
const hasUnsavedChanges = ref(false);

// 测试状态
const testVars = ref('{}');
const testResult = ref('');
const testError = ref(false);
const testing = ref(false);
const testRenderedSystem = ref('');
const testRenderedUser = ref('');
const testMeta = ref(null); // { durationMs, provider, model }

// 日志
const logs = ref([]);

const categories = computed(() => {
  const set = new Set(tasks.value.map(t => t.category));
  return Array.from(set).sort();
});

const selectedTask = computed(() =>
  tasks.value.find(t => t.id === selectedTaskId.value) || null
);

const effectiveTemplate = computed(() => {
  if (!selectedTaskId.value) return { system: '', user: '' };
  const override = overrideMap.value[selectedTaskId.value];
  const builtin = defaultPrompts.value[selectedTaskId.value] || { system: '', user: '' };
  if (override) {
    return {
      system: override.system != null ? override.system : builtin.system,
      user: override.user != null ? override.user : builtin.user
    };
  }
  return builtin;
});

const filteredTasks = computed(() => {
  let result = tasks.value;
  if (filterCategory.value) {
    result = result.filter(t => t.category === filterCategory.value);
  }
  if (filterKeyword.value.trim()) {
    const kw = filterKeyword.value.trim().toLowerCase();
    result = result.filter(t =>
      t.name.toLowerCase().includes(kw) ||
      t.id.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw)
    );
  }
  return result;
});

function selectTask(taskId) {
  selectedTaskId.value = taskId;
  loadTaskTemplate(taskId);
}

function loadTaskTemplate(taskId) {
  const override = overrideMap.value[taskId];
  const builtin = defaultPrompts.value[taskId] || { system: '', user: '' };
  if (override) {
    editSystem.value = override.system != null ? override.system : builtin.system;
    editUser.value = override.user != null ? override.user : builtin.user;
  } else {
    editSystem.value = builtin.system || '';
    editUser.value = builtin.user || '';
  }
  editingSystem.value = false;
  hasUnsavedChanges.value = false;
  testResult.value = '';
  testError.value = false;
  testRenderedSystem.value = '';
  testRenderedUser.value = '';
  testMeta.value = null;
}

// 监听编辑变化
watch([editSystem, editUser], () => {
  if (!selectedTaskId.value) return;
  const current = effectiveTemplate.value;
  hasUnsavedChanges.value =
    editSystem.value !== (current.system || '') ||
    editUser.value !== (current.user || '');
});

async function saveTemplate() {
  if (!selectedTaskId.value) return;
  try {
    await apiClient.setPrompt(selectedTaskId.value, {
      system: editSystem.value,
      user: editUser.value
    });
    overrideMap.value[selectedTaskId.value] = {
      system: editSystem.value,
      user: editUser.value
    };
    hasUnsavedChanges.value = false;
  } catch (e) {
    console.error('[PromptLab] 保存失败:', e);
  }
}

async function resetTemplate() {
  if (!selectedTaskId.value) return;
  try {
    await apiClient.resetPrompt(selectedTaskId.value);
    delete overrideMap.value[selectedTaskId.value];
    loadTaskTemplate(selectedTaskId.value);
  } catch (e) {
    console.error('[PromptLab] 重置失败:', e);
  }
}

async function runTest() {
  if (!selectedTaskId.value) return;
  testing.value = true;
  testResult.value = '';
  testError.value = false;
  testRenderedSystem.value = '';
  testRenderedUser.value = '';
  testMeta.value = null;
  try {
    let vars = {};
    try {
      vars = JSON.parse(testVars.value);
    } catch (e) {
      testError.value = true;
      testResult.value = '变量 JSON 解析失败: ' + e.message;
      testing.value = false;
      return;
    }
    const result = await apiClient.testPrompt(selectedTaskId.value, vars);
    // 无论成功与否，后端都会返回渲染后的提示词，便于用户查看"模板填入内容后长什么样"
    if (result) {
      testRenderedSystem.value = result.renderedSystem || '';
      testRenderedUser.value = result.renderedUser || '';
      testMeta.value = {
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model
      };
    }
    if (result && result.success) {
      testResult.value = result.response || JSON.stringify(result, null, 2);
    } else {
      testError.value = true;
      testResult.value = (result && result.error) || '测试失败';
    }
    // 测试调用已写入日志，刷新日志区让用户看到这条记录
    refreshLogs();
  } catch (e) {
    testError.value = true;
    testResult.value = e.message || String(e);
  } finally {
    testing.value = false;
  }
}

async function refreshLogs() {
  try {
    const result = await apiClient.getLLMLog(50);
    // API 返回 { success, entries, total }，取 entries 数组
    logs.value = (result && Array.isArray(result.entries)) ? result.entries : [];
  } catch (e) {
    console.error('[PromptLab] 获取日志失败:', e);
  }
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

async function loadData() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await apiClient.getPrompts();
    tasks.value = data.tasks || [];
    defaultPrompts.value = data.defaults || {};
    overrideMap.value = data.overrides || {};
    disabledSet.value = new Set(data.disabled || []);

    // 自动选第一个任务
    if (tasks.value.length > 0 && !selectedTaskId.value) {
      selectTask(tasks.value[0].id);
    }
  } catch (e) {
    console.error('[PromptLab] 加载数据失败:', e);
    loadError.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
  refreshLogs();
}

onMounted(loadData);
</script>

<style scoped>
.prompt-lab {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* ===== 加载/错误状态 ===== */
.prompt-lab__loading,
.prompt-lab__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  gap: 12px;
  color: var(--text-secondary, #888);
  font-size: 14px;
}

.prompt-lab__error p {
  color: #e53935;
}

/* ===== 左侧侧边栏 ===== */
.prompt-lab__sidebar {
  width: 260px;
  min-width: 220px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #f8f9fa);
}

.sidebar__header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.sidebar__header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.sidebar__count {
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.sidebar__filter {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar__search,
.sidebar__category {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--text-primary, #333);
  transition: background 0.15s;
}

.task-item:hover {
  background: var(--bg-hover, #f0f0f0);
}

.task-item--active {
  background: var(--bg-active, #e3f2fd);
  border-left: 3px solid var(--accent, #1976d2);
  padding-left: 13px;
}

.task-item__name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-item__category {
  font-size: 11px;
  color: var(--text-secondary, #999);
  background: var(--bg-tertiary, #eee);
  padding: 1px 6px;
  border-radius: 3px;
}

.task-item__badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}

.task-item__badge--disabled {
  background: #ffebee;
  color: #c62828;
}

.task-item__badge--custom {
  background: #fff3e0;
  color: #e65100;
}

/* ===== 右侧主区域 ===== */
.prompt-lab__main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  min-width: 0;
}

.prompt-lab__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #999);
  font-size: 14px;
}

.task-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.task-header__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-header__title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.task-header__category {
  font-size: 12px;
  color: var(--text-secondary, #888);
  background: var(--bg-tertiary, #f0f0f0);
  padding: 2px 8px;
  border-radius: 4px;
}

.task-header__custom-badge {
  font-size: 12px;
  color: #e65100;
  background: #fff3e0;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.task-header__desc {
  margin: 8px 0 6px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.task-header__meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.task-header__meta code {
  background: var(--bg-tertiary, #f5f5f5);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

/* ===== 通用 Section ===== */
.section {
  margin-bottom: 24px;
}

.section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section__header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.section__actions {
  display: flex;
  gap: 8px;
}

.section__hint {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin: 0 0 10px;
  line-height: 1.5;
}

.section__hint code {
  background: var(--bg-tertiary, #f5f5f5);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

/* ===== 按钮 ===== */
.btn {
  font-size: 13px;
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.btn--primary {
  background: var(--accent, #1976d2);
  color: #fff;
  border-color: var(--accent, #1976d2);
}

.btn--primary:hover {
  opacity: 0.9;
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--ghost {
  background: transparent;
  color: var(--text-secondary, #666);
  border-color: var(--border-color, #ddd);
}

.btn--ghost:hover {
  background: var(--bg-hover, #f5f5f5);
}

/* ===== 模板编辑 ===== */
.prompt-field {
  margin-bottom: 12px;
}

.prompt-field__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary, #333);
}

.prompt-field__toggle {
  font-size: 11px;
  background: none;
  border: none;
  color: var(--accent, #1976d2);
  cursor: pointer;
  padding: 0;
}

.prompt-field__textarea {
  width: 100%;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Noto Sans CJK SC', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  resize: vertical;
  min-height: 60px;
}

.prompt-field__textarea:focus {
  outline: none;
  border-color: var(--accent, #1976d2);
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.prompt-field__textarea--user {
  min-height: 200px;
}

.prompt-field__textarea--test {
  min-height: 60px;
  font-size: 12px;
}

/* ===== 测试结果 ===== */
.test-output {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.test-output__meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary, #888);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-color, #e0e0e0);
}

.test-output__field strong {
  font-size: 12px;
  color: var(--text-secondary, #666);
  display: block;
  margin-bottom: 4px;
}

.test-output__field pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-tertiary, #f5f5f5);
  padding: 10px;
  border-radius: 6px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Noto Sans CJK SC', monospace;
  line-height: 1.5;
  max-height: 320px;
  overflow-y: auto;
}

.test-output__field--error pre {
  background: #ffebee;
  color: #c62828;
}

/* ===== 日志 ===== */
.logs-empty {
  font-size: 13px;
  color: var(--text-secondary, #999);
  padding: 16px 0;
  text-align: center;
}

.logs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-entry {
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  overflow: hidden;
}

.log-entry--error {
  border-color: #ef9a9a;
}

.log-entry--disabled {
  opacity: 0.6;
}

.log-entry__summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 12px;
  background: var(--bg-secondary, #f8f9fa);
}

.log-entry__summary:hover {
  background: var(--bg-hover, #f0f0f0);
}

.log-entry__time {
  color: var(--text-secondary, #888);
  font-family: monospace;
  white-space: nowrap;
}

.log-entry__task {
  font-weight: 600;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-entry__status {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.log-entry__status--ok {
  background: #e8f5e9;
  color: #2e7d32;
}

.log-entry__status--fail {
  background: #ffebee;
  color: #c62828;
}

.log-entry__duration {
  color: var(--text-secondary, #888);
  font-family: monospace;
  font-size: 11px;
}

.log-entry__badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: #fff3e0;
  color: #e65100;
}

.log-entry__body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.log-entry__field strong {
  font-size: 12px;
  color: var(--text-secondary, #666);
  display: block;
  margin-bottom: 4px;
}

.log-entry__field pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-tertiary, #f5f5f5);
  padding: 8px;
  border-radius: 4px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Noto Sans CJK SC', monospace;
  line-height: 1.5;
}

.log-entry__field--error pre {
  background: #ffebee;
  color: #c62828;
}

/* ===== 暗色主题 ===== */
:root[data-theme='dark'] .prompt-lab__sidebar {
  background: #1e1e1e;
  border-right-color: #333;
}

:root[data-theme='dark'] .sidebar__header {
  border-bottom-color: #333;
}

:root[data-theme='dark'] .sidebar__search,
:root[data-theme='dark'] .sidebar__category {
  background: #2d2d2d;
  border-color: #444;
  color: #ddd;
}

:root[data-theme='dark'] .task-item {
  color: #ddd;
}

:root[data-theme='dark'] .task-item:hover {
  background: #2a2a2a;
}

:root[data-theme='dark'] .task-item--active {
  background: #1a237e;
  border-left-color: #64b5f6;
}

:root[data-theme='dark'] .task-item__category {
  background: #333;
  color: #aaa;
}

:root[data-theme='dark'] .prompt-lab__main {
  color: #ddd;
}

:root[data-theme='dark'] .task-header {
  border-bottom-color: #333;
}

:root[data-theme='dark'] .task-header__category {
  background: #333;
  color: #aaa;
}

:root[data-theme='dark'] .task-header__meta code {
  background: #2d2d2d;
}

:root[data-theme='dark'] .section__hint code {
  background: #2d2d2d;
}

:root[data-theme='dark'] .prompt-field__textarea {
  background: #1e1e1e;
  border-color: #444;
  color: #ddd;
}

:root[data-theme='dark'] .test-output__field pre {
  background: #1e1e1e;
  color: #ddd;
}

:root[data-theme='dark'] .test-output__field--error pre {
  background: #4a1e1e;
  color: #ff8a80;
}

:root[data-theme='dark'] .log-entry {
  border-color: #444;
}

:root[data-theme='dark'] .log-entry__summary {
  background: #2d2d2d;
}

:root[data-theme='dark'] .log-entry__summary:hover {
  background: #333;
}

:root[data-theme='dark'] .log-entry__field pre {
  background: #1e1e1e;
  color: #ddd;
}
</style>
