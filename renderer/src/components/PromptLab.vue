<template>
  <!-- 提示词模板实验室：左侧任务列表 + 右侧编辑器/测试/日志 -->
  <div :class="embedded ? 'prompt-lab prompt-lab--embedded' : 'page prompt-lab'">
    <div class="pl-grid">
      <!-- ===== 左侧：任务列表 ===== -->
      <aside class="panel pl-sidebar">
        <div class="panel__header">
          <h2>LLM 任务</h2>
          <span class="tag tag--cyan">{{ filteredTasks.length }}</span>
        </div>
        <div class="pl-sidebar__search">
          <input type="text" v-model="taskFilter" placeholder="搜索任务..." />
        </div>
        <div class="pl-task-list">
          <button
            v-for="t in filteredTasks"
            :key="t.id"
            class="pl-task"
            :class="{ 'pl-task--active': t.id === activeTaskId }"
            @click="selectTask(t)"
          >
            <div class="pl-task__row">
              <span class="pl-task__name">{{ taskName(t) }}</span>
              <span v-if="hasOverride(t.id)" class="tag tag--amber">覆盖</span>
            </div>
            <div v-if="taskDesc(t)" class="pl-task__desc">{{ taskDesc(t) }}</div>
          </button>
          <div v-if="!filteredTasks.length" class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <p>无匹配任务</p>
          </div>
        </div>
      </aside>

      <!-- ===== 右侧：编辑器 + 测试 + 日志 ===== -->
      <section class="pl-main">
        <!-- 空状态 -->
        <div v-if="!activeTask" class="panel">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
            <p>从左侧选择一个任务以编辑提示词模板</p>
          </div>
        </div>

        <template v-else>
          <!-- 模板编辑器 -->
          <div class="panel">
            <div class="panel__header">
              <h2>{{ taskName(activeTask) }}</h2>
              <div class="pl-header-actions">
                <span v-if="hasOverride(activeTaskId)" class="tag tag--amber">自定义模板</span>
                <span v-else class="tag tag--cyan">内置模板</span>
                <button class="btn btn--sm" :disabled="!hasOverride(activeTaskId)" @click="onReset">恢复内置</button>
              </div>
            </div>
            <div class="panel__body">
              <div class="field">
                <label>System Prompt（系统提示词）</label>
                <textarea v-model="editSystem" rows="6" placeholder="定义模型的角色与行为约束..."></textarea>
              </div>
              <div class="field">
                <label>User Prompt（用户提示词）</label>
                <textarea v-model="editUser" rows="6" :placeholder="userPromptPh"></textarea>
              </div>

              <!-- 变量徽章 -->
              <div class="pl-vars">
                <span class="pl-vars__label">检测到的变量：</span>
                <span v-for="v in variables" :key="v" class="tag tag--violet" v-text="'{{' + v + '}}'"></span>
                <span v-if="!variables.length" class="hint">未检测到变量</span>
              </div>

              <div class="actions">
                <button class="btn btn--primary" :disabled="saving" @click="onSave">
                  {{ saving ? '保存中...' : '保存模板' }}
                </button>
                <button class="btn" @click="onRestoreEditor">重置编辑</button>
              </div>
            </div>
          </div>

          <!-- 测试运行 -->
          <div class="panel">
            <div class="panel__header">
              <h2>测试运行</h2>
              <span v-if="modelStore.config.provider" class="tag tag--cyan">{{ modelStore.config.provider }}</span>
            </div>
            <div class="panel__body">
              <div class="field">
                <label>变量 JSON</label>
                <textarea
                  v-model="testVarsJson"
                  rows="3"
                  spellcheck="false"
                  placeholder='{"topic":"知识图谱","lang":"中文"}'
                ></textarea>
                <div class="hint">{{ varHintText }}</div>
              </div>
              <div class="actions">
                <button class="btn btn--primary" :disabled="testing" @click="runTest">
                  <span v-if="testing" class="spinner"></span>
                  {{ testing ? '运行中...' : '运行测试' }}
                </button>
              </div>

              <transition name="fade">
                <div v-if="testResult" class="pl-test-result">
                  <div class="pl-result-block">
                    <label>渲染后 System</label>
                    <pre>{{ testResult.system }}</pre>
                  </div>
                  <div class="pl-result-block">
                    <label>渲染后 User</label>
                    <pre>{{ testResult.user }}</pre>
                  </div>
                  <div class="pl-result-block pl-result-block--resp">
                    <label>LLM 响应</label>
                    <pre>{{ testResult.response }}</pre>
                  </div>
                </div>
              </transition>
              <transition name="fade">
                <div v-if="testError" class="test-result test-result--err">
                  <div class="test-result__head">
                    <span class="dot dot--err"></span>
                    <strong>运行失败</strong>
                  </div>
                  <pre class="test-result__body">{{ testError }}</pre>
                </div>
              </transition>
            </div>
          </div>

          <!-- 调用日志 -->
          <div class="panel">
            <div class="panel__header">
              <h2>调用日志</h2>
              <div class="pl-header-actions">
                <span class="tag tag--violet">{{ promptStore.logs.length }}</span>
                <button class="btn btn--sm" @click="promptStore.loadLogs()">刷新</button>
              </div>
            </div>
            <div class="panel__body pl-logs">
              <div v-if="!promptStore.logs.length" class="empty-state">
                <p>暂无调用日志</p>
              </div>
              <div v-for="(log, i) in promptStore.logs" :key="i" class="pl-log">
                <button class="pl-log__head" @click="toggleLog(i)">
                  <span class="dot" :class="logStatusClass(log)"></span>
                  <span class="pl-log__task">{{ logTask(log) }}</span>
                  <span class="pl-log__time">{{ logTime(log) }}</span>
                  <span class="pl-log__chevron">{{ openLogs.has(i) ? '▾' : '▸' }}</span>
                </button>
                <div v-if="openLogs.has(i)" class="pl-log__body">
                  <pre>{{ formatLog(log) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { usePromptStore, useModelStore, useUiStore } from '../stores'

defineProps({
  embedded: { type: Boolean, default: false },
})

const promptStore = usePromptStore()
const modelStore = useModelStore()
const uiStore = useUiStore()

// ===== 常量 =====
const userPromptPh = '用户输入模板，使用 {{变量}} 占位...'
const varHintText = '使用 JSON 格式提供变量值，将替换模板中的 {{变量}} 占位符。'

// ===== 任务列表与选择 =====
const taskFilter = ref('')
const activeTaskId = ref(null)
const editSystem = ref('')
const editUser = ref('')

// 测试运行相关（提前声明，避免 watch immediate 调用 selectTask 时 TDZ 报错）
const testing = ref(false)
const testVarsJson = ref('{}')
const testResult = ref(null)
const testError = ref('')

const activeTask = computed(() =>
  promptStore.tasks.find((t) => t.id === activeTaskId.value) || null
)

const filteredTasks = computed(() => {
  const q = taskFilter.value.trim().toLowerCase()
  if (!q) return promptStore.tasks
  return promptStore.tasks.filter((t) => {
    return (
      taskName(t).toLowerCase().includes(q) ||
      taskDesc(t).toLowerCase().includes(q) ||
      String(t.id).toLowerCase().includes(q)
    )
  })
})

function taskName(t) {
  return t.name || t.title || t.label || t.id
}
function taskDesc(t) {
  return t.description || t.desc || ''
}
function hasOverride(id) {
  return !!promptStore.overrides[id]
}

function selectTask(t) {
  activeTaskId.value = t.id
  const tpl = promptStore.getEffectiveTemplate(t.id)
  editSystem.value = tpl.system || ''
  editUser.value = tpl.user || ''
  testResult.value = null
  testError.value = ''
}

function onRestoreEditor() {
  if (!activeTaskId.value) return
  const tpl = promptStore.getEffectiveTemplate(activeTaskId.value)
  editSystem.value = tpl.system || ''
  editUser.value = tpl.user || ''
}

// 自动选中第一个任务
watch(
  () => promptStore.tasks,
  (tasks) => {
    if (tasks.length && !activeTaskId.value) selectTask(tasks[0])
  },
  { immediate: true }
)

// ===== 变量提取与模板渲染 =====
const variables = computed(() => {
  const text = `${editSystem.value || ''}\n${editUser.value || ''}`
  const set = new Set()
  const re = /\{\{\s*([\w.]+)\s*\}\}/g
  let m
  while ((m = re.exec(text))) set.add(m[1])
  return [...set]
})

function renderTemplate(tpl, vars = {}) {
  if (!tpl) return ''
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, name) => {
    const v = vars[name]
    return v !== undefined && v !== null ? String(v) : full
  })
}

// ===== 保存 / 重置 =====
const saving = ref(false)
async function onSave() {
  if (!activeTaskId.value) return
  saving.value = true
  try {
    await promptStore.saveOverride(activeTaskId.value, {
      system: editSystem.value,
      user: editUser.value,
    })
    uiStore.toast('提示词模板已保存', 'success')
  } catch (e) {
    uiStore.toast('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

async function onReset() {
  if (!activeTaskId.value) return
  try {
    await promptStore.resetOverride(activeTaskId.value)
    const tpl = promptStore.getEffectiveTemplate(activeTaskId.value)
    editSystem.value = tpl.system || ''
    editUser.value = tpl.user || ''
    uiStore.toast('已恢复内置模板', 'success')
  } catch (e) {
    uiStore.toast('恢复失败：' + e.message, 'error')
  }
}

// ===== 测试运行 =====

async function runTest() {
  testResult.value = null
  testError.value = ''

  let vars = {}
  try {
    vars = testVarsJson.value.trim() ? JSON.parse(testVarsJson.value) : {}
  } catch (e) {
    testError.value = '变量 JSON 解析失败：' + e.message
    return
  }

  const sys = renderTemplate(editSystem.value, vars)
  const usr = renderTemplate(editUser.value, vars)

  testing.value = true
  try {
    const response = await callLLM(sys, usr)
    testResult.value = { system: sys, user: usr, response }
    // 测试完成后刷新日志
    promptStore.loadLogs().catch(() => {})
  } catch (e) {
    testError.value = e.message
  } finally {
    testing.value = false
  }
}

/**
 * 调用 LLM：
 * 1. 若配置了真实模型（非 stub 且有 baseUrl），直接请求 OpenAI 兼容接口；
 * 2. 否则返回 stub 模式提示信息。
 */
async function callLLM(system, user) {
  const cfg = modelStore.config
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  if (cfg.provider && cfg.provider !== 'stub' && cfg.baseUrl) {
    const url = String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions'
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        stream: false,
      }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 300)}`)
    }
    const data = await resp.json()
    return (
      data.choices?.[0]?.message?.content ??
      data.response ??
      JSON.stringify(data, null, 2)
    )
  }

  // Stub 模式：返回模拟响应
  return '[Stub 模式] 未配置真实 LLM 提供商。请在 AI 配置页面设置模型提供商后重试。'
}

// ===== 日志 =====
const openLogs = ref(new Set())
function toggleLog(i) {
  const s = new Set(openLogs.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  openLogs.value = s
}
function logTask(log) {
  return log.task || log.taskId || log.name || '任务调用'
}
function logTime(log) {
  const t = log.timestamp || log.time || log.created_at || log.createdAt
  if (!t) return ''
  try {
    return new Date(t).toLocaleTimeString('zh-CN')
  } catch {
    return String(t)
  }
}
function logStatusClass(log) {
  const s = (log.status || log.level || '').toString().toLowerCase()
  if (s === 'error' || s === 'err' || s === 'fail') return 'dot--err'
  if (s === 'success' || s === 'ok') return 'dot--ok'
  return 'dot--info'
}
function formatLog(log) {
  const { status, level, timestamp, time, ...rest } = log
  return JSON.stringify(rest, null, 2)
}

onMounted(() => {
  promptStore.loadLogs().catch(() => {})
})
</script>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px;
}
.page h1 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
}

.prompt-lab--embedded {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.pl-grid {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  height: 100%;
}
.pl-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}
.pl-sidebar__search {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.pl-sidebar__search input {
  font-size: 12px;
}
.pl-task-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.pl-task {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 9px 11px;
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
  transition: all 0.15s;
  margin-bottom: 2px;
}
.pl-task:hover {
  background: var(--bg-hover);
}
.pl-task--active {
  background: var(--accent-dim);
  border-color: rgba(6, 182, 212, 0.3);
}
.pl-task__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.pl-task__name {
  font-size: 13px;
  font-weight: 500;
}
.pl-task__desc {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pl-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 2px;
}
.pl-main .panel {
  margin-bottom: 12px;
}
.pl-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

/* 变量徽章 */
.pl-vars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}
.pl-vars__label {
  font-size: 11px;
  color: var(--text-2);
  margin-right: 2px;
}

/* 测试结果 */
.pl-test-result {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pl-result-block label {
  font-size: 11px;
  color: var(--accent);
  margin-bottom: 4px;
}
.pl-result-block pre {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  max-height: 160px;
  overflow-y: auto;
}
.pl-result-block--resp pre {
  border-color: rgba(6, 182, 212, 0.3);
  background: var(--accent-glow);
}

.test-result {
  margin-top: 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  overflow: hidden;
}
.test-result--err {
  background: var(--rose-dim);
  border-color: rgba(244, 63, 94, 0.35);
}
.test-result__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-size: 13px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.dot--ok {
  background: var(--emerald);
  box-shadow: 0 0 6px var(--emerald);
}
.dot--err {
  background: var(--rose);
  box-shadow: 0 0 6px var(--rose);
}
.dot--info {
  background: var(--accent);
}
.test-result__body {
  margin: 0;
  padding: 10px 12px;
  background: var(--bg-input);
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  color: var(--text);
}

/* 日志 */
.pl-logs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pl-log {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.pl-log__head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  background: var(--bg-input);
  border: none;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.pl-log__head:hover {
  background: var(--bg-hover);
}
.pl-log__task {
  flex: 1;
  text-align: left;
  font-weight: 500;
}
.pl-log__time {
  color: var(--text-3);
  font-size: 11px;
}
.pl-log__chevron {
  color: var(--text-3);
}
.pl-log__body pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--bg-deep);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-2);
  max-height: 240px;
  overflow-y: auto;
}
</style>
