<template>
  <section class="research-agent" aria-label="研究 Agent">
    <aside class="agent-history" :class="{ 'is-open': showHistory }">
      <div class="rail-heading"><strong>研究工作台</strong><button class="mobile-close" @click="showHistory = false" aria-label="关闭对话列表">×</button></div>
      <button class="btn btn--primary new-chat" :disabled="busy" @click="newConversation">＋ 新对话</button>
      <p class="rail-caption">{{ projectStore.currentProject?.name || '正在读取项目' }}</p>
      <button class="text-button" :disabled="busy" @click="showAllProjects = !showAllProjects">{{ showAllProjects ? '只看当前项目' : '查看所有项目历史' }}</button>
      <div class="conversation-list">
        <button v-for="item in visibleConversations" :key="item.id" class="conversation" :class="{ selected: item.id === selectedId }" :disabled="busy && item.id !== selectedId" @click="selectConversation(item.id)">
          <span>{{ item.title }}</span><small>{{ formatDate(item.updatedAt) }} · {{ item.messages.length }} 条消息{{ item.projectId !== projectId ? ' · 其他项目' : '' }}</small>
        </button>
      </div>
      <div class="history-actions"><button class="btn btn--sm" :disabled="busy" @click="importInput?.click()">导入对话</button><button class="btn btn--sm" :disabled="!conversation" @click="exportConversation">导出</button><button class="btn btn--sm" :disabled="busy || !conversation" @click="deleteConversation">删除</button></div>
      <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importConversation" />
      <p class="privacy-note">对话保存在当前浏览器；模型密钥不存入对话。请勿在消息中粘贴密钥。云端资料重启可能清空，请导出备份。</p>
    </aside>

    <main class="agent-main">
      <header class="agent-heading">
        <div class="heading-copy"><div class="eyebrow">KNOWSOURCE · RESEARCH AGENT</div><h1>让文献，成为下一步行动</h1><p>读资料、找证据、整理图谱，或直接问知源怎么用。</p></div>
        <div class="heading-buttons"><button class="btn btn--sm history-toggle" @click="showHistory = !showHistory">对话</button><button class="btn btn--sm context-toggle" @click="showContext = !showContext">文献与步骤</button></div>
      </header>
      <div v-if="notice || storageNotice" class="agent-notice" role="status">{{ notice || storageNotice }}</div>
      <div v-if="pollingProblem && !readOnlyHistory" class="model-alert" role="status"><span>{{ pollingProblem }}<br />这里只暂停了进度读取，服务器任务可能仍在执行；请先恢复进度，避免重复提交。</span><button class="btn btn--sm" :disabled="pollingRetrying" @click="resumeRun">{{ pollingRetrying ? '正在重新连接…' : '重新读取进度' }}</button></div>
      <div v-if="rawStorageBackup" class="model-alert"><span>原有存储无法读取，自动保存已暂停。</span><button class="btn btn--sm" @click="downloadRawBackup">下载原始备份</button><button class="btn btn--sm" @click="resetBrokenStorage">重置存储</button></div>
      <div v-if="readOnlyHistory" class="model-alert"><span>这是其他项目的历史对话，仅供查看和导出。旧文献和操作不会关联到当前项目。</span><button class="btn btn--sm" @click="newConversation">开始当前项目对话</button></div>
      <div v-if="!model.configured" class="model-alert"><span>先连接一个模型，就能开始研究。使用云端模型时，选中文献的相关内容会发送给该服务商。</span><button class="btn btn--sm" @click="uiStore.openSettings('model')">连接模型</button></div>
      <div ref="messageList" class="agent-messages" aria-live="polite" aria-relevant="additions">
        <div v-if="!conversation?.messages.length" class="agent-welcome">
          <div class="welcome-symbol" aria-hidden="true">✦</div><h2>你想从哪里开始？</h2><p>选择文献，再交给一个技能；也可以直接用自己的话描述任务。</p>
          <div class="skill-grid"><button v-for="skill in skills" :key="skill.id" class="skill-card" :disabled="busy" @click="chooseSkill(skill)"><strong>{{ skill.title }}</strong><span>{{ skill.description }}</span><small>开始这个任务 ↗</small></button></div>
          <p v-if="!skills.length" class="muted">{{ skillsLoading ? '正在读取可用技能…' : '技能暂未加载，可点击右侧“刷新状态”重试。' }}</p>
        </div>
        <article v-for="message in conversation?.messages || []" :key="message.id" class="agent-message" :class="message.role">
          <div class="message-author"><span>{{ message.role === 'user' ? '你' : '知源 Agent' }}</span><small>{{ pollingProblem && message.runId === runState?.runId ? '进度待同步' : message.status ? statusLabel(message.status) : '' }}</small></div>
          <div class="message-content">{{ message.content || (message.status === 'running' ? '正在理解任务、查找资料…' : '等待下一步操作') }}</div>
          <details v-if="message.steps?.length" class="message-steps"><summary>查看执行过程 · {{ message.steps.length }} 步</summary><ol><li v-for="step in message.steps" :key="step.id"><strong>{{ step.title }}</strong> · {{ statusLabel(step.status) }}<p v-if="step.detail">{{ step.detail }}</p></li></ol></details>
          <div v-if="message.citations?.length" class="citation-list"><button v-for="(citation, index) in message.citations" :key="`${citation.docId}-${index}`" class="citation" @click="openCitation(citation)"><span>↗ {{ citation.title || '来源文献' }}</span><small>{{ citation.excerpt }}</small></button></div>
          <div v-if="message.actions?.length" class="action-records"><details v-for="action in message.actions" :key="action.id"><summary>{{ action.title || action.tool }} · {{ action.uiResult || statusLabel(action.status) }}</summary><pre>{{ safeJson(action.args) }}</pre><p v-if="action.result">{{ typeof action.result === 'string' ? action.result : safeJson(action.result) }}</p></details></div>
        </article>
        <div v-if="!readOnlyHistory && runState?.status === 'awaiting_confirmation'" class="confirmation-box" role="region" aria-label="待确认的操作">
          <strong>请核对本批操作后再执行</strong><p>操作会按顺序执行；整批确认可保留操作之间的依赖。确认仅适用于下面的具体参数，执行后 Agent 会继续处理原任务，新增修改仍需再次确认。</p>
          <div v-for="action in pendingActions" :key="action.id" class="pending-action"><h4>{{ action.title || action.tool }}</h4><code>{{ action.tool }}</code><p v-if="action.key" class="muted">操作编号：{{ action.key }}（参数中的 $ref 指向这个编号）</p><pre>{{ safeJson(action.args) }}</pre></div>
          <div class="confirm-buttons"><button class="btn btn--primary" :disabled="actionBusy || !!pollingProblem || !pendingActions.length" @click="confirmActions">{{ actionBusy ? '正在提交…' : `确认本批 ${pendingActions.length} 项并继续` }}</button><button class="btn" :disabled="actionBusy" @click="cancelRun">停止整个任务</button></div>
        </div>
        <div v-if="importReady" class="confirmation-box"><strong>现在可以导入文献</strong><p>浏览器需要你亲自选择文件。文件只会导入当前项目，不会读取电脑上的其他资料。</p><button class="btn btn--primary" :disabled="importing" @click="documentInput?.click()">{{ importing ? '正在导入…' : '选择要导入的文献' }}</button><input ref="documentInput" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.csv,.json,.pptx,.jpg,.jpeg,.png" multiple hidden @change="importDocuments" /></div>
      </div>
      <form class="agent-composer" @submit.prevent="sendMessage">
        <div class="composer-context"><span>{{ selectedDocumentIds.length ? `已选 ${selectedDocumentIds.length}/12 篇文献` : '未限定文献 · 可检索当前项目' }}</span><button v-if="selectedSkill" type="button" class="skill-chip" @click="selectedSkill = null">{{ selectedSkill.title }} ×</button></div>
        <label class="sr-only" for="agent-message-input">给研究 Agent 的任务</label><textarea id="agent-message-input" ref="composer" v-model="draft" :disabled="busy || readOnlyHistory" maxlength="4000" rows="3" placeholder="例如：比较这几篇文献的方法和局限，并把可继续研究的方向整理为灵感。" @keydown="onComposerKeydown"></textarea>
        <div class="composer-footer"><small>Enter 发送 · Shift + Enter 换行 · {{ draft.length }}/4000</small><button v-if="busy" type="button" class="btn" :disabled="actionBusy" @click="cancelRun">停止后续步骤</button><button v-else class="btn btn--primary" :disabled="!canSend" type="submit">发送任务 ↗</button></div>
        <p class="context-note">{{ contextTrimmed ? '较早上下文已裁剪。' : '' }}每轮最多携带最近 16 条、约 7,000 字上下文；重要约束请在当前任务中重申。</p>
      </form>
    </main>

    <aside class="agent-context" :class="{ 'is-open': showContext }">
      <div class="rail-heading"><strong>当前工作范围</strong><button class="mobile-close" @click="showContext = false" aria-label="关闭工作范围">×</button></div>
      <div class="model-card"><span class="model-dot" :class="{ ready: model.configured }"></span><strong>{{ model.configured ? '模型已配置' : '尚未连接模型' }}</strong><p>{{ [model.provider, model.model].filter(Boolean).join(' / ') || '连接云端或本地模型' }}</p><div class="model-controls"><button class="text-button" @click="uiStore.openSettings('model')">模型设置</button><button class="text-button" :disabled="skillsLoading" @click="loadSkills">刷新状态</button></div></div>
      <div class="context-section">
        <div class="section-title">
          <h3>本次文献 · 最多 12 篇</h3>
          <button class="text-button" :disabled="busy || readOnlyHistory" @click="selectAllDocs">{{ selectedDocumentIds.length ? '清空' : docsStore.documents.length > 12 ? '选前 12 篇' : '全选' }}</button>
        </div>
        <p class="muted">{{ readOnlyHistory ? '历史文献范围仅作记录，不会在当前项目中使用。' : '勾选时仅检索选中文献；未勾选时可检索当前项目全文。' }}</p>
        <p v-if="selectedDocumentIds.length > 12" class="muted">历史选择超过上限，请减少到 12 篇后发送。</p>
        <div v-if="!readOnlyHistory" class="document-options">
          <label v-for="doc in docsStore.documents" :key="doc.id" class="document-option">
            <input v-model="selectedDocumentIds" type="checkbox" :value="doc.id" :disabled="busy || (selectedDocumentIds.length >= 12 && !selectedDocumentIds.includes(doc.id))" />
            <span>{{ doc.name }}</span>
          </label>
          <p v-if="!docsStore.documents.length" class="muted">还没有文献。先到“文献”页导入资料。</p>
        </div>
        <button class="text-button" @click="uiStore.setView('documents')">打开文献库 ↗</button>
      </div>
      <div class="context-section">
        <h3>任务进度</h3>
        <p v-if="!runState" class="muted">任务开始后，这里会展示真实执行步骤。</p>
        <template v-else>
          <p class="run-status">{{ pollingProblem ? '进度待同步 · 下方为最后读取的状态' : statusLabel(runState.status) }}</p>
          <p v-if="runState.rounds" class="muted">已进行 {{ runState.rounds }} 轮模型分析{{ runState.maxRounds ? ` / 最多 ${runState.maxRounds} 轮` : '' }}</p>
          <p v-if="runState.phase" class="muted">{{ phaseLabel(runState.phase) }}</p>
          <ol v-if="Array.isArray(runState.plan) && runState.plan.length" class="task-plan"><li v-for="(item, index) in runState.plan" :key="index">{{ typeof item === 'string' ? item : item.title || item.description || item.text }}<small v-if="item.status"> · {{ statusLabel(item.status) }}</small></li></ol>
        </template>
        <ol class="progress-steps"><li v-for="step in runState?.steps || []" :key="step.id"><span class="step-dot" :class="step.status"></span><div><strong>{{ step.title }}</strong><small>{{ statusLabel(step.status) }}</small><p v-if="step.detail">{{ step.detail }}</p></div></li></ol>
      </div>
      <p class="privacy-note">Agent 会先给出修改计划，再等待你确认。文献中的指令仅作为资料内容，不能替你授权操作。</p>
    </aside>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { agentApi, projectsApi } from '../api/client'
import { useDocsStore, useProjectStore, useUiStore } from '../stores'

const emit = defineEmits(['refresh'])
const docsStore = useDocsStore(), projectStore = useProjectStore(), uiStore = useUiStore()
const STORAGE_KEY = 'ks-research-agent-conversations-v1'
const MAX_SESSIONS = 24, MAX_MESSAGES = 80, MAX_STORAGE = 1_500_000
const conversations = ref([]), selectedId = ref(''), draft = ref(''), selectedSkill = ref(null)
const showAllProjects = ref(false)
const skills = ref([]), model = ref({ configured: false }), skillsLoading = ref(false)
const notice = ref(''), storageNotice = ref(''), sending = ref(false), actionBusy = ref(false)
const rawStorageBackup = ref(''), pollingProblem = ref(''), pollingRetrying = ref(false)
const showHistory = ref(false), showContext = ref(false), importInput = ref(null), messageList = ref(null), composer = ref(null), documentInput = ref(null), importing = ref(false)
let pollTimer = null, pollEpoch = 0, disposed = false, saveTimer = null
const projectId = computed(() => projectStore.currentProject?.id || '')
const projectConversations = computed(() => conversations.value.filter(c => c.projectId === projectId.value).sort((a, b) => b.updatedAt - a.updatedAt))
const visibleConversations = computed(() => showAllProjects.value ? [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt) : projectConversations.value)
const conversation = computed(() => conversations.value.find(c => c.id === selectedId.value))
const readOnlyHistory = computed(() => !!conversation.value && conversation.value.projectId !== projectId.value)
const runState = computed(() => conversation.value?.run || null)
const busy = computed(() => sending.value || importing.value || (!readOnlyHistory.value && ['running', 'awaiting_confirmation'].includes(runState.value?.status)))
const importReady = computed(() => !readOnlyHistory.value && (runState.value?.actions || []).some(a => a.tool === 'ui.import' && a.status === 'ui_ready'))
const selectedDocumentIds = computed({
  get: () => conversation.value?.documentIds || [],
  set: value => {
    if (value.length > 12 && value.length >= (conversation.value?.documentIds.length || 0)) {
      notice.value = '单轮最多选择 12 篇文献，请分批研究。'
      return
    }
    if (conversation.value && !readOnlyHistory.value) conversation.value.documentIds = value
  },
})
const pendingActions = computed(() => (runState.value?.actions || []).filter(a => ['pending', 'awaiting_confirmation', 'proposed'].includes(a.status)))
const contextTrimmed = computed(() => !!conversation.value?.trimmed || historyFor(conversation.value).trimmed)
const canSend = computed(() => !!draft.value.trim() && !busy.value && !readOnlyHistory.value && !!projectId.value && model.value.configured && selectedDocumentIds.value.length <= 12)
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
const text = (value, max = 30000) => typeof value === 'string' ? value.slice(0, max) : ''
const redact = (key, value) => /api.?key|authorization|password|secret|access.?token/i.test(key) ? '[已省略敏感字段]' : value
const safeJson = value => JSON.stringify(value ?? {}, redact, 2)
const formatDate = value => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
const statusLabel = value => ({ running: '执行中', completed: '已完成', failed: '失败', cancelled: '已停止', awaiting_confirmation: '等待确认', pending: '待确认', proposed: '待确认', success: '已完成', done: '已完成', error: '失败', skipped: '已跳过', ui_ready: '已确认，等待页面操作' }[value] || value || '')
const phaseLabel = value => typeof value === 'number' ? `第 ${value} 批操作` : ({ planning: '正在规划任务', reading: '正在阅读资料', executing: '正在执行已确认操作', analyzing: '正在分析下一步', awaiting_confirmation: '等待确认本批操作', completed: '任务已结束', failed: '任务未完成', cancelled: '任务已停止' }[value] || value)

function historyFor(session) {
  const all = (session?.messages || []).filter(m => ['user', 'assistant'].includes(m.role) && m.content)
  const result = []; let length = 0
  for (const m of all.slice(-16).reverse()) {
    if (length >= 7000) break
    const content = m.content.slice(-Math.min(1800, 7000 - length))
    result.unshift({ role: m.role, content }); length += content.length
  }
  return { messages: result, trimmed: result.length < all.length || all.some(m => m.content.length > 1800) }
}
function persist() {
  if (rawStorageBackup.value) return
  try {
    for (const c of conversations.value) if (c.messages.length > MAX_MESSAGES) { c.messages = c.messages.slice(-MAX_MESSAGES); c.trimmed = true }
    let saved = [...conversations.value].sort((a, b) => Number(b.id === selectedId.value) - Number(a.id === selectedId.value) || b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
    if (conversations.value.length > MAX_SESSIONS) storageNotice.value = '本地最多保存 24 段对话，较早记录不再保留。需要长期保存的对话请导出。'
    let encoded = JSON.stringify({ version: 1, conversations: saved }, redact)
    while (encoded.length > MAX_STORAGE && saved.length > 1) {
      const index = saved.findLastIndex(c => c.id !== selectedId.value)
      saved.splice(index, 1); encoded = JSON.stringify({ version: 1, conversations: saved }, redact)
      storageNotice.value = '本地存储达到上限，较早对话已移除。重要对话请及时导出。'
    }
    if (encoded.length > MAX_STORAGE) { storageNotice.value = '本次对话过长，暂时无法保存。请立即导出后新建对话。'; return }
    localStorage.setItem(STORAGE_KEY, encoded)
  } catch { storageNotice.value = '浏览器无法保存对话（可能空间不足或禁止存储）。本次可继续使用，请及时导出。' }
}
function sanitizeSession(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages) || typeof raw.projectId !== 'string') {
    throw new Error('不是有效的知源对话文件')
  }
  const messages = raw.messages.slice(-MAX_MESSAGES)
    .filter(message => message && ['user', 'assistant'].includes(message.role))
    .map(message => ({
      id: uid(),
      role: message.role,
      content: text(message.content),
      status: ['completed', 'failed', 'cancelled'].includes(message.status) ? message.status : undefined,
      citations: Array.isArray(message.citations) ? message.citations.slice(0, 30).filter(Boolean).map(citation => ({
        docId: text(citation.docId, 200),
        title: text(citation.title, 300),
        excerpt: text(citation.excerpt, 2000),
      })) : [],
      steps: Array.isArray(message.steps) ? message.steps.filter(Boolean).slice(0, 240) : [],
      actions: Array.isArray(message.actions) ? message.actions.filter(Boolean).slice(0, 120) : [],
    }))
  return {
    id: uid(),
    projectId: text(raw.projectId, 150),
    title: text(raw.title, 80) || '导入的对话',
    documentIds: Array.isArray(raw.documentIds) ? raw.documentIds.filter(id => typeof id === 'string').slice(0, 200) : [],
    updatedAt: Number(raw.updatedAt) || Date.now(),
    trimmed: !!raw.trimmed || raw.messages.length > MAX_MESSAGES,
    messages,
    run: null,
  }
}
function restore() {
  let original = ''
  try {
    original = localStorage.getItem(STORAGE_KEY) || ''
    if (!original) return
    if (original.length > MAX_STORAGE * 2) throw new Error('存储内容过大')
    const data = JSON.parse(original)
    if (data.version !== 1 || !Array.isArray(data.conversations)) throw new Error('格式不支持')
    conversations.value = data.conversations.slice(0, MAX_SESSIONS).map(item => {
      const restored = sanitizeSession(item)
      // Only locally saved runs can resume; importing a file never authorizes an action.
      restored.id = text(item.id, 150) || uid()
      restored.handledUiActions = item.handledUiActions && typeof item.handledUiActions === 'object' ? item.handledUiActions : {}
      const savedMessages = item.messages.slice(-MAX_MESSAGES).filter(m => m && ['user', 'assistant'].includes(m.role))
      restored.messages.forEach((message, index) => { if (savedMessages[index]?.runId) message.runId = text(savedMessages[index].runId, 150) })
      if (item.run && typeof item.run.runId === 'string') restored.run = item.run
      return restored
    })
  } catch {
    rawStorageBackup.value = original
    storageNotice.value = '已有对话无法恢复。原始记录保留在浏览器中；下载备份并重置后才能恢复自动保存。'
  }
}
function downloadRawBackup() {
  const url = URL.createObjectURL(new Blob([rawStorageBackup.value], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = '知源对话-原始存储备份.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function resetBrokenStorage() {
  uiStore.showConfirm({
    title: '重置损坏的对话存储？',
    message: '请先下载原始备份。重置后会用当前页面中的对话替换无法读取的记录，项目文献不受影响。',
    confirmText: '重置并保存',
    onConfirm: () => {
      rawStorageBackup.value = ''
      storageNotice.value = ''
      persist()
      uiStore.closeConfirm()
    },
  })
}
function newConversation() {
  if (busy.value || !projectId.value) return
  const session = { id: uid(), title: '新的研究对话', projectId: projectId.value, documentIds: docsStore.selectedDocId ? [docsStore.selectedDocId] : [], messages: [], updatedAt: Date.now(), run: null, trimmed: false }
  conversations.value.unshift(session); selectedId.value = session.id
  draft.value = ''; selectedSkill.value = null; notice.value = ''; pollingProblem.value = ''; showHistory.value = false
  stopPolling(); persist()
}
function selectConversation(id) {
  if (busy.value && selectedId.value !== id) return
  selectedId.value = id
  pollingProblem.value = ''
  draft.value = ''
  selectedSkill.value = null
  showHistory.value = false
  resumeRun()
}
function ensureConversation() {
  if (!projectId.value) return
  const recent = projectConversations.value[0]
  if (recent) selectConversation(recent.id)
  else newConversation()
}
function consumeAgentEntry() {
  const entry = uiStore.agentEntry
  if (!entry) return
  if (busy.value) {
    notice.value = '已保留这篇文献的精读请求。请先完成或停止当前任务，再重新打开 Agent。'
    return
  }
  if (!projectId.value || !docsStore.documents.some(doc => doc.id === entry.docId)) {
    notice.value = '精读文献已不在当前项目中，请返回文献库重新选择。'
    uiStore.agentEntry = null
    return
  }
  if (!conversation.value || readOnlyHistory.value || conversation.value.messages.length) newConversation()
  if (!conversation.value) return
  conversation.value.documentIds = [entry.docId]
  draft.value = entry.prompt || '精读这篇文献，梳理研究问题、方法、结论、局限与原文依据。'
  selectedSkill.value = null
  uiStore.agentEntry = null
  notice.value = '已选中要精读的文献，请核对任务后发送。'
  persist()
}
function deleteConversation() {
  const current = conversation.value
  if (!current || busy.value) return
  uiStore.showConfirm({ title: '删除这段对话？', message: `将删除“${current.title}”在当前浏览器的记录，不会删除项目文献。`, confirmText: '删除对话', onConfirm: () => { conversations.value = conversations.value.filter(c => c.id !== current.id); selectedId.value = ''; uiStore.closeConfirm(); ensureConversation(); persist() } })
}
function exportConversation() {
  if (!conversation.value) return
  const blob = new Blob([JSON.stringify({ version: 1, ...conversation.value, run: null }, redact, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = `知源对话-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function importConversation(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy.value) return
  try {
    if (file.size > 2_000_000) throw new Error('对话文件不能超过 2 MB')
    const imported = sanitizeSession(JSON.parse(await file.text()))
    if (imported.projectId !== projectId.value) throw new Error('这份对话属于另一个项目。请先切换到对应项目再导入，避免混用文献。')
    imported.documentIds = imported.documentIds.filter(id => docsStore.documents.some(d => d.id === id))
    imported.updatedAt = Date.now(); conversations.value.unshift(imported); selectConversation(imported.id); persist(); notice.value = '已导入对话。历史操作仅供查看，不会自动重新执行。'
  } catch (error) { notice.value = error.message || '导入失败' }
}
async function loadSkills() {
  if (skillsLoading.value) return
  skillsLoading.value = true
  try { const result = await agentApi.skills(); if (disposed) return; skills.value = result.skills || []; model.value = result.model || { configured: false } }
  catch (error) { notice.value = `无法读取 Agent 状态：${error.message}` }
  finally { skillsLoading.value = false }
}
function chooseSkill(skill) { selectedSkill.value = skill; draft.value = skill.prompt || skill.description || skill.title; nextTick(() => composer.value?.focus()) }
function selectAllDocs() {
  if (busy.value || readOnlyHistory.value) return
  if (selectedDocumentIds.value.length) {
    selectedDocumentIds.value = []
    return
  }
  selectedDocumentIds.value = docsStore.documents.slice(0, 12).map(doc => doc.id)
  if (docsStore.documents.length > 12) notice.value = '单轮最多 12 篇，已选列表前 12 篇。请核对范围，剩余文献可分批研究。'
}
function onComposerKeydown(event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage() } }
function stopPolling() { pollEpoch++; clearTimeout(pollTimer); pollTimer = null; pollingRetrying.value = false }
function mergeRecords(previous, incoming) {
  const records = new Map((previous || []).map(item => [item.id, item]))
  for (const item of incoming || []) records.set(item.id, { ...records.get(item.id), ...item })
  return [...records.values()]
}
function applySnapshot(session, snapshot) {
  const previous = session.run?.runId === snapshot.runId ? session.run : null
  const previousActions = new Map((previous?.actions || []).map(action => [action.id, action.status]))
  snapshot = {
    ...previous, ...snapshot,
    steps: mergeRecords(previous?.steps, snapshot.steps),
    actions: mergeRecords(previous?.actions, snapshot.actions),
    citations: snapshot.citations ?? previous?.citations ?? [],
  }
  const terminal = ['completed', 'failed', 'cancelled'].includes(snapshot.status)
  if (terminal) snapshot.steps = snapshot.steps.map(step => step.status === 'running' ? { ...step, status: snapshot.status === 'completed' ? 'completed' : snapshot.status } : step)
  session.run = snapshot
  let message = session.messages.find(m => m.runId === snapshot.runId)
  if (!message) { message = { id: uid(), role: 'assistant', runId: snapshot.runId, content: '' }; session.messages.push(message) }
  const answer = text(snapshot.answer)
  const failure = snapshot.status === 'failed' ? `任务已停止：${text(snapshot.error) || '未能完成任务。'}\n已执行的操作仍然保留，可查看下方记录后决定下一步。` : ''
  Object.assign(message, { status: snapshot.status, content: failure ? (answer && answer !== snapshot.error ? `${answer}\n\n${failure}` : failure) : answer || (snapshot.status === 'cancelled' ? '已停止后续步骤。已完成的修改不会撤销。' : ''), steps: snapshot.steps, citations: snapshot.citations, actions: snapshot.actions })
  session.updatedAt = Date.now(); persist()
  if ((terminal && previous?.status !== snapshot.status) || snapshot.actions.some(action => ['completed', 'done', 'success', 'ui_ready'].includes(action.status) && previousActions.get(action.id) !== action.status)) emit('refresh')
  applyUiActions(session, snapshot)
  nextTick(() => { const box = messageList.value; if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 220) box.scrollTop = box.scrollHeight })
}
function pollRun(session, runId) {
  stopPolling(); const epoch = pollEpoch
  let failures = 0
  pollingRetrying.value = !!pollingProblem.value
  async function poll() {
    if (disposed || epoch !== pollEpoch) return
    try {
      const snapshot = await agentApi.status(runId)
      if (disposed || epoch !== pollEpoch) return
      if (snapshot.runId !== runId || !['running', 'completed', 'failed', 'cancelled', 'awaiting_confirmation'].includes(snapshot.status)) throw new Error(snapshot.error || '服务器未返回有效任务进度')
      failures = 0; pollingProblem.value = ''; pollingRetrying.value = false
      applySnapshot(session, snapshot)
      if (snapshot.status === 'running') pollTimer = setTimeout(poll, 1200)
    } catch (error) {
      if (disposed || epoch !== pollEpoch) return
      if ([404, 410].includes(error.status) || (error.status === 400 && /任务不存在|已过期|服务重启/.test(error.message))) {
        pollingProblem.value = ''; pollingRetrying.value = false
        applySnapshot(session, { ...session.run, status: 'failed', error: '任务已过期或服务已重启，请重新发起。' })
        return
      }
      failures++
      pollingProblem.value = `暂时无法同步进度：${error.message}${failures < 4 ? `（正在自动重连 ${failures}/3）` : '。自动重连已暂停。'}`
      pollingRetrying.value = failures < 4
      if (failures < 4) pollTimer = setTimeout(poll, Math.min(2000 * 2 ** (failures - 1), 10000))
    }
  }
  poll()
}
function resumeRun() {
  stopPolling()
  const session = conversation.value
  if (session?.projectId === projectId.value && session?.run?.runId && ['running', 'awaiting_confirmation'].includes(session.run.status)) {
    pollRun(session, session.run.runId)
  }
}
async function sendMessage() {
  if (!canSend.value) return
  const session = conversation.value; if (!session) return
  const message = draft.value.trim(), history = historyFor(session)
  const validIds = session.documentIds.filter(id => docsStore.documents.some(d => d.id === id))
  if (validIds.length !== session.documentIds.length) { session.documentIds = validIds; notice.value = '部分文献已不存在，已从选择中移除。请核对后重新发送。'; return }
  sending.value = true; notice.value = ''; pollingProblem.value = ''; session.trimmed ||= history.trimmed
  session.messages.push({ id: uid(), role: 'user', content: message }); session.updatedAt = Date.now()
  if (session.messages.length === 1) session.title = message.slice(0, 32)
  draft.value = ''; persist()
  try {
    const result = await agentApi.run({ message, history: history.messages, documentIds: validIds, projectId: session.projectId, skillId: selectedSkill.value?.id })
    if (!result.runId) throw new Error(result.error || '服务器没有返回任务编号')
    session.run = { runId: result.runId, status: 'running', steps: [], actions: [] }; selectedSkill.value = null
    applySnapshot(session, session.run); if (!disposed) pollRun(session, result.runId)
  } catch (error) { session.messages.push({ id: uid(), role: 'assistant', status: 'failed', content: `未能启动任务：${error.message}` }); persist() }
  finally { sending.value = false; nextTick(() => { if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight }) }
}
async function confirmActions() {
  const session = conversation.value, ids = pendingActions.value.map(a => a.id)
  if (!session?.run?.runId || !ids.length || actionBusy.value || pollingProblem.value || session.projectId !== projectId.value) return
  actionBusy.value = true; notice.value = ''
  try {
    const result = await agentApi.confirm(session.run.runId, ids)
    if (result?.runId && result?.status) applySnapshot(session, result)
    // The confirmation response can already be terminal or awaiting the next batch.
    if (['running', 'awaiting_confirmation'].includes(session.run.status)) pollRun(session, session.run.runId)
  }
  catch (error) { notice.value = `确认结果暂未核实：${error.message}。正在读取服务器状态，请勿重复确认。`; pollRun(session, session.run.runId) }
  finally { actionBusy.value = false }
}
async function cancelRun() {
  const session = conversation.value; if (!session?.run?.runId || actionBusy.value) return
  actionBusy.value = true
  try {
    const result = await agentApi.cancel(session.run.runId)
    stopPolling()
    pollingProblem.value = ''
    applySnapshot(session, { ...session.run, ...result, runId: session.run.runId, status: result.status || session.run.status })
    if (['running', 'awaiting_confirmation'].includes(session.run.status)) { notice.value = '停止请求已发送；已经开始的操作可能仍会完成，正在等待最终状态。'; pollRun(session, session.run.runId) }
    emit('refresh')
  }
  catch (error) { notice.value = `停止请求未成功：${error.message}。任务可能仍在运行。`; }
  finally { actionBusy.value = false }
}
function downloadJson(payload, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function applyUiActions(session, snapshot) {
  if (session.projectId !== projectId.value || session.id !== selectedId.value || disposed) return
  session.handledUiActions ||= {}
  for (const action of snapshot.actions || []) {
    if (action.status !== 'ui_ready' || !['ui.navigate', 'ui.import', 'ui.export', 'ui.settings'].includes(action.tool)) continue
    const key = `${snapshot.runId}:${action.id}`
    if (session.handledUiActions[key]) { action.uiResult = session.handledUiActions[key]; continue }
    if (action.tool === 'ui.import') continue // The file chooser requires a direct user gesture.
    session.handledUiActions[key] = '正在执行页面操作'; persist()
    try {
      if (action.tool === 'ui.navigate') {
        const page = { literature: 'documents', graph: 'graph', ideas: 'idea' }[action.args?.page]
        if (!page) throw new Error('不支持的页面')
        session.handledUiActions[key] = '已打开页面'; persist(); uiStore.setView(page)
      } else if (action.tool === 'ui.settings') {
        session.handledUiActions[key] = '已打开模型设置'; persist(); uiStore.openSettings('model')
      } else if (action.tool === 'ui.export') {
        const result = await projectsApi.export(session.projectId)
        if (result?.error) throw new Error(result.error)
        downloadJson(result, `知源项目备份-${new Date().toISOString().slice(0, 10)}.json`)
        session.handledUiActions[key] = '已发起项目备份下载'
      }
    } catch (error) { session.handledUiActions[key] = `页面操作失败：${error.message}`; notice.value = session.handledUiActions[key] }
    action.uiResult = session.handledUiActions[key]; persist()
  }
}
async function importDocuments(event) {
  const files = Array.from(event.target.files || []); event.target.value = ''
  const session = conversation.value
  if (!files.length || !session || !importReady.value || importing.value) return
  importing.value = true; let successful = 0
  const failures = []
  try {
    for (const file of files.slice(0, 20)) {
      if (session.projectId !== projectId.value) { failures.push('项目已切换，后续文件停止导入'); break }
      const limit = window.__KS_HOSTED_TRIAL__ ? 10 : 50
      if (file.size > limit * 1024 * 1024) { failures.push(`${file.name} 超过 ${limit} MB`); continue }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        const ext = file.name.split('.').pop().toLowerCase(), type = ({ markdown: 'md', jpeg: 'jpg', htm: 'html' })[ext] || ext
        const result = await docsStore.parseFile({ name: file.name, content: btoa(binary), type })
        if (result?.error || result?.success === false) throw new Error(result.error || '解析未完成')
        successful++
      } catch (error) { failures.push(`${file.name}：${error.message}`) }
    }
    if (files.length > 20) failures.push('单次最多导入 20 个文件，其余未处理')
    const resultText = `导入完成：${successful} 个成功${failures.length ? `；${failures.join('；')}` : ''}`
    notice.value = resultText; session.messages.push({ id: uid(), role: 'assistant', status: failures.length ? 'failed' : 'completed', content: resultText })
    session.updatedAt = Date.now(); persist(); emit('refresh')
  } finally { importing.value = false }
}
function openCitation(citation) {
  if (readOnlyHistory.value) { notice.value = '这是其他项目的历史引用。请切换到原项目后再打开，当前项目不会关联这份文献。'; return }
  if (!docsStore.documents.some(d => d.id === citation.docId)) { notice.value = '来源文献已不在当前项目中，可能已删除或云端试用空间已重启。'; return }
  docsStore.selectDoc(citation.docId)
  uiStore.setView('documents')
  if (window.matchMedia('(max-width: 760px)').matches) uiStore.leftPanelVisible = false
}
watch(projectId, (value, old) => { if (value !== old) { stopPolling(); pollingProblem.value = ''; selectedId.value = ''; draft.value = ''; selectedSkill.value = null; ensureConversation(); if (old) notice.value = '已切换项目，对话与文献范围同步切换。' } })
watch(() => uiStore.settingsOpen, (open, previous) => { if (previous && !open) loadSkills() })
watch(() => uiStore.activeView, view => {
  if (view === 'agent') { consumeAgentEntry(); loadSkills(); resumeRun() }
})
watch(() => uiStore.agentEntry, entry => {
  if (entry && uiStore.activeView === 'agent') consumeAgentEntry()
})
watch(conversations, () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300) }, { deep: true })
onMounted(async () => {
  restore()
  if (!projectId.value) await projectStore.load()
  if (disposed) return
  ensureConversation()
  consumeAgentEntry()
  loadSkills()
})
onBeforeUnmount(() => { disposed = true; stopPolling(); clearTimeout(saveTimer); persist() })
</script>

<style scoped>
.task-plan{font-size:11px;line-height:1.8;padding-left:18px;color:var(--text-2)}.step-dot.failed,.step-dot.error{background:#c74747}.step-dot.cancelled{background:var(--text-3)}
.research-agent{display:grid;grid-template-columns:220px minmax(0,1fr) 280px;height:100%;min-height:0;overflow:hidden;background:var(--bg-void);color:var(--text)}
.agent-history,.agent-context{min-height:0;overflow-y:auto;padding:22px 16px;background:var(--bg-card)}.agent-history{display:flex;flex-direction:column;border-right:1px solid var(--border)}.agent-context{border-left:1px solid var(--border)}
.rail-heading{display:flex;align-items:center;justify-content:space-between;font-size:14px;margin-bottom:18px}.new-chat{width:100%;justify-content:center}.rail-caption{font-size:11px;color:var(--text-3);margin:20px 0 8px;overflow-wrap:anywhere}.conversation-list{flex:1;overflow:auto;min-height:80px}.conversation{display:block;width:100%;text-align:left;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--text-2);padding:12px;margin-bottom:5px;cursor:pointer}.conversation.selected{background:var(--accent-dim);border-color:var(--accent-dim);color:var(--accent)}.conversation span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.conversation small{display:block;font-size:10px;color:var(--text-3);margin-top:6px}.history-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:16px}.privacy-note{font-size:10px;line-height:1.8;color:var(--text-3);margin:16px 0 0}.agent-main{display:flex;flex-direction:column;min-width:0;min-height:0}.agent-heading{display:flex;align-items:center;justify-content:space-between;padding:24px 30px 18px;border-bottom:1px solid var(--border);gap:12px}.eyebrow{font-size:9px;letter-spacing:2px;color:var(--accent);font-weight:700}.agent-heading h1{font-size:20px;font-weight:600;letter-spacing:-.5px;margin:7px 0}.agent-heading p{font-size:12px;color:var(--text-2);margin:0}.heading-buttons{display:flex;gap:5px}.history-toggle,.context-toggle,.mobile-close{display:none}.agent-notice{margin:12px 24px 0;padding:10px 12px;background:var(--accent-dim);border-radius:8px;font-size:12px;line-height:1.6}.model-alert{display:flex;align-items:center;gap:10px;padding:12px 24px;font-size:12px;line-height:1.6;color:var(--text-2);background:var(--bg-deep)}.model-alert span{flex:1}.model-alert button{white-space:nowrap}.agent-messages{flex:1;min-height:0;overflow-y:auto;padding:24px 30px;scroll-behavior:smooth}.agent-welcome{max-width:740px;margin:25px auto 30px}.welcome-symbol{width:48px;height:48px;background:var(--accent-dim);border-radius:14px;display:grid;place-items:center;color:var(--accent);font-size:27px;margin-bottom:18px}.agent-welcome h2{font-size:24px;letter-spacing:-.5px;margin:0 0 10px}.agent-welcome>p{font-size:13px;line-height:1.8;color:var(--text-2)}.skill-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:25px}.skill-card{display:flex;flex-direction:column;text-align:left;gap:9px;padding:17px;border:1px solid var(--border);background:var(--bg-card);border-radius:13px;color:var(--text);cursor:pointer;transition:border-color .15s,transform .15s}.skill-card:hover{border-color:var(--accent);transform:translateY(-2px)}.skill-card strong{font-size:13px}.skill-card span{font-size:11px;color:var(--text-2);line-height:1.7;flex:1}.skill-card small{font-size:10px;color:var(--accent);margin-top:8px}.agent-message{margin-bottom:24px;border:1px solid var(--border);padding:18px;border-radius:14px;background:var(--bg-card)}.agent-message.user{margin-left:45px;background:var(--accent-glow)}.message-author{display:flex;justify-content:space-between;font-weight:600;font-size:12px;margin-bottom:12px;color:var(--accent)}.message-author small{font-weight:400;color:var(--text-3)}.message-content{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.9}.message-steps,.action-records{font-size:11px;color:var(--text-2);margin-top:12px}.message-steps summary,.action-records summary{cursor:pointer;padding:7px 0}.message-steps ol{padding-left:20px}.message-steps p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.citation-list{display:flex;flex-direction:column;gap:6px;margin-top:14px}.citation{border:1px solid var(--border);border-radius:8px;background:var(--bg-void);padding:9px;text-align:left;color:var(--accent);cursor:pointer}.citation span{display:block;font-size:11px}.citation small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.6;font-size:10px;color:var(--text-2);margin-top:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:11px;line-height:1.7;background:var(--bg-input);padding:10px;border-radius:7px}.confirmation-box{padding:20px;border:1px solid var(--accent);border-radius:12px;background:var(--accent-glow);margin-bottom:20px}.confirmation-box>strong{font-size:15px}.confirmation-box p{font-size:12px;line-height:1.7;color:var(--text-2)}.pending-action h4{margin:14px 0 5px;font-size:12px}.pending-action code{font-size:10px;color:var(--text-3)}.confirm-buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.agent-composer{padding:12px 24px 15px;border-top:1px solid var(--border);background:var(--bg-card)}.composer-context{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;font-size:10px;color:var(--text-3)}.skill-chip{background:var(--accent-dim);color:var(--accent);border:0;border-radius:20px;padding:4px 8px;font-size:10px;cursor:pointer}.agent-composer textarea{resize:vertical;min-height:75px;max-height:180px;border-radius:10px;padding:12px;line-height:1.6;background:var(--bg-void)}.composer-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px}.composer-footer small,.context-note{font-size:10px;color:var(--text-3)}.context-note{margin:9px 0 0;line-height:1.5}.model-card{background:var(--bg-void);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px}.model-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--text-3);margin-right:7px}.model-dot.ready{background:var(--accent)}.model-card p{font-size:11px;color:var(--text-2);overflow-wrap:anywhere;line-height:1.7;margin:8px 0}.model-controls{display:flex;justify-content:space-between;gap:8px}.text-button{border:0;background:transparent;color:var(--accent);font-size:11px;padding:4px 0;cursor:pointer}.context-section{margin-top:24px;padding-top:18px;border-top:1px solid var(--border)}.context-section h3{font-size:12px;margin:0 0 9px}.section-title{display:flex;justify-content:space-between;align-items:center}.section-title h3{margin:0}.muted{color:var(--text-3);font-size:11px;line-height:1.7}.document-options{max-height:270px;overflow-y:auto;margin:12px 0}.document-option{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.7;cursor:pointer;padding:7px 0}.document-option input{width:14px;height:14px;margin-top:3px;accent-color:var(--accent);flex-shrink:0}.document-option span{overflow-wrap:anywhere}.run-status{font-size:11px;color:var(--accent)}.progress-steps{list-style:none;margin:12px 0;padding:0}.progress-steps li{display:flex;gap:9px;margin-bottom:16px}.step-dot{width:7px;height:7px;border-radius:50%;background:var(--text-3);margin-top:5px;flex-shrink:0}.step-dot.completed,.step-dot.success,.step-dot.running{background:var(--accent)}.progress-steps strong{font-size:11px;display:block}.progress-steps small{font-size:10px;color:var(--text-3)}.progress-steps p{font-size:10px;line-height:1.7;color:var(--text-2);overflow-wrap:anywhere;margin:5px 0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:1200px){.research-agent{grid-template-columns:180px minmax(0,1fr) 230px}.agent-heading{padding:20px}.agent-heading h1{font-size:18px}.agent-messages{padding:20px}.agent-context,.agent-history{padding:18px 12px}}
@media(max-width:1000px){.research-agent{grid-template-columns:180px minmax(0,1fr);position:relative}.agent-context{display:none}.agent-context.is-open{display:block;position:absolute;right:0;top:0;bottom:0;width:min(320px,90%);z-index:5;box-shadow:-8px 0 30px #0002}.context-toggle,.agent-context .mobile-close{display:block}.mobile-close{background:transparent;border:0;color:var(--text);font-size:24px;cursor:pointer}.agent-heading h1{font-size:17px}}
@media(max-width:650px){.research-agent{grid-template-columns:minmax(0,1fr)}.agent-history{display:none}.agent-history.is-open{display:flex;position:absolute;left:0;top:0;bottom:0;width:min(280px,90%);z-index:6;box-shadow:8px 0 30px #0002}.history-toggle,.agent-history .mobile-close{display:block}.agent-heading{padding:15px;flex-wrap:wrap}.agent-heading h1{font-size:18px}.agent-heading p{font-size:11px}.eyebrow{font-size:8px}.heading-buttons{margin-left:auto}.agent-messages{padding:15px}.agent-welcome{margin:10px auto}.agent-welcome h2{font-size:21px}.skill-grid{gap:8px;margin-top:17px}.skill-card{padding:12px}.skill-card strong{font-size:12px}.skill-card span{font-size:10px}.agent-message{padding:13px}.agent-message.user{margin-left:15px}.agent-composer{padding:10px 12px}.composer-footer small{font-size:9px}.agent-composer textarea{font-size:16px}.context-note{font-size:9px}.agent-notice{margin:10px 12px 0}.model-alert{padding:10px 12px;font-size:11px}}
</style>
