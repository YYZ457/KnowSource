<script setup>
/** ModelLab — 模型实验室：在 UI 中测试并应用 KG 专用模型 */
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch } from 'vue';
import { useDocumentStore } from '@/stores/document';
import { useGraphStore } from '@/stores/graph';
import { useToastStore } from '@/stores/toast';
import { client } from '@/api/client.js';
import { setKGProvider, createLLMProvider, VENDOR_PRESETS } from '@services/llm-provider';

// 导入能力推断函数，用于在 UI 中准确显示当前模型是否支持全文抽取
import { inferCapabilities } from '@services/llm-provider';

const CLOUD_PROVIDERS = ['openai-compatible', 'openai', 'huggingface'];

const docStore = useDocumentStore();
const graphStore = useGraphStore();
const toast = useToastStore();

const KG_CONFIG_KEY = 'knowledge-ide-kg-config';

const provider = ref('stub');
const vendor = ref('openai');
const model = ref('');
const apiKey = ref('');
const baseUrl = ref('');

const testing = ref(false);
const building = ref(false);
const terms = ref([]);
const message = ref('');
const usedLLM = ref(false);
const fallbackReason = ref('');
const llmError = ref('');
const chunkCount = ref(0);
const totalRawTerms = ref(0);
const uniqueAfterDedup = ref(0);
const ollamaChecking = ref(false);
const ollamaModels = ref([]);
const ollamaAvailable = ref(false);
const customOllamaPath = ref('');
const ollamaError = ref('');
const CUSTOM_OLLAMA_KEY = 'knowledge-ide-ollama-path';
// 测试/构建进度
const testProgress = ref({ stage: '', percent: 0, log: '', chunkIndex: 0, chunkCount: 0 });

const chunkSize = ref(2500);
const overlap = ref(200);
const maxTermsPerChunk = ref(15);
const splitMode = ref('heading'); // 'paragraph' | 'heading' | 'llm'

// 云端 LLM 全文抽取配置
const fullExtractEnabled = ref(true); // 是否启用全文直出
const fullExtractMaxContextChars = ref(200000); // 最大上下文字符数
const fullExtractTimeoutMs = ref(300000); // 超时毫秒
const maxTerms = ref(40); // 全文抽取最大实体数
const maxHeadings = ref(30); // 全文抽取最大标题数

// UI 折叠状态
const showProviderSection = ref(true);
const showChunkingSection = ref(false);
const showFullExtractSection = ref(false);
const saveStatus = ref(''); // 'saved' | 'saving' | ''

const activeDocName = computed(() => docStore.activeDoc?.meta?.name || '未选择文档');
const isStubProvider = computed(() => provider.value === 'stub');
// 本地模型（ollama / huggingface）统一走专门优化的分步管线，不启用全文抽取
const isLocalProvider = computed(() => provider.value === 'ollama' || provider.value === 'huggingface');

const providerStatusText = computed(() => {
  if (provider.value === 'stub') return '当前使用离线规则抽取（无 LLM）';
  if (provider.value === 'ollama') return `当前使用本地 Ollama：${model.value || '未选择模型'}（走分步管线）`;
  if (provider.value === 'huggingface') return `当前使用 Hugging Face：${model.value || '未选择模型'}（走分步管线）`;
  const level = modelCapabilities.value.qualityLevel;
  const levelLabel = level === 'strong' ? '强模型' : level === 'medium' ? '中等模型' : level === 'weak' ? '弱模型' : '';
  return `当前使用云端模型：${vendor.value} / ${model.value || '未选择模型'}${levelLabel ? '（' + levelLabel + '）' : ''}`;
});
const apiKeySet = computed(() => !!apiKey.value);
const hasDoc = computed(() => !!docStore.activeDoc);

// 推断当前模型的实际能力等级，用于在 UI 中准确提示全文抽取是否可用
const modelCapabilities = computed(() => {
  if (isStubProvider.value) return { qualityLevel: 'none', contextWindow: 0 };
  const vendorForInfer = provider.value === 'ollama' ? 'ollama'
    : provider.value === 'huggingface' ? 'huggingface'
    : vendor.value || 'openai';
  return inferCapabilities(vendorForInfer, model.value);
});

// 全文抽取是否真正可用：stub / 本地模型均不可用，仅云端模型按能力等级判断
const fullExtractUsable = computed(() => {
  if (isStubProvider.value || isLocalProvider.value) return false;
  return modelCapabilities.value.qualityLevel === 'strong'
    || modelCapabilities.value.qualityLevel === 'medium';
});

// 全文抽取的实际上下文限制（字符数）
const fullExtractMaxChars = computed(() => {
  const level = modelCapabilities.value.qualityLevel;
  if (level === 'strong') return fullExtractMaxContextChars.value;
  if (level === 'medium') return Math.min(fullExtractMaxContextChars.value, 32000);
  return 0;
});

const fullExtractStatusText = computed(() => {
  if (isStubProvider.value) return '当前为 stub，全文抽取不可用';
  if (isLocalProvider.value) return '本地模型不启用全文抽取，将使用专门优化的分步管线';
  const level = modelCapabilities.value.qualityLevel;
  if (level === 'weak') return '当前模型能力较弱，全文抽取不可用，将使用分步管线';
  if (level === 'medium') return `中等模型：仅 ${fullExtractMaxChars.value.toLocaleString()} 字符以内文档可用全文抽取，超长文档自动回退分步管线`;
  if (level === 'strong') return `强模型：${fullExtractMaxChars.value.toLocaleString()} 字符以内文档可用全文抽取`;
  return '';
});
const vendorKeys = computed(() => Object.keys(VENDOR_PRESETS));
const isOpenAICompatible = computed(() => provider.value === 'openai-compatible');
const needApiKey = computed(() => CLOUD_PROVIDERS.includes(provider.value));
const needBaseUrl = computed(() => provider.value === 'ollama' || provider.value === 'openai-compatible');

const recommendedModels = computed(() => {
  // Ollama 模型通过检测本地服务动态获取，不再硬编码推荐列表
  if (provider.value === 'openai-compatible') {
    return VENDOR_PRESETS[vendor.value]?.models || [];
  }
  return [];
});

function migrateLegacyProvider(p) {
  return p === 'openai' ? 'openai-compatible' : (p || 'stub');
}

function migrateLegacyBaseUrl(url) {
  // 旧配置可能保存了 localhost，而 Ollama 只监听 127.0.0.1（IPv4）
  if (url && url.includes('localhost:11434')) {
    return url.replace('localhost:11434', '127.0.0.1:11434');
  }
  return url;
}

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KG_CONFIG_KEY) || 'null');
    if (saved) {
      provider.value = migrateLegacyProvider(saved.provider);
      vendor.value = saved.vendor || 'openai';
      model.value = saved.model || '';
      apiKey.value = saved.apiKey || '';
      baseUrl.value = migrateLegacyBaseUrl(saved.baseUrl || '');
    }
    // Electron 环境：从 secureStore 读取 apiKey（优先级高于 localStorage）
    if (window.KSElectron?.secureStore) {
      const kgKey = await window.KSElectron.secureStore.get('kg-api-key');
      if (kgKey) apiKey.value = kgKey;
    }
    // 恢复自定义 Ollama 路径
    try {
      const savedPath = localStorage.getItem(CUSTOM_OLLAMA_KEY);
      if (savedPath) customOllamaPath.value = savedPath;
    } catch {}
    // 恢复分块参数
    const chunkCfg = JSON.parse(localStorage.getItem('knowledge-ide-kg-chunks') || 'null');
    if (chunkCfg) {
      if (chunkCfg.chunkSize) chunkSize.value = chunkCfg.chunkSize;
      if (chunkCfg.overlap != null) overlap.value = chunkCfg.overlap;
      if (chunkCfg.maxTermsPerChunk) maxTermsPerChunk.value = chunkCfg.maxTermsPerChunk;
      if (chunkCfg.splitMode) splitMode.value = chunkCfg.splitMode;
    }
    // 恢复全文抽取参数
    const feCfg = JSON.parse(localStorage.getItem('knowledge-ide-kg-full-extract') || 'null');
    if (feCfg) {
      if (feCfg.fullExtractEnabled != null) fullExtractEnabled.value = feCfg.fullExtractEnabled;
      if (feCfg.fullExtractMaxContextChars != null) fullExtractMaxContextChars.value = feCfg.fullExtractMaxContextChars;
      if (feCfg.fullExtractTimeoutMs != null) fullExtractTimeoutMs.value = feCfg.fullExtractTimeoutMs;
      if (feCfg.maxTerms != null) maxTerms.value = feCfg.maxTerms;
      if (feCfg.maxHeadings != null) maxHeadings.value = feCfg.maxHeadings;
    }
  } catch {
    // ignore
  }
  // 仅在配置明显不合法时修正，不主动覆盖用户已保存的设置
  validateProviderConfigOnLoad();
  // 仅在 baseUrl/model 为空时才应用 vendor 预设
  if (!baseUrl.value && !model.value) {
    applyVendorPreset();
  }
  if (provider.value === 'ollama') checkOllama();

  // 同步配置到后端：先读取后端当前配置，仅在本地与后端不一致时才同步，
  // 避免每次挂载都无条件覆盖用户通过其他途径修改的后端配置
  try {
    const config = buildConfig();
    let needSync = true;
    try {
      const backendCfg = await client.getKGProvider();
      needSync = !isSameKGConfig(backendCfg, config);
    } catch {
      // 后端不支持读取配置或读取失败：不主动同步，依赖用户显式点击"保存"
      needSync = false;
    }
    if (needSync) {
      await applyKGConfig(config);
    }
  } catch {
    // 同步失败不影响 UI 使用
  }
});

watch(provider, (val) => {
  autoFillProviderDefaults(val);
  ollamaModels.value = [];
  ollamaAvailable.value = false;
  if (val === 'ollama') checkOllama();
  // 切换到本地模型（ollama / huggingface）时，自动关闭全文抽取，始终走分步管线
  if (val === 'ollama' || val === 'huggingface') {
    fullExtractEnabled.value = false;
  }
});

watch(vendor, () => applyVendorPreset());

// 组件存活标志：卸载后置为 false，轮询循环据此提前退出，避免组件卸载后仍更新状态
let isMounted = true;
// 当用户从下拉选择模型时，自动静默保存到后端
let modelSaveTimer = null;
watch(model, () => {
  if (modelSaveTimer) clearTimeout(modelSaveTimer);
  modelSaveTimer = setTimeout(() => {
    saveConfiguration(false);
  }, 500);
});

// KeepAlive 缓存：切入 Tab 时恢复存活标志，允许轮询循环继续
onActivated(() => {
  isMounted = true;
});

// KeepAlive 缓存：切出 Tab 时终止轮询循环并清理防抖定时器
onDeactivated(() => {
  isMounted = false;
  if (modelSaveTimer) clearTimeout(modelSaveTimer);
});

onUnmounted(() => {
  // 标记组件已卸载，终止轮询循环
  isMounted = false;
  // 清理未触发的防抖定时器，避免组件卸载后仍执行保存
  if (modelSaveTimer) clearTimeout(modelSaveTimer);
});

function isKnownVendorUrl(url) {
  if (!url) return false;
  const knownUrls = Object.values(VENDOR_PRESETS).map(p => p.baseUrl).filter(Boolean);
  return knownUrls.some(u => url.trim().toLowerCase().startsWith(u.toLowerCase()));
}

function isLocalUrl(url) {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return u.includes('127.0.0.1') || u.includes('localhost') || u.startsWith('http://localhost') || u.startsWith('http://127');
}

function applyVendorPreset() {
  if (provider.value !== 'openai-compatible') return;
  const preset = VENDOR_PRESETS[vendor.value];
  if (!preset) return;
  // Base URL：为空、或是已知厂商 URL、或是本地 URL 时，才自动替换为当前 vendor 预设
  if (!baseUrl.value || isKnownVendorUrl(baseUrl.value) || isLocalUrl(baseUrl.value)) {
    baseUrl.value = preset.baseUrl;
  }
  // 模型：为空、或是当前 vendor 的默认模型时，才替换
  const currentVendorDefault = VENDOR_PRESETS[vendor.value]?.models[0] || '';
  if (!model.value || model.value === currentVendorDefault) {
    model.value = preset.models[0] || '';
  }
}

function validateProviderConfigOnLoad() {
  // 修正历史保存下来的不匹配配置（例如 Provider=ollama 但 Base URL 是云端地址）
  if (provider.value === 'ollama') {
    if (!isLocalUrl(baseUrl.value)) {
      baseUrl.value = 'http://127.0.0.1:11434';
    }
    if (!model.value || model.value.includes('/')) {
      model.value = 'qwen2.5:1.5b-instruct';
    }
  } else if (provider.value === 'huggingface') {
    if (baseUrl.value && isKnownVendorUrl(baseUrl.value)) {
      baseUrl.value = '';
    }
    if (!model.value || !model.value.includes('/')) {
      model.value = 'Qwen/Qwen2.5-1.5B-Instruct';
    }
  } else if (provider.value === 'openai-compatible') {
    if (isLocalUrl(baseUrl.value)) {
      baseUrl.value = '';
    }
  }
}

function autoFillProviderDefaults(newProvider) {
  if (newProvider === 'ollama') {
    // 切到本地 Ollama 时：baseUrl 必须是本地地址
    if (!isLocalUrl(baseUrl.value)) {
      baseUrl.value = 'http://127.0.0.1:11434';
    }
    // 模型：为空，或明显是云端/HF 模型名（含 /）时，填入 Ollama 默认模型
    if (!model.value || model.value.includes('/')) {
      model.value = 'qwen2.5:1.5b-instruct';
    }
  } else if (newProvider === 'huggingface') {
    baseUrl.value = '';
    // HF 模型名通常为 org/model 格式；若当前模型不含 /，则填入默认 HF 模型
    if (!model.value || !model.value.includes('/')) {
      model.value = 'Qwen/Qwen2.5-1.5B-Instruct';
    }
  } else if (newProvider === 'openai-compatible') {
    // 从本地/HF 切过来时，若模型明显不属于当前 vendor，先清空再应用预设
    if (model.value && (model.value === 'qwen2.5:1.5b-instruct' || model.value.includes('/'))) {
      model.value = '';
    }
    applyVendorPreset();
  } else if (newProvider === 'stub') {
    baseUrl.value = '';
    model.value = '';
  }
}

function defaultModelForProvider(p, v) {
  if (p === 'ollama') return 'qwen2.5:1.5b-instruct';
  if (p === 'huggingface') return 'Qwen/Qwen2.5-1.5B-Instruct';
  if (p === 'openai-compatible') return VENDOR_PRESETS[v]?.models[0] || '';
  return '';
}

function buildConfig() {
  const cfg = { provider: provider.value };
  if (provider.value === 'openai-compatible') cfg.vendor = vendor.value;
  cfg.model = (model.value || defaultModelForProvider(provider.value, vendor.value)) || undefined;
  if (apiKey.value) cfg.apiKey = apiKey.value;
  if (baseUrl.value) cfg.baseUrl = baseUrl.value;
  return cfg;
}

/** 比较本地与后端 KG 配置是否一致（apiKey 不直接比较明文，后端通常不回传） */
function isSameKGConfig(backend, local) {
  if (!backend || !local) return false;
  return (backend.provider || 'stub') === (local.provider || 'stub')
    && (backend.model || '') === (local.model || '')
    && (backend.baseUrl || '') === (local.baseUrl || '')
    && (backend.vendor || '') === (local.vendor || '');
}

async function persistConfig(config) {
  try {
    // Electron 环境：apiKey 存 secureStore，localStorage 只存不含 apiKey 的配置
    if (window.KSElectron?.secureStore) {
      await window.KSElectron.secureStore.set('kg-api-key', apiKey.value || '');
      const { apiKey: _key, ...configSafe } = config;
      localStorage.setItem(KG_CONFIG_KEY, JSON.stringify(configSafe));
    } else {
      localStorage.setItem(KG_CONFIG_KEY, JSON.stringify(config));
    }
    // 同时持久化分块参数，供 FileExplorer 导入时复用
    localStorage.setItem('knowledge-ide-kg-chunks', JSON.stringify({
      chunkSize: chunkSize.value,
      overlap: overlap.value,
      maxTermsPerChunk: maxTermsPerChunk.value,
      splitMode: splitMode.value
    }));
    // 持久化全文抽取参数
    localStorage.setItem('knowledge-ide-kg-full-extract', JSON.stringify({
      fullExtractEnabled: fullExtractEnabled.value,
      fullExtractMaxContextChars: fullExtractMaxContextChars.value,
      fullExtractTimeoutMs: fullExtractTimeoutMs.value,
      maxTerms: maxTerms.value,
      maxHeadings: maxHeadings.value
    }));
  } catch {
    // ignore
  }
}

async function applyKGConfig(config) {
  const resp = await client.setKGProvider(config);
  setKGProvider(createLLMProvider(config.provider, {
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    vendor: config.vendor
  }));
  if (window.KSElectron?.api?.setKGProvider) {
    await window.KSElectron.api.setKGProvider(config);
  }
  // 返回后端校验警告，供调用方决定是否展示
  return resp?.warnings || [];
}

async function saveConfiguration(showToast = true) {
  try {
    saveStatus.value = 'saving';
    const config = buildConfig();
    const warnings = await applyKGConfig(config);
    await persistConfig(config);
    saveStatus.value = 'saved';
    if (showToast) {
      // 后端返回配置警告时，以 warning toast 提示用户缺失的关键字段
      if (warnings.length > 0) {
        toast.warning(warnings.join('；'));
      } else {
        toast.success('配置已保存');
      }
      setTimeout(() => { saveStatus.value = ''; }, 2000);
    }
  } catch (e) {
    message.value = '保存配置失败：' + (e?.message || e);
    toast.error('保存配置失败：' + (e?.message || e));
    saveStatus.value = '';
  }
}

async function checkOllama() {
  if (provider.value !== 'ollama') return;
  ollamaChecking.value = true;
  ollamaModels.value = [];
  ollamaAvailable.value = false;
  ollamaError.value = '';
  try {
    const result = await client.checkOllama(baseUrl.value || undefined, customOllamaPath.value || undefined);
    ollamaAvailable.value = result.available;
    if (result.available) {
      ollamaModels.value = result.models || [];
      message.value = `检测到 Ollama，共 ${ollamaModels.value.length} 个本地模型`;
    } else {
      ollamaError.value = result.error || '未检测到 Ollama';
      message.value = '未检测到 Ollama：' + (result.error || '请确认已启动并可访问');
    }
  } catch (e) {
    ollamaError.value = e?.message || '检测失败';
    message.value = '检测 Ollama 失败：' + (e?.message || e);
  } finally {
    ollamaChecking.value = false;
  }
}

const installingOllama = ref(false);
const ollamaInstallMsg = ref('');

async function installOllama() {
  if (!window.KSElectron?.ollama) {
    message.value = '当前环境不支持自动安装 Ollama，请手动下载：https://ollama.com/download';
    return;
  }
  installingOllama.value = true;
  ollamaInstallMsg.value = '正在下载 Ollama 安装程序...';
  message.value = ollamaInstallMsg.value;
  try {
    const result = await window.KSElectron.ollama.install();
    if (result.success) {
      message.value = '安装程序已运行，正在等待 Ollama 服务就绪...';
      for (let i = 0; i < 30 && isMounted; i++) {
        await new Promise(r => setTimeout(r, 2000));
        // 组件已卸载则停止轮询，避免卸载后继续更新状态
        if (!isMounted) break;
        const status = await client.checkOllama(baseUrl.value || undefined, customOllamaPath.value || undefined);
        if (!isMounted) break;
        if (status.available) {
          ollamaAvailable.value = true;
          ollamaModels.value = status.models || [];
          message.value = `Ollama 已就绪，共 ${ollamaModels.value.length} 个本地模型`;
          if (ollamaModels.value.length && !model.value) model.value = ollamaModels.value[0].name;
          break;
        }
      }
      if (isMounted && !ollamaAvailable.value) {
        message.value = '安装后未能检测到 Ollama，请手动启动或重启应用后重试';
      }
    } else {
      message.value = '安装程序已下载到：' + result.downloadPath + '，请手动运行完成安装';
    }
  } catch (e) {
    message.value = '安装失败：' + (e?.message || e);
  } finally {
    installingOllama.value = false;
  }
}

async function browseOllamaPath() {
  if (!window.KSElectron?.openFileDialog) return;
  try {
    const result = await window.KSElectron.openFileDialog({
      title: '选择 Ollama 可执行文件',
      buttonLabel: '选择',
      properties: ['openFile'],
      filters: typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('win')
        ? [{ name: '可执行文件', extensions: ['exe'] }]
        : []
    });
    if (!result.canceled && result.filePaths?.length > 0) {
      customOllamaPath.value = result.filePaths[0];
      localStorage.setItem(CUSTOM_OLLAMA_KEY, customOllamaPath.value);
      await checkOllama();
    }
  } catch (e) {
    message.value = '选择文件失败：' + (e?.message || e);
  }
}

function pickModel(name) {
  model.value = name;
}

async function copyPullCmd() {
  const cmd = 'ollama pull qwen2.5:1.5b-instruct';
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(cmd);
    } else {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    message.value = '已复制：' + cmd;
  } catch (e) {
    message.value = '复制失败，请手动执行：' + cmd;
  }
}

function buildExtractOptions() {
  const opts = {
    chunkSize: chunkSize.value,
    overlap: overlap.value,
    maxTermsPerChunk: maxTermsPerChunk.value,
    splitMode: splitMode.value,
    maxTerms: maxTerms.value,
    maxHeadings: maxHeadings.value,
    fullExtractEnabled: fullExtractEnabled.value,
    fullExtractMaxContextChars: fullExtractMaxContextChars.value,
    fullExtractTimeoutMs: fullExtractTimeoutMs.value
  };
  return opts;
}

async function testModel() {
  if (!hasDoc.value) {
    message.value = '请先选择一份文档';
    return;
  }
  testing.value = true;
  message.value = '';
  terms.value = [];
  usedLLM.value = false;
  fallbackReason.value = '';
  llmError.value = '';
  chunkCount.value = 0;
  totalRawTerms.value = 0;
  uniqueAfterDedup.value = 0;
  testProgress.value = { stage: 'start', percent: 0, log: '准备测试模型...', chunkIndex: 0, chunkCount: 0 };

  // 进度轮询：使用递归 setTimeout，确保上一次轮询完成后才调度下一次，避免并发请求堆积
  let progressTimer = null;
  const pollProgress = async () => {
    if (!testing.value) return;
    try {
      const p = await client.getProgress();
      if (p && p.taskId && p.taskId.startsWith('model-test')) {
        testProgress.value = {
          stage: p.stage || '',
          percent: p.percent || 0,
          log: p.log || '',
          chunkIndex: p.chunkIndex || 0,
          chunkCount: p.chunkCount || 0
        };
      }
    } catch {
      // ignore
    }
    if (testing.value) {
      progressTimer = setTimeout(pollProgress, 500);
    }
  };
  progressTimer = setTimeout(pollProgress, 500);

  try {
    await saveConfiguration(false);
    const config = buildConfig();
    const result = await client.modelTest(docStore.activeDoc.meta.docId, undefined, buildExtractOptions());
    terms.value = result.terms || [];
    usedLLM.value = result.usedLLM || false;
    fallbackReason.value = result.fallbackReason || '';
    llmError.value = result.error || '';
    chunkCount.value = result.chunkCount || 0;
    totalRawTerms.value = result.totalRawTerms || 0;
    uniqueAfterDedup.value = result.uniqueAfterDedup || 0;
    if (usedLLM.value) {
      message.value = `已调用${result.provider || config.provider}${result.model ? '(' + result.model + ')' : ''},分块${chunkCount.value},原始${totalRawTerms.value} 个,去重后${uniqueAfterDedup.value} 个,最终返回${terms.value.length} 个关键术语`;
    } else if (fallbackReason.value) {
      message.value = `未真正调用 LLM（${fallbackReason.value}${llmError.value ? '）：' + llmError.value : '）'},当前为规则抽取结果 ${terms.value.length} 条。请检查模型配置或本地服务是否启动。`;
    } else {
      message.value = `共抽取${terms.value.length} 个关键术语`;
    }
  } catch (e) {
    message.value = '测试失败：' + (e?.message || e);
  } finally {
    clearTimeout(progressTimer);
    testing.value = false;
    testProgress.value = { stage: 'done', percent: 100, log: '', chunkIndex: 0, chunkCount: 0 };
  }
}

async function applyAndBuild() {
  if (!hasDoc.value) {
    message.value = '请先选择一份文档';
    return;
  }
  building.value = true;
  message.value = '';
  try {
    await saveConfiguration(false);
    await graphStore.buildGraph(buildExtractOptions());
    message.value = '知识图谱已重新构建';
  } catch (e) {
    message.value = '构建失败：' + (e?.message || e);
  } finally {
    building.value = false;
  }
}

</script>

<template>
  <div class="model-lab">
    <div class="model-lab-header">
      <h3>知识图谱配置</h3>
      <p class="model-lab-doc">当前文档：{{ activeDocName }}</p>
    </div>

    <div class="model-lab-body">
      <!-- 状态条 -->
      <div class="config-status-bar" :class="{ stub: isStubProvider }" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true" />
        <span class="status-text">{{ providerStatusText }}</span>
        <span v-if="!isStubProvider && !apiKeySet" class="status-warning">未设置 API Key</span>
      </div>

      <!-- Provider 配置 -->
      <div class="config-card">
        <button type="button" class="card-header" :aria-expanded="showProviderSection" aria-controls="provider-section-body" @click="showProviderSection = !showProviderSection">
          <span class="card-title">1. Provider 配置</span>
          <span class="card-toggle">{{ showProviderSection ? '收起' : '展开' }}</span>
        </button>
        <div v-if="showProviderSection" id="provider-section-body" class="card-body">
          <div class="form-row">
            <label>Provider</label>
            <select v-model="provider">
              <option value="stub">stub（离线规则抽取）</option>
              <option value="ollama">ollama（本地开源小模型）</option>
              <option value="openai-compatible">OpenAI 兼容（云端：OpenAI / DeepSeek / 通义千问等）</option>
              <option value="huggingface">huggingface（开源模型 API）</option>
            </select>
          </div>

          <div v-if="isOpenAICompatible" class="form-row">
            <label>供应商</label>
            <select v-model="vendor">
              <option v-for="key in vendorKeys" :key="key" :value="key">
                {{ VENDOR_PRESETS[key].label }}
              </option>
            </select>
          </div>

          <div class="form-row">
            <label>模型名</label>
            <div class="input-with-chips">
              <!-- Ollama 且已检测到本地模型：下拉选择 -->
              <select v-if="provider === 'ollama' && ollamaModels.length" v-model="model">
                <option v-for="m in ollamaModels" :key="m.name" :value="m.name">
                  {{ m.name }}{{ m.size ? ' (' + m.size + ')' : '' }}
                </option>
              </select>
              <!-- 其他情况：文本输入 -->
              <input v-else v-model="model" :placeholder="recommendedModels[0] ? '如 ' + recommendedModels[0] : (provider === 'ollama' ? '请先检测本地模型' : '留空使用默认')" />
              <div v-if="recommendedModels.length" class="recommended-chips">
                <button
                  v-for="m in recommendedModels"
                  :key="m"
                  class="chip"
                  :class="{ active: model === m }"
                  @click="pickModel(m)"
                >{{ m }}</button>
              </div>
            </div>
          </div>

          <div v-if="needApiKey" class="form-row">
            <label>API Key</label>
            <input v-model="apiKey" type="password" placeholder="sk-... / ds-... 等" />
          </div>

          <div v-if="needBaseUrl" class="form-row">
            <label>Base URL</label>
            <input v-model="baseUrl" placeholder="如 https://api.deepseek.com/v1" />
          </div>

          <p v-if="isOpenAICompatible" class="form-tip">选择 DeepSeek 等会自动填充 Base URL 与默认模型；选“自定义”可手动输入任意 OpenAI 兼容接口。</p>

          <div v-if="provider === 'ollama'" class="ollama-status">
            <div class="ollama-custom-path">
              <label>Ollama 可执行文件路径（可选）</label>
              <span class="field-hint">请选择文件夹内的 ollama.exe，不要选 ollama app.exe 等快捷方式。</span>
              <div class="path-input-row">
                <input v-model="customOllamaPath" type="text" placeholder="例如 C:\\Users\\xxx\\AppData\\Local\\Programs\\Ollama\\ollama.exe" @change="localStorage.setItem(CUSTOM_OLLAMA_KEY, customOllamaPath); checkOllama()" />
                <button class="btn-secondary" @click="browseOllamaPath">浏览...</button>
              </div>
              <p v-if="ollamaError" class="status-error">{{ ollamaError }}</p>
            </div>
            <div class="ollama-actions">
              <button class="btn-secondary" :disabled="ollamaChecking" @click="checkOllama">
                {{ ollamaChecking ? '检测中...' : '检测本地 Ollama' }}
              </button>
              <button
                v-if="!ollamaAvailable && !ollamaChecking"
                class="btn-primary"
                :disabled="installingOllama"
                @click="installOllama"
              >
                {{ installingOllama ? '安装中...' : '下载并安装 Ollama' }}
              </button>
            </div>
            <div v-if="ollamaAvailable" class="ollama-info">
              <span class="status-ok">✓ Ollama 已连接，检测到 {{ ollamaModels.length }} 个本地模型，请在上方"模型名"下拉选择。</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 全文抽取配置（本地模型隐藏，统一走分步管线） -->
      <div v-if="!isLocalProvider" class="config-card">
        <button type="button" class="card-header" :aria-expanded="showFullExtractSection" aria-controls="full-extract-section-body" @click="showFullExtractSection = !showFullExtractSection">
          <span class="card-title">2. 全文抽取（云端 LLM 单次调用）</span>
          <span class="card-toggle">{{ showFullExtractSection ? '收起' : '展开' }}</span>
        </button>
        <div v-if="showFullExtractSection" id="full-extract-section-body" class="card-body">
          <!-- 实际可用性提示 -->
          <div class="form-tip" :class="{ warning: !fullExtractUsable, ok: fullExtractUsable }">
            {{ fullExtractStatusText }}
          </div>

          <div class="form-row checkbox-row">
            <label class="checkbox-label">
              <input v-model="fullExtractEnabled" type="checkbox" :disabled="!fullExtractUsable" />
              启用全文直出
            </label>
          </div>
          <p class="form-tip">开启后，云端 LLM 一次性读取全文，直接返回标题树+实体+关系+特异性评分。超长文档或弱模型会自动回退到分步管线。</p>

          <div v-if="fullExtractEnabled" class="form-grid">
            <div class="form-row">
              <label>最大上下文</label>
              <input v-model.number="fullExtractMaxContextChars" type="number" min="16000" max="1000000" step="1000" />
              <span class="field-hint">字符</span>
            </div>
            <div class="form-row">
              <label>超时</label>
              <input v-model.number="fullExtractTimeoutMs" type="number" min="30000" max="600000" step="1000" />
              <span class="field-hint">毫秒</span>
            </div>
            <div class="form-row">
              <label>最大实体数</label>
              <input v-model.number="maxTerms" type="number" min="10" max="200" step="5" />
            </div>
            <div class="form-row">
              <label>最大标题数</label>
              <input v-model.number="maxHeadings" type="number" min="5" max="100" step="5" />
            </div>
          </div>

          <p v-if="isStubProvider && fullExtractEnabled" class="form-tip warning">
            当前 Provider 为 stub，全文直出不会生效。请先选择 LLM Provider 并保存配置。
          </p>
          <p v-if="!isStubProvider && modelCapabilities.qualityLevel === 'weak'" class="form-tip warning">
            当前模型能力等级为 weak，全文抽取不可用。建议使用 7B 以上参数的模型。
          </p>
        </div>
      </div>

      <!-- 分步管线配置：本地模型专用，云端模型的长文档/弱模型回退 -->
      <div class="config-card">
        <button type="button" class="card-header" :aria-expanded="showChunkingSection" aria-controls="chunking-section-body" @click="showChunkingSection = !showChunkingSection">
          <span class="card-title">{{ isLocalProvider ? '2. 分步管线参数（本地模型专用）' : '3. 分步管线参数（弱模型 / 超长文档回退）' }}</span>
          <span class="card-toggle">{{ showChunkingSection ? '收起' : '展开' }}</span>
        </button>
        <div v-if="showChunkingSection" id="chunking-section-body" class="card-body">
          <div v-if="isLocalProvider" class="form-tip ok">
            本地模型（ollama / huggingface）统一使用专门优化的分步管线：分块抽取 + 规则匹配，无需全文抽取。
          </div>
          <div class="form-grid">
            <div class="form-row">
              <label>分块大小</label>
              <input v-model.number="chunkSize" type="number" min="500" max="8000" step="100" />
              <span class="field-hint">字符</span>
            </div>
            <div class="form-row">
              <label>分块重叠</label>
              <input v-model.number="overlap" type="number" min="0" max="1000" step="50" />
              <span class="field-hint">字符</span>
            </div>
            <div class="form-row">
              <label>每块最多概念</label>
              <input v-model.number="maxTermsPerChunk" type="number" min="5" max="50" step="1" />
            </div>
            <div class="form-row">
              <label>分块策略</label>
              <select v-model="splitMode">
                <option value="heading">标题感知（推荐）</option>
                <option value="paragraph">段落滑动</option>
                <option value="llm">LLM 自动划分</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 测试进度 -->
      <div v-if="testing && testProgress.log" class="model-lab-progress" role="status" aria-live="polite">
        <div class="progress-bar" role="progressbar" :aria-valuenow="testProgress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="testProgress.log || '测试中'">
          <div class="progress-fill" :style="{ width: testProgress.percent + '%' }" />
        </div>
        <div class="progress-text">
          {{ testProgress.log }}
          <span v-if="testProgress.chunkCount > 0" class="progress-chunks">
            ({{ testProgress.chunkIndex }}/{{ testProgress.chunkCount }} 块)
          </span>
        </div>
      </div>

      <!-- 构建进度 -->
      <div v-if="building && graphStore.buildProgress.log" class="model-lab-progress" role="status" aria-live="polite">
        <div class="progress-bar" role="progressbar" :aria-valuenow="graphStore.buildProgress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="graphStore.buildProgress.log || '构建中'">
          <div class="progress-fill" :style="{ width: graphStore.buildProgress.percent + '%' }" />
        </div>
        <div class="progress-text">
          {{ graphStore.buildProgress.log }}
          <span v-if="graphStore.buildProgress.chunkCount > 0" class="progress-chunks">
            ({{ graphStore.buildProgress.chunkIndex }}/{{ graphStore.buildProgress.chunkCount }} 块)
          </span>
        </div>
      </div>

      <div v-if="message" class="model-lab-msg" :class="{ warning: !usedLLM && fallbackReason }" role="status" aria-live="polite">{{ message }}</div>

      <div v-if="terms.length" class="model-lab-terms">
        <h4>抽取结果</h4>
        <div class="term-list">
          <span v-for="(t, i) in terms" :key="i" class="term-chip">{{ t.term }}</span>
        </div>
      </div>

      <div class="model-lab-help">
        <h4>快速部署开源小模型（推荐 Ollama）：</h4>
        <ol>
          <li>安装 <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> 并启动服务。</li>
          <li>拉取轻量模型：<code>ollama pull qwen2.5:1.5b-instruct</code> <button class="copy-cmd" @click="copyPullCmd">复制命令</button></li>
          <li>回到上方选择 <strong>ollama</strong>，Base URL 保持 <code>http://127.0.0.1:11434</code>，模型名填 <code>qwen2.5:1.5b-instruct</code>，点击"测试模型"。</li>
        </ol>
        <p class="hint">模型不可用或文档超长时，自动回退到分步管线（分块抽取 + 规则匹配）。</p>
      </div>
    </div>

    <!-- 操作按钮固定在底部，始终可见 -->
    <div class="action-bar">
      <button class="btn-save" :disabled="saveStatus === 'saving'" @click="saveConfiguration">
        <span v-if="saveStatus === 'saved'">已保存</span>
        <span v-else-if="saveStatus === 'saving'">保存中...</span>
        <span v-else>保存配置</span>
      </button>
      <button :disabled="testing || building || !hasDoc || graphStore.building" @click="testModel">
        {{ testing ? '测试中...' : '测试模型' }}
      </button>
      <button :disabled="testing || building || !hasDoc || graphStore.building" class="primary" @click="applyAndBuild">
        {{ building ? '构建中...' : '应用并构建图谱' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.model-lab {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.model-lab-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.model-lab-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.model-lab-doc {
  font-size: 12px;
  color: var(--text-secondary);
}
.model-lab-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 状态条 */
.config-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.config-status-bar.stub {
  background: var(--bg-tertiary);
  border-color: var(--border);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.config-status-bar.stub .status-dot {
  background: var(--text-tertiary);
}
.status-text {
  color: var(--text-primary);
  font-weight: 500;
}
.status-warning {
  margin-left: auto;
  color: var(--warning-text);
  font-weight: 500;
}

/* 折叠卡片 */
.config-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  overflow: hidden;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  cursor: pointer;
  user-select: none;
  width: 100%;
  border: none;
  text-align: left;
  font-family: inherit;
}
.card-header:hover {
  background: var(--bg-hover);
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.card-toggle {
  font-size: 12px;
  color: var(--text-secondary);
}
.card-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 表单一行 */
.form-row {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  align-items: center;
  gap: 10px;
}
.form-row.checkbox-row {
  grid-template-columns: 1fr;
}
.form-row label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.form-row input,
.form-row select {
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  font-size: 13px;
  min-width: 0;
}
.form-row input:focus,
.form-row select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.form-row .field-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

/* 两列网格 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-grid .form-row {
  grid-template-columns: 80px 1fr auto;
}

/* 提示文本 */
.form-tip {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0;
}
.form-tip.warning {
  color: var(--warning-text);
  background: var(--warning-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--warning-border);
}
.form-tip.ok {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.08);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(34, 197, 94, 0.2);
}

/* 模型推荐 chips */
.input-with-chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.recommended-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 3px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.chip:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.chip.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

/* Ollama */
.ollama-status {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
}
.ollama-custom-path label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.path-input-row {
  display: flex;
  gap: 8px;
}
.path-input-row input {
  flex: 1;
  min-width: 0;
}
.ollama-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.status-error {
  color: var(--danger);
  font-size: 12px;
  margin-top: 4px;
  word-break: break-word;
}
.ollama-info {
  padding: 8px 10px;
  background: #ecfdf5;
  border: 1px solid #6ee7b7;
  border-radius: var(--radius-sm);
}
.status-ok {
  color: #059669;
  font-size: 12px;
  font-weight: 500;
}

/* 操作按钮 - 固定在底部，始终可见 */
.action-bar {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.action-bar button {
  flex: 1;
  padding: 9px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}
.action-bar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-bar button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.action-bar button.primary:hover:not(:disabled) {
  background: var(--accent-light);
}
.action-bar button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.action-bar .btn-save {
  background: var(--bg-secondary);
  border-color: var(--accent);
  color: var(--accent);
}
.action-bar .btn-save:hover:not(:disabled) {
  background: var(--accent-bg);
}

/* 进度、消息、结果、帮助 */
.model-lab-progress {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.model-lab-progress .progress-bar {
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.model-lab-progress .progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.model-lab-progress .progress-text {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.model-lab-progress .progress-chunks {
  color: var(--accent);
  font-weight: 500;
}
.model-lab-msg {
  font-size: 12px;
  color: var(--accent);
  line-height: 1.5;
}
.model-lab-msg.warning {
  color: var(--warning-text);
  background: var(--warning-bg);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--warning-border);
}
.model-lab-terms h4 {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.term-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.term-chip {
  padding: 3px 8px;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 12px;
  font-size: 11px;
}
.model-lab-help {
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.model-lab-help h4 {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.model-lab-help ol {
  padding-left: 1.4em;
  margin-bottom: 8px;
}
.model-lab-help li {
  margin-bottom: 4px;
}
.model-lab-help code {
  font-family: var(--font-mono);
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 11px;
}
.model-lab-help a {
  color: var(--accent);
  text-decoration: none;
}
.model-lab-help .hint {
  color: var(--text-tertiary);
  font-size: 11px;
}
.copy-cmd {
  margin-left: 6px;
  padding: 1px 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.copy-cmd:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.field-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

/* 响应式 */
@media (max-width: 360px) {
  .form-row {
    grid-template-columns: 1fr;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-grid .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
