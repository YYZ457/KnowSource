<template>
  <!-- 模型配置面板：当 embedded 为 true 时作为面板渲染，否则作为独立页面 -->
  <div :class="embedded ? 'model-lab model-lab--embedded' : 'page model-lab'">
    <div v-if="!embedded" class="page__head">
      <h1>模型配置</h1>
      <p class="page__sub">配置大语言模型接入参数，支持 OpenAI 兼容协议的各厂商接口。</p>
    </div>

    <div class="panel">
      <div class="panel__header">
        <h2>模型配置</h2>
        <span class="tag" :class="statusTagClass">{{ statusLabel }}</span>
      </div>
      <div class="panel__body">
        <!-- Provider 选择 -->
        <div class="field">
          <label>服务商 Provider</label>
          <select v-model="modelStore.config.provider" @change="onProviderChange">
            <option v-for="p in providers" :key="p.key" :value="p.key">{{ p.label }}</option>
          </select>
          <div class="hint">{{ providerHint }}</div>
          <!-- Ollama 检测状态 -->
          <div v-if="modelStore.config.provider === 'ollama'" class="ollama-status">
            <span v-if="ollamaDetecting" class="hint">正在检测 Ollama 服务...</span>
            <span v-else-if="ollamaDetected" class="hint" style="color: var(--green-6)">
              Ollama 已连接 · {{ ollamaModels.length }} 个模型可用
              <button class="btn-text" @click="detectOllamaModels">刷新</button>
            </span>
            <span v-else class="hint" style="color: var(--rose-6)">
              未检测到 Ollama
              <button class="btn-text" @click="detectOllamaModels">重试</button>
            </span>
          </div>
        </div>

        <div class="field-row">
          <!-- 模型名称（带 datalist 建议） -->
          <div class="field">
            <label>模型名称 Model</label>
            <input
              type="text"
              v-model="modelStore.config.model"
              list="ks-model-suggestions"
              :placeholder="modelStore.config.provider === 'ollama' ? '从下拉列表选择或手动输入' : '例如 gpt-4o-mini'"
              autocomplete="off"
            />
            <datalist id="ks-model-suggestions">
              <option v-for="m in currentModels" :key="m" :value="m" />
            </datalist>
          </div>

          <!-- API Key -->
          <div class="field">
            <label>API Key</label>
            <input
              type="password"
              v-model="modelStore.config.apiKey"
              :placeholder="apiKeyPlaceholder"
              autocomplete="new-password"
            />
          </div>
        </div>

        <!-- Base URL -->
        <div class="field">
          <label>Base URL</label>
          <input
            type="text"
            v-model="modelStore.config.baseUrl"
            placeholder="https://api.openai.com/v1"
            spellcheck="false"
          />
          <div class="hint">OpenAI 兼容接口地址，切换服务商时自动填充，可手动修改。</div>
        </div>

        <!-- 操作按钮 -->
        <div class="actions">
          <button class="btn btn--primary" :disabled="modelStore.testing || !canTest" @click="onTest">
            <span v-if="modelStore.testing" class="spinner"></span>
            <span>{{ modelStore.testing ? '测试中...' : '测试连接' }}</span>
          </button>
          <button class="btn" :disabled="saving" @click="onSave">
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
        </div>

        <!-- 测试结果 -->
        <transition name="fade">
          <div
            v-if="modelStore.testResult"
            class="test-result"
            :class="modelStore.testResult.success ? 'test-result--ok' : 'test-result--err'"
          >
            <div class="test-result__head">
              <span class="dot" :class="modelStore.testResult.success ? 'dot--ok' : 'dot--err'"></span>
              <strong>{{ modelStore.testResult.success ? '连接成功' : '连接失败' }}</strong>
              <span v-if="modelStore.testResult.success" class="hint">响应预览：</span>
            </div>
            <pre class="test-result__body">{{ resultPreview }}</pre>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useModelStore, useUiStore } from '../stores'
import { settingsApi } from '../api/client'

defineProps({
  embedded: { type: Boolean, default: false },
})

const modelStore = useModelStore()
const uiStore = useUiStore()

// ===== Ollama 动态模型检测 =====
const ollamaModels = ref([])       // 从 Ollama API 获取的已安装模型列表
const ollamaDetecting = ref(false) // 检测状态
const ollamaDetected = ref(false)  // 是否已检测到 Ollama

async function detectOllamaModels() {
  if (modelStore.config.provider !== 'ollama') return
  ollamaDetecting.value = true
  try {
    const resp = await settingsApi.getOllamaStatus()
    if (resp.success && resp.available) {
      ollamaDetected.value = true
      // resp.models 格式: [{ name: 'qwen2.5:1.5b', size: '...'}, ...]
      const installed = (resp.models || []).map(m => m.name || m)
      ollamaModels.value = installed
      if (installed.length > 0) {
        // 自动选中第一个模型（仅当当前为空时）
        if (!modelStore.config.model) {
          modelStore.config.model = installed[0]
        }
        uiStore.toast(`检测到 ${installed.length} 个已安装模型`, 'success')
      } else {
        uiStore.toast('Ollama 已运行但未安装模型，请先 ollama pull <model>', 'warn')
      }
    } else {
      ollamaDetected.value = false
      ollamaModels.value = []
      const msg = resp.error || '未检测到 Ollama 服务'
      uiStore.toast(msg + '，请确认已启动 ollama serve', 'error')
    }
  } catch (e) {
    ollamaDetected.value = false
    ollamaModels.value = []
    console.warn('[ModelLab] Ollama 检测失败:', e.message)
  } finally {
    ollamaDetecting.value = false
  }
}

// ===== 厂商预设 =====
const PROVIDERS = {
  stub: {
    label: 'Stub（本地模拟）',
    hint: '不调用真实模型，用于离线开发与调试。',
    baseUrl: '',
    models: [],
  },
  openai: {
    label: 'OpenAI',
    hint: '官方 OpenAI 接口，兼容协议标准实现。',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
  deepseek: {
    label: 'DeepSeek 深度求索',
    hint: 'DeepSeek 官方接口。',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
  },
  siliconflow: {
    label: 'SiliconFlow 硅基流动',
    hint: '硅基流动聚合推理服务。',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  openrouter: {
    label: 'OpenRouter',
    hint: '聚合路由，可访问多家厂商模型。',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5'],
  },
  moonshot: {
    label: 'Moonshot 月之暗面',
    hint: 'Kimi 系列模型接口。',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k'],
  },
  qwen: {
    label: 'Qwen 通义千问',
    hint: '阿里云 DashScope 兼容模式。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo'],
  },
  zhipu: {
    label: 'Zhipu 智谱',
    hint: 'GLM 系列模型接口。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4'],
  },
  ollama: {
    label: 'Ollama（本地）',
    hint: '本地推理服务，无需 API Key。选择后自动检测已安装的模型。',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['qwen2.5:1.5b', 'qwen2.5:7b', 'deepseek-r1:7b', 'llama3.2:3b', 'nomic-embed-text'],
  },
  custom: {
    label: '自定义',
    hint: '手动填写 Base URL 与模型名。',
    baseUrl: '',
    models: [],
  },
}

const providers = computed(() =>
  Object.entries(PROVIDERS).map(([key, v]) => ({ key, ...v }))
)

const currentModels = computed(() => {
  const preset = PROVIDERS[modelStore.config.provider]?.models || []
  if (modelStore.config.provider === 'ollama') {
    // Ollama：合并动态检测的模型和预设模型（去重）
    const set = new Set([...ollamaModels.value, ...preset])
    return Array.from(set)
  }
  return preset
})
const providerHint = computed(
  () => PROVIDERS[modelStore.config.provider]?.hint || ''
)
const apiKeyPlaceholder = computed(() => {
  const p = modelStore.config.provider
  if (p === 'stub') return '本地模拟，无需 API Key'
  if (p === 'ollama') return '本地服务，无需 API Key'
  return 'sk-...'
})

// 配置完整性状态
const statusLabel = computed(() => {
  const { provider, model, apiKey } = modelStore.config
  if (provider === 'stub') return '模拟模式'
  if (!model) return '未配置'
  if (provider !== 'ollama' && !apiKey) return '缺少 Key'
  return '就绪'
})
const statusTagClass = computed(() => {
  const { provider, model, apiKey } = modelStore.config
  if (provider === 'stub') return 'tag--violet'
  if (!model || (provider !== 'ollama' && !apiKey)) return 'tag--rose'
  return 'tag--emerald'
})

const canTest = computed(() => {
  const { provider, model, apiKey } = modelStore.config
  if (provider === 'stub') return true
  if (provider === 'ollama') return !!model
  // 非本地服务需要同时填写 model 和 apiKey
  return !!model && !!apiKey
})

const saving = ref(false)

// 切换服务商时自动填充 baseUrl，并重置不兼容的依赖字段
function onProviderChange() {
  const preset = PROVIDERS[modelStore.config.provider]
  if (preset && modelStore.config.provider !== 'custom') {
    modelStore.config.baseUrl = preset.baseUrl
  }
  // 重置 model 名称，避免旧 provider 的模型名不适用于新 provider
  modelStore.config.model = ''
  // 切换到 stub/ollama 时清空 apiKey（这些 provider 不需要 key）
  if (modelStore.config.provider === 'stub' || modelStore.config.provider === 'ollama') {
    modelStore.config.apiKey = ''
  }
  // 修复：清除旧的 testResult，避免切换后仍显示上一个 provider 的测试结果
  modelStore.testResult = null
  // 切换到 Ollama 时自动检测已安装的模型
  if (modelStore.config.provider === 'ollama') {
    detectOllamaModels()
  }
}

// 初始化：若 baseUrl 为空则按当前 provider 填充
watch(
  () => modelStore.config.provider,
  (p, old) => {
    if (!old && !modelStore.config.baseUrl) {
      const preset = PROVIDERS[p]
      if (preset) modelStore.config.baseUrl = preset.baseUrl
    }
  },
  { immediate: true }
)

// 组件挂载时，如果当前已是 Ollama，自动检测模型
onMounted(() => {
  if (modelStore.config.provider === 'ollama') {
    detectOllamaModels()
  }
})

async function onTest() {
  await modelStore.test()
  if (modelStore.testResult?.success) {
    uiStore.toast('模型连接测试成功', 'success')
  } else {
    uiStore.toast('连接失败：' + (modelStore.testResult?.message || '未知错误'), 'error')
  }
}

async function onSave() {
  // 校验必填字段，复用 canTest 逻辑
  if (!canTest.value) {
    uiStore.toast('请先填写完整的模型配置（模型名称、API Key 等）', 'error')
    return
  }
  saving.value = true
  try {
    await modelStore.save()
    uiStore.toast('模型配置已保存', 'success')
  } catch (e) {
    uiStore.toast('保存失败：' + e.message, 'error')
  } finally {
    saving.value = false
  }
}

// 响应预览：截断过长内容
const resultPreview = computed(() => {
  const r = modelStore.testResult
  if (!r) return ''
  const text = r.success ? r.response : r.message
  if (text == null) return ''
  const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2)
  return str.length > 800 ? str.slice(0, 800) + '\n…（已截断）' : str
})
</script>

<style scoped>
.ollama-status {
  margin-top: 4px;
}
.ollama-status .hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-text {
  border: none;
  background: none;
  color: var(--blue-6);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
  padding: 0;
}
.btn-text:hover {
  color: var(--blue-7);
}
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px;
}
.page__head {
  margin-bottom: 16px;
}
.page__head h1 {
  font-size: 20px;
  font-weight: 600;
}
.page__sub {
  font-size: 13px;
  color: var(--text-2);
  margin-top: 4px;
}
.model-lab--embedded {
  height: 100%;
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

/* 测试结果 */
.test-result {
  margin-top: 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  overflow: hidden;
}
.test-result--ok {
  background: var(--emerald-dim);
  border-color: rgba(16, 185, 129, 0.35);
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
  max-height: 220px;
  overflow-y: auto;
  color: var(--text);
}
</style>
