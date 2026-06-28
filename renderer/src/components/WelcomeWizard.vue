<script setup>
/** WelcomeWizard：首次启动引导向导：欢迎 → 模型配置 → 导入文档 → 完成 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useDocumentStore } from '@/stores/document';
import { useGraphStore } from '@/stores/graph';
import { useUiStore } from '@/stores/ui';
import { setLLMProvider, setKGProvider, createLLMProvider, VENDOR_PRESETS } from '@services/llm-provider';
import { client } from '@/api/client.js';
import { readKGExtractOptions } from '@/utils/kg-options';

const emit = defineEmits(['done']);

const docStore = useDocumentStore();
const graphStore = useGraphStore();
const uiStore = useUiStore();

const INIT_FLAG = 'knowsource-initialized';
const LLM_CONFIG_KEY = 'knowledge-ide-llm-config';
const KG_CONFIG_KEY = 'knowledge-ide-kg-config';

const step = ref(1); // 1..4
const totalSteps = 4;
const stepKey = ref(0); // 用于触发步骤切换动画

// ===== 第 2 步：模型配置 =====
const activeTab = ref('cloud'); // cloud | ollama | skip

// 云端模型
const cloudVendor = ref('deepseek');
const cloudApiKey = ref('');
const cloudBaseUrl = ref(VENDOR_PRESETS.deepseek.baseUrl);
const cloudModel = ref(VENDOR_PRESETS.deepseek.models[0]);
const cloudTesting = ref(false);
const cloudTestMsg = ref('');

// Ollama 本地模型
const ollamaInstalled = ref(null); // null=未检测 {installed, version}
const ollamaModels = ref([]);
const ollamaSelectedModel = ref('');
const ollamaCustomModel = ref('');
const ollamaInstalling = ref(false);
const ollamaInstallProgress = ref(0);
const ollamaInstallMsg = ref('');
const ollamaPulling = ref(false);
const ollamaPullProgress = ref('');
const ollamaPullMsg = ref('');
const customOllamaPath = ref('');
const CUSTOM_OLLAMA_KEY = 'knowledge-ide-ollama-path';

// ===== 第 3 步：导入文档 =====
const importedFiles = ref([]); // [{name, size, docId}]
const fileInput = ref(null);
const isDragging = ref(false);
const importing = ref(false);
const importMsg = ref('');
const importingFileName = ref('');
const showPreview = ref(false);
const previewArea = ref(null);

watch(() => docStore.parseProgress.previewText, () => {
  if (showPreview.value && previewArea.value) {
    nextTick(() => {
      previewArea.value.scrollTop = previewArea.value.scrollHeight;
    });
  }
});

function togglePreview() {
  showPreview.value = !showPreview.value;
  if (showPreview.value && previewArea.value) {
    nextTick(() => {
      previewArea.value.scrollTop = previewArea.value.scrollHeight;
    });
  }
}

// ===== 第 4 步：完成 =====
const buildingGraph = ref(false);
const buildPercent = ref(0);
const buildStage = ref('');

const vendorKeys = computed(() => Object.keys(VENDOR_PRESETS));

function applyVendorPreset(vendorKey) {
  const preset = VENDOR_PRESETS[vendorKey];
  if (!preset) return;
  const knownUrls = Object.values(VENDOR_PRESETS).map(p => p.baseUrl).filter(Boolean);
  if (!cloudBaseUrl.value || knownUrls.includes(cloudBaseUrl.value)) {
    cloudBaseUrl.value = preset.baseUrl;
  }
  if (!cloudModel.value || VENDOR_PRESETS[Object.keys(VENDOR_PRESETS).find(k => VENDOR_PRESETS[k].models.includes(cloudModel.value))]?.models.includes(cloudModel.value) === false) {
    cloudModel.value = preset.models[0] || '';
  } else if (!preset.models.includes(cloudModel.value)) {
    cloudModel.value = preset.models[0] || '';
  }
}

watch(cloudVendor, (val) => {
  const preset = VENDOR_PRESETS[val];
  if (!preset) return;
  cloudBaseUrl.value = preset.baseUrl;
  cloudModel.value = preset.models[0] || '';
});

// ===== 步骤导航 =====
function nextStep() {
  if (step.value < totalSteps) {
    step.value++;
    stepKey.value++;
  }
}

function prevStep() {
  if (step.value > 1) {
    step.value--;
    stepKey.value++;
  }
}

function goToStep(n) {
  if (n >= 1 && n <= totalSteps) {
    step.value = n;
    stepKey.value++;
  }
}

function skipWizard() {
  finishWizard();
}

function finishWizard() {
  try {
    localStorage.setItem(INIT_FLAG, 'true');
  } catch {}
  emit('done');
}

// ===== 云端模型测试连接 =====
async function testCloudConnection() {
  cloudTesting.value = true;
  cloudTestMsg.value = '';
  try {
    const config = {
      provider: 'openai-compatible',
      vendor: cloudVendor.value,
      model: cloudModel.value,
      apiKey: cloudApiKey.value,
      baseUrl: cloudBaseUrl.value
    };
    await client.setKGProvider(config);
    setKGProvider(createLLMProvider(config.provider, {
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      vendor: config.vendor
    }));
    if (window.KSElectron?.api?.setKGProvider) {
      await window.KSElectron.api.setKGProvider(config);
    }
    // 简单抽取测试
    const testText = '折射定律是光学的基本定律，描述光线在不同介质中的偏折。';
    const result = await client.modelTest('wizard-test', testText, {
      provider: 'openai-compatible',
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      vendor: config.vendor
    }).catch(() => null);
    if (result && !result.error) {
      cloudTestMsg.value = '✓ 连接成功，模型可用';
    } else {
      cloudTestMsg.value = '✓ 配置已保存（抽取测试跳过）';
    }
    // 持久化配置
    saveProviderConfig(KG_CONFIG_KEY, config);
    saveProviderConfig(LLM_CONFIG_KEY, config);
  } catch (e) {
    cloudTestMsg.value = '✗ 连接失败: ' + (e?.message || e);
  } finally {
    cloudTesting.value = false;
  }
}

function saveProviderConfig(key, config) {
  try {
    if (window.KSElectron?.secureStore && config.apiKey) {
      const safe = { ...config };
      delete safe.apiKey;
      localStorage.setItem(key, JSON.stringify(safe));
      window.KSElectron.secureStore.set(key === LLM_CONFIG_KEY ? 'llm-api-key' : 'kg-api-key', config.apiKey);
    } else {
      localStorage.setItem(key, JSON.stringify(config));
    }
  } catch {}
}

// ===== Ollama 检测/安装/拉取 =====
async function detectOllama(forceStart = true) {
  ollamaInstalled.value = null;
  ollamaModels.value = [];
  try {
    const result = await client.checkOllama(undefined, customOllamaPath.value || undefined);
    ollamaInstalled.value = result;
    if (result.available && result.models?.length > 0) {
      ollamaModels.value = result.models;
      if (!ollamaSelectedModel.value) {
        ollamaSelectedModel.value = result.models[0].name;
      }
    }
    return result;
  } catch (e) {
    ollamaInstalled.value = { available: false, installed: false, error: e?.message || '检测失败' };
    return ollamaInstalled.value;
  }
}

async function pollOllamaAfterInstall() {
  ollamaInstallMsg.value = '✓ 安装程序已运行，正在等待 Ollama 服务启动...';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await detectOllama(true);
    if (result.available) {
      ollamaInstallMsg.value = '✓ Ollama 已就绪';
      ollamaInstalling.value = false;
      return;
    }
  }
  ollamaInstallMsg.value = '⚠️ 安装后未能检测到 Ollama，请手动启动或重启应用后重试';
  ollamaInstalling.value = false;
}

async function installOllama() {
  if (!window.KSElectron?.ollama) {
    ollamaInstallMsg.value = '✗ 当前环境不支持自动安装，请手动下载：https://ollama.com/download';
    return;
  }
  ollamaInstalling.value = true;
  ollamaInstallProgress.value = 0;
  ollamaInstallMsg.value = '正在下载 Ollama 安装程序...';
  try {
    const result = await window.KSElectron.ollama.install();
    if (result.success) {
      await pollOllamaAfterInstall();
    } else {
      ollamaInstallMsg.value = '⚠️ 安装程序已下载到：' + result.downloadPath + '，请手动运行完成安装';
      ollamaInstalling.value = false;
    }
  } catch (e) {
    ollamaInstallMsg.value = '✗ 安装失败: ' + (e?.message || e);
    ollamaInstalling.value = false;
  }
}

// 保存取消订阅函数，组件卸载时清理监听器避免内存泄漏
let _unsubPullProgress = null;
let _unsubInstallProgress = null;

function setupOllamaProgressListeners() {
  if (!window.KSElectron?.ollama) return;
  _unsubPullProgress = window.KSElectron.ollama.onPullProgress((data) => {
    ollamaPullProgress.value = data.progress || '';
    if (data.raw) ollamaPullMsg.value = data.raw;
  });
  _unsubInstallProgress = window.KSElectron.ollama.onInstallProgress((data) => {
    ollamaInstallProgress.value = data.percent || 0;
  });
}

async function pullOllamaModel() {
  const modelName = ollamaCustomModel.value.trim() || ollamaSelectedModel.value;
  if (!modelName) {
    ollamaPullMsg.value = '请输入或选择要拉取的模型名';
    return;
  }
  if (!window.KSElectron?.ollama) {
    ollamaPullMsg.value = '✗ 当前环境不支持拉取模型';
    return;
  }
  ollamaPulling.value = true;
  ollamaPullProgress.value = '0%';
  ollamaPullMsg.value = '正在拉取模型 ' + modelName + ' ...';
  try {
    const result = await window.KSElectron.ollama.pull(modelName);
    if (result.success) {
      ollamaPullMsg.value = '✓ 模型 ' + modelName + ' 拉取完成';
      ollamaSelectedModel.value = modelName;
      ollamaCustomModel.value = '';
      await detectOllama();
      // 自动配置 Ollama 为 KG provider
      const config = {
        provider: 'ollama',
        model: modelName,
        baseUrl: 'http://127.0.0.1:11434'
      };
      await client.setKGProvider(config);
      setKGProvider(createLLMProvider('ollama', config));
      if (window.KSElectron?.api?.setKGProvider) {
        await window.KSElectron.api.setKGProvider(config);
      }
      saveProviderConfig(KG_CONFIG_KEY, config);
      saveProviderConfig(LLM_CONFIG_KEY, config);
    }
  } catch (e) {
    ollamaPullMsg.value = '✗ 拉取失败: ' + (e?.message || e);
  } finally {
    ollamaPulling.value = false;
  }
}

function useOllamaExisting() {
  const modelName = ollamaSelectedModel.value;
  if (!modelName) {
    ollamaPullMsg.value = '请先选择一个已安装的模型';
    return;
  }
  const config = {
    provider: 'ollama',
    model: modelName,
    baseUrl: 'http://127.0.0.1:11434'
  };
  client.setKGProvider(config).catch(() => {});
  setKGProvider(createLLMProvider('ollama', config));
  if (window.KSElectron?.api?.setKGProvider) {
    window.KSElectron.api.setKGProvider(config).catch(() => {});
  }
  saveProviderConfig(KG_CONFIG_KEY, config);
  saveProviderConfig(LLM_CONFIG_KEY, config);
  ollamaPullMsg.value = '✓ 已配置使用：' + modelName;
}

// ===== 暂不配置 =====
function useRuleExtraction() {
  // 不设置任何 provider，使用默认 stub（规则抽取 TextRank）
  try {
    localStorage.setItem(KG_CONFIG_KEY, JSON.stringify({ provider: 'stub' }));
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify({ provider: 'stub' }));
  } catch {}
}

// ===== 文件导入 =====
function triggerFileSelect() {
  fileInput.value?.click();
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(String(ev.target.result || ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(files) {
  importing.value = true;
  importMsg.value = '';
  for (const file of files) {
    const name = file.name;
    importingFileName.value = name;
    const lower = name.toLowerCase();
    try {
      let doc;
      if (lower.endsWith('.pdf')) {
        importMsg.value = '正在解析 PDF: ' + name;
        const base64 = await readFileAsBase64(file);
        doc = await docStore.importDocument(name, base64, 'pdf');
      } else if (lower.endsWith('.docx')) {
        importMsg.value = '正在导入 Word: ' + name;
        const base64 = await readFileAsBase64(file);
        doc = await docStore.importDocument(name, base64, 'docx');
      } else if (lower.endsWith('.pptx')) {
        importMsg.value = '正在导入 PPTX: ' + name;
        const base64 = await readFileAsBase64(file);
        doc = await docStore.importDocument(name, base64, 'pptx');
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].some(ext => lower.endsWith(ext))) {
        importMsg.value = '正在 OCR 识别图片: ' + name;
        const base64 = await readFileAsBase64(file);
        doc = await docStore.importDocument(name, base64, 'image');
      } else {
        importMsg.value = '正在导入: ' + name;
        const text = await readFileAsText(file);
        const type = (lower.endsWith('.md') || lower.endsWith('.markdown')) ? 'markdown' : 'text';
        doc = await docStore.importDocument(name, text, type);
      }
      if (doc && doc.meta) {
        importedFiles.value.push({ name, size: file.size, docId: doc.meta.docId });
      }
    } catch (err) {
      if (err.message && err.message.includes('已取消')) {
        importMsg.value = '已取消导入 ' + name;
        break;
      }
      importMsg.value = '导入失败 ' + name + ': ' + (err.message || err);
    }
  }
  importing.value = false;
  importingFileName.value = '';
  if (importedFiles.value.length > 0 && !importMsg.value.includes('已取消')) {
    importMsg.value = '已导入 ' + importedFiles.value.length + ' 个文件';
  }
}

function onFileInputChange(e) {
  const files = Array.from(e.target.files || []).filter(f => {
    const lower = f.name.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.pptx') || lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt') || ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].some(ext => lower.endsWith(ext));
  });
  if (files.length > 0) handleFiles(files);
  e.target.value = '';
}

function onDrop(e) {
  e.preventDefault();
  isDragging.value = false;
  const files = Array.from(e.dataTransfer.files || []).filter(f => {
    const lower = f.name.toLowerCase();
    return lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.pptx') || lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt') || ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].some(ext => lower.endsWith(ext));
  });
  if (files.length > 0) handleFiles(files);
}

function onDragOver(e) {
  e.preventDefault();
  isDragging.value = true;
}

function onDragLeave(e) {
  e.preventDefault();
  isDragging.value = false;
}

function removeImported(idx) {
  const item = importedFiles.value[idx];
  if (item?.docId) {
    docStore.removeDocument(item.docId).catch(() => {});
  }
  importedFiles.value.splice(idx, 1);
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ===== 进入第 5 步：构建图谱 =====
async function enterCompletionStep() {
  // 如果选了云端或 Ollama，确保配置已保存
  if (activeTab.value === 'skip') {
    useRuleExtraction();
  }
  nextStep();
  if (importedFiles.value.length > 0) {
    await buildKnowledgeGraph();
  }
}

async function buildKnowledgeGraph() {
  buildingGraph.value = true;
  buildPercent.value = 0;
  buildStage.value = '准备构建知识图谱...';
  let progressTimer = null;
  try {
    progressTimer = setInterval(async () => {
      if (!buildingGraph.value) return;
      try {
        const p = await client.getProgress();
        if (p && p.taskId && p.taskId.startsWith('graph-build')) {
          buildStage.value = p.log || p.stage || '构建中...';
          buildPercent.value = p.percent || 0;
        }
      } catch {}
    }, 500);

    const extractOptions = readKGExtractOptions();
    const result = await graphStore.buildGraph(extractOptions);
    buildPercent.value = 100;
    buildStage.value = `构建完成，${result.nodes?.length || 0} 节点，${result.edges?.length || 0} 边`;
  } catch (e) {
    buildStage.value = '构建失败: ' + (e?.message || e) + '（可稍后在主界面重试）';
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    buildingGraph.value = false;
  }
}

function startExplore() {
  finishWizard();
}

onMounted(() => {
  setupOllamaProgressListeners();
  try {
    const saved = localStorage.getItem(CUSTOM_OLLAMA_KEY);
    if (saved) customOllamaPath.value = saved;
  } catch {}
  if (activeTab.value === 'ollama') detectOllama();
});

onUnmounted(() => {
  // 清理 ipcRenderer 监听器，避免组件卸载后回调重复执行
  if (_unsubPullProgress) _unsubPullProgress();
  if (_unsubInstallProgress) _unsubInstallProgress();
});

async function browseOllamaPath() {
  if (!window.KSElectron?.openFileDialog) return;
  try {
    const result = await window.KSElectron.openFileDialog({
      title: '选择 Ollama 可执行文件',
      buttonLabel: '选择',
      properties: ['openFile'],
      filters: platform() === 'win32'
        ? [{ name: '可执行文件', extensions: ['exe'] }]
        : []
    });
    if (!result.canceled && result.filePaths?.length > 0) {
      customOllamaPath.value = result.filePaths[0];
      localStorage.setItem(CUSTOM_OLLAMA_KEY, customOllamaPath.value);
      await detectOllama();
    }
  } catch (e) {
    ollamaInstallMsg.value = '选择文件失败：' + (e?.message || e);
  }
}

function platform() {
  return typeof navigator !== 'undefined' ? (navigator.platform || '').toLowerCase() : '';
}
</script>

<template>
  <Transition name="wizard-fade" appear>
    <div class="wizard-overlay" @click.self="skip">
      <div class="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <!-- 步骤指示器 -->
        <div class="wizard-stepper" role="tablist" aria-label="向导步骤">
          <button v-for="n in totalSteps" :key="n" class="step-dot"
               type="button"
               role="tab"
               :aria-selected="step === n"
               :class="{active: step === n, done: step > n, disabled: buildingGraph}"
               :aria-label="`步骤 ${n}`"
               :tabindex="!buildingGraph && step >= n ? 0 : -1"
               @click="!buildingGraph && step >= n && goToStep(n)">
            <span class="step-num">{{ n }}</span>
          </button>
          <div class="step-progress-text" aria-live="polite">{{ step }}/{{ totalSteps }}</div>
        </div>

        <!-- 步骤内容（带淡入淡出动画） -->
        <div class="wizard-content" :key="stepKey">
          <Transition name="step-fade" mode="out-in">
            <div v-if="step === 1" class="step-pane" key="welcome">
              <div class="welcome-logo">
                <div class="logo-icon">📚</div>
                <h1 class="logo-title" id="wizard-title">知源</h1>
                <p class="logo-subtitle">智能知识图谱构建工具</p>
              </div>
              <div class="feature-cards">
                <div class="feature-card">
                  <div class="feature-emoji">🕸</div>
                  <h3>知识图谱</h3>
                  <p>自动从文档抽取概念,构建跨文档关联的可视化知识网络。</p>
                </div>
                <div class="feature-card">
                  <div class="feature-emoji">💡</div>
                  <h3>Idea 管理</h3>
                  <p>记录灵感,系统智能推荐相关知识节点,激发新思路。</p>
                </div>
                <div class="feature-card">
                  <div class="feature-emoji">🔗</div>
                  <h3>跨文档关联</h3>
                  <p>多文档语义匹配,发现隐藏的概念联系与知识脉络</p>
                </div>
              </div>
              <div class="wizard-actions">
                <button class="btn-secondary" @click="skipWizard">跳过引导</button>
                <button class="btn-primary" @click="nextStep">开始使用</button>
              </div>
            </div>

            <div v-else-if="step === 2" class="step-pane" key="model">
              <h2 class="step-title">配置 AI 模型</h2>
              <p class="step-desc">选择模型来源，用于智能抽取知识图谱节点。</p>

              <div class="tab-bar" role="tablist" aria-label="模型来源选择">
                <button :class="{active: activeTab==='cloud'}" role="tab" :aria-selected="activeTab==='cloud'" aria-label="云端大模型" @click="activeTab='cloud'">☁️ 云端大模型</button>
                <button :class="{active: activeTab==='ollama'}" role="tab" :aria-selected="activeTab==='ollama'" aria-label="本地模型 Ollama" @click="activeTab='ollama'; detectOllama()">🖥️ 本地模型 (Ollama)</button>
                <button :class="{active: activeTab==='skip'}" role="tab" :aria-selected="activeTab==='skip'" aria-label="暂不配置模型" @click="activeTab='skip'">⏭️ 暂不配置</button>
              </div>

              <!-- 云端模型 -->
              <div v-if="activeTab==='cloud'" class="tab-pane">
                <div class="form-field">
                  <label>供应商</label>
                  <select v-model="cloudVendor">
                    <option v-for="key in vendorKeys" :key="key" :value="key">
                      {{ VENDOR_PRESETS[key].label }}
                    </option>
                  </select>
                </div>
                <div class="form-field">
                  <label>API Key</label>
                  <input v-model="cloudApiKey" type="password" placeholder="sk-... / ds-... 等" />
                </div>
                <div class="form-field">
                  <label>Base URL</label>
                  <input v-model="cloudBaseUrl" placeholder="https://api.deepseek.com/v1" />
                </div>
                <div class="form-field">
                  <label>模型名</label>
                  <input v-model="cloudModel" placeholder="如 deepseek-chat" />
                </div>
                <div class="form-actions">
                  <button class="btn-secondary" :disabled="cloudTesting" @click="testCloudConnection">
                    {{ cloudTesting ? '测试中...' : '测试连接' }}
                  </button>
                  <span v-if="cloudTestMsg" class="form-msg" :class="{ok: cloudTestMsg.startsWith('✓'), err: cloudTestMsg.startsWith('✗')}">
                    {{ cloudTestMsg }}
                  </span>
                </div>
              </div>

              <!-- Ollama 本地模型 -->
              <div v-else-if="activeTab==='ollama'" class="tab-pane">
                <div v-if="ollamaInstalled === null" class="ollama-status">
                  <span class="status-loading">正在检测 Ollama...</span>
                </div>
                <div v-else-if="!ollamaInstalled.available" class="ollama-status">
                  <p class="status-warn">未检测到运行中的 Ollama，是否现在安装？</p>
                  <p class="form-hint">安装后我们会自动检测；如果你已安装但服务未启动，我们也会尝试启动。</p>
                  <div class="ollama-custom-path">
                    <label>Ollama 可执行文件路径（可选，用于自定义安装位置）</label>
                    <p class="form-hint">请选择文件夹内的 ollama.exe，不要选 ollama app.exe 等快捷方式。</p>
                    <div class="path-input-row">
                      <input v-model="customOllamaPath" type="text" placeholder="例如 C:\\Users\\xxx\\AppData\\Local\\Programs\\Ollama\\ollama.exe" @change="localStorage.setItem(CUSTOM_OLLAMA_KEY, customOllamaPath); detectOllama()" />
                      <button class="btn-secondary" @click="browseOllamaPath">浏览...</button>
                    </div>
                    <p v-if="ollamaInstalled.error" class="status-error">{{ ollamaInstalled.error }}</p>
                  </div>
                  <div class="form-actions">
                    <button class="btn-primary" :disabled="ollamaInstalling" @click="installOllama">
                      {{ ollamaInstalling ? '安装中...' : '下载并安装 Ollama' }}
                    </button>
                    <button class="btn-secondary" @click="activeTab='skip'">跳过，暂不配置</button>
                  </div>
                  <div v-if="ollamaInstalling" class="progress-bar">
                    <div class="progress-fill" :style="{width: ollamaInstallProgress + '%'}"></div>
                    <span class="progress-text">{{ ollamaInstallProgress }}%</span>
                  </div>
                  <p v-if="ollamaInstallMsg" class="form-msg">{{ ollamaInstallMsg }}</p>
                  <p class="form-hint">或手动下载:<a href="https://ollama.com/download" target="_blank">https://ollama.com/download</a></p>
                </div>
                <div v-else class="ollama-status">
                  <p class="status-ok">✓ 已找到 Ollama<span v-if="ollamaInstalled.baseUrl" class="version">{{ ollamaInstalled.baseUrl }}</span></p>
                  <div v-if="ollamaModels.length > 0" class="form-field">
                    <label>已安装模型</label>
                    <select v-model="ollamaSelectedModel">
                      <option v-for="m in ollamaModels" :key="m.name" :value="m.name">
                        {{ m.name }} <template v-if="m.size">({{ m.size }})</template>
                      </option>
                    </select>
                  </div>
                  <div v-else class="form-hint">尚未安装任何模型，请在下方拉取模型</div>
                  <div class="form-field">
                    <label>拉取新模型（输入模型名，如 qwen2.5:1.5b / llama3.2:1b）</label>
                    <input v-model="ollamaCustomModel" placeholder="qwen2.5:1.5b"
                           @keyup.enter="pullOllamaModel" />
                  </div>
                  <div class="form-actions">
                    <button v-if="ollamaModels.length > 0 && ollamaSelectedModel" class="btn-secondary" @click="useOllamaExisting">
                      使用所选模型
                    </button>
                    <button class="btn-primary" :disabled="ollamaPulling || !ollamaCustomModel" @click="pullOllamaModel">
                      {{ ollamaPulling ? '拉取中...' : '拉取模型' }}
                    </button>
                  </div>
                  <div v-if="ollamaPulling" class="progress-bar">
                    <div class="progress-fill" :style="{width: (parseInt(ollamaPullProgress) || 0) + '%'}"></div>
                    <span class="progress-text">{{ ollamaPullProgress }}</span>
                  </div>
                  <p v-if="ollamaPullMsg" class="form-msg" :class="{ok: ollamaPullMsg.startsWith('✓'), err: ollamaPullMsg.startsWith('✗')}">
                    {{ ollamaPullMsg }}
                  </p>
                </div>
              </div>

              <!-- 暂不配置 -->
              <div v-else class="tab-pane">
                <div class="skip-info">
                  <div class="skip-emoji">📝</div>
                  <p>将使用规则抽取（TextRank）构建知识图谱，无需 AI 模型。</p>
                  <p class="form-hint">后续可在「⚙ 设置」中随时配置云端或本地模型以获得更智能的抽取效果。</p>
                </div>
              </div>

              <div class="wizard-actions">
                <button class="btn-secondary" @click="prevStep">上一步</button>
                <button class="btn-primary" @click="nextStep">下一步</button>
              </div>
            </div>

            <div v-else-if="step === 3" class="step-pane" key="import">
              <h2 class="step-title">导入文档</h2>
              <p class="step-desc">支持 PDF / Word / PPTX / Markdown / 文本 / 图片,可跳过此步稍后导入</p>

              <div class="drop-zone" :class="{dragging: isDragging}"
                   role="button"
                   tabindex="0"
                   aria-label="拖拽文件到此处或按回车选择文件"
                   @drop="onDrop" @dragover="onDragOver" @dragleave="onDragLeave"
                   @click="triggerFileSelect"
                   @keydown.enter="triggerFileSelect">
                <div class="drop-icon" aria-hidden="true">📁</div>
                <p class="drop-text">拖拽文件到此处,或点击选择文件</p>
                <p class="drop-hint">支持 .pdf .docx .pptx .md .markdown .txt .png .jpg .jpeg .gif .bmp .webp</p>
                <input ref="fileInput" type="file" accept=".pdf,.docx,.pptx,.md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp" multiple
                       style="display:none" @change="onFileInputChange" />
              </div>

              <div v-if="importing && importingFileName" class="parse-progress-panel">
                <div class="parse-progress-header">
                  <span class="parse-progress-title">正在导入: {{ importingFileName }}</span>
                  <span class="parse-progress-stage">{{ docStore.parseStageText }}</span>
                </div>
                <div class="parse-progress-bar-wrap">
                  <div class="parse-progress-bar" :style="{ width: docStore.parseProgress.percent + '%' }"></div>
                </div>
                <div class="parse-progress-info">
                  <span>{{ docStore.parseProgress.log }}</span>
                  <span v-if="docStore.parseProgress.totalPages > 0">
                    第 {{ docStore.parseProgress.currentPage }}/{{ docStore.parseProgress.totalPages }} 页
                  </span>
                </div>
                <div class="parse-progress-actions">
                  <button class="btn-text" @click="togglePreview">
                    {{ showPreview ? '收起详情' : '展开详情' }}
                  </button>
                  <button v-if="docStore.parseProgress.status === 'running'" class="btn-text" @click="docStore.pauseParse()">暂停</button>
                  <button v-if="docStore.parseProgress.status === 'paused'" class="btn-text" @click="docStore.resumeParse()">继续</button>
                  <button class="btn-text danger" @click="docStore.cancelParse()">停止</button>
                </div>
                <div v-if="showPreview" ref="previewArea" class="parse-preview-area">
                  <pre>{{ docStore.parseProgress.previewText || '等待内容...' }}</pre>
                </div>
              </div>
              <div v-else-if="importing" class="import-status">
                <span class="status-loading">{{ importMsg || '导入中...' }}</span>
              </div>
              <div v-else-if="importMsg && importedFiles.length === 0" class="import-status">
                <span class="form-msg err">{{ importMsg }}</span>
              </div>

              <div v-if="importedFiles.length > 0" class="file-list">
                <div class="file-list-header">已导入 {{ importedFiles.length }} 个文件</div>
                <div v-for="(f, idx) in importedFiles" :key="f.docId || idx" class="file-item">
                  <span class="file-icon" aria-hidden="true">📄</span>
                  <span class="file-name">{{ f.name }}</span>
                  <span class="file-size">{{ formatSize(f.size) }}</span>
                  <button class="file-remove" :aria-label="`移除文件 ${f.name}`" title="移除" @click="removeImported(idx)">×</button>
                </div>
              </div>

              <div class="wizard-actions">
                <button class="btn-secondary" @click="prevStep">上一步</button>
                <button class="btn-primary" @click="enterCompletionStep">
                  {{ importedFiles.length > 0 ? '下一步' : '跳过此步' }}
                </button>
              </div>
            </div>

            <div v-else-if="step === 4" class="step-pane" key="done">
              <h2 class="step-title">
                {{ importedFiles.length > 0 ? '正在构建知识图谱' : '配置完成' }}
              </h2>

              <div v-if="importedFiles.length > 0" class="build-status">
                <div v-if="buildingGraph" class="building">
                  <div class="spinner"></div>
                  <p class="build-stage">{{ buildStage }}</p>
                  <div class="progress-bar">
                    <div class="progress-fill" :style="{width: buildPercent + '%'}"></div>
                    <span class="progress-text">{{ buildPercent }}%</span>
                  </div>
                </div>
                <div v-else class="build-done">
                  <div class="done-emoji">{{ buildStage.startsWith('构建失败') ? '⚠️' : '✓' }}</div>
                  <p class="build-stage">{{ buildStage }}</p>
                </div>
              </div>

              <div v-else class="welcome-logo">
                <div class="logo-icon done">🎉</div>
                <p class="logo-subtitle">一切就绪，开始你的知识探索之旅</p>
              </div>

              <div class="wizard-actions">
                <button v-if="!buildingGraph && importedFiles.length > 0 && buildStage.startsWith('构建失败')"
                        class="btn-secondary" @click="buildKnowledgeGraph">重试构建</button>
                <button class="btn-primary" :disabled="buildingGraph" @click="startExplore">
                  {{ buildingGraph ? '构建中...' : '开始探索' }}
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wizard-overlay {
  position: fixed; inset: 0;
  background: rgba(13, 13, 13, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
  animation: overlayIn 0.3s ease;
}
@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.wizard-modal {
  width: 680px; max-width: 92vw;
  max-height: 90vh; overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  display: flex; flex-direction: column;
  animation: modalIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.94) translateY(20px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* 步骤指示器 */
.wizard-stepper {
  display: flex; align-items: center; gap: 8px;
  padding: 20px 28px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  border-radius: 12px 12px 0 0;
}
.step-dot {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--bg-tertiary); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: var(--text-tertiary);
  cursor: default; transition: all 0.2s;
  padding: 0; font-family: inherit;
}
.step-dot.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-bg);
}
.step-dot.done {
  background: var(--success); color: #fff; border-color: var(--success);
  cursor: pointer;
}
.step-dot.done::after { content: '✓'; }
.step-dot.done .step-num { display: none; }
.step-dot.disabled {
  pointer-events: none;
  opacity: 0.6;
  cursor: not-allowed;
}
.step-progress-text {
  margin-left: auto; font-size: 12px; color: var(--text-tertiary); font-weight: 500;
}

.wizard-content { padding: 28px; flex: 1; }
.step-fade-enter-active, .step-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.step-fade-enter-from { opacity: 0; transform: translateX(20px); }
.step-fade-leave-to { opacity: 0; transform: translateX(-20px); }

/* 欢迎页 */
.welcome-logo { text-align: center; margin-bottom: 24px; }
.logo-icon {
  font-size: 56px; margin-bottom: 12px;
  display: inline-block;
  animation: bounce 1.5s infinite ease-in-out;
}
.logo-icon.done { font-size: 64px; animation: none; }
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.logo-title {
  font-size: 32px; font-weight: 700; color: var(--accent);
  margin-bottom: 6px; letter-spacing: 2px;
}
.logo-subtitle { font-size: 14px; color: var(--text-secondary); }

.feature-cards {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
  margin: 24px 0;
}
.feature-card {
  padding: 18px 14px; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 8px;
  text-align: center; transition: transform 0.2s, box-shadow 0.2s;
}
.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
  border-color: var(--accent);
}
.feature-emoji { font-size: 32px; margin-bottom: 8px; }
.feature-card h3 { font-size: 14px; color: var(--text-primary); margin-bottom: 6px; }
.feature-card p { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

/* 步骤标题 */
.step-title { font-size: 20px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.step-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 18px; }

/* 选项卡 */
.tab-bar {
  display: flex; gap: 4px; margin-bottom: 18px;
  background: var(--bg-secondary); padding: 4px;
  border-radius: 6px; border: 1px solid var(--border);
}
.tab-bar button {
  flex: 1; padding: 8px 10px; background: transparent; border: none;
  color: var(--text-secondary); font-size: 13px; font-weight: 500;
  border-radius: 4px; cursor: pointer; transition: all 0.15s;
}
.tab-bar button:hover { color: var(--text-primary); background: var(--bg-hover); }
.tab-bar button.active {
  color: var(--accent); background: var(--bg-primary);
  box-shadow: var(--shadow-sm);
}
.tab-pane { display: flex; flex-direction: column; gap: 12px; }

/* 表单 */
.form-field { display: flex; flex-direction: column; gap: 5px; }
.form-field label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.form-field input, .form-field select {
  padding: 8px 10px; background: var(--bg-secondary);
  border: 1px solid var(--border); color: var(--text-primary);
  border-radius: 4px; font-size: 13px; font-family: inherit;
}
.form-field input:focus, .form-field select:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.form-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.form-msg { font-size: 12px; color: var(--text-secondary); }
.form-msg.ok { color: var(--success); }
.form-msg.err { color: var(--danger); }
.form-hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
.form-hint a { color: var(--accent); }

/* Ollama 状态 */
.ollama-status { display: flex; flex-direction: column; gap: 12px; }
.ollama-custom-path label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.path-input-row { display: flex; gap: 8px; }
.path-input-row input { flex: 1; min-width: 0; }
.status-loading { color: var(--text-secondary); font-size: 13px; }
.status-ok { color: var(--success); font-size: 13px; font-weight: 500; }
.status-ok .version { color: var(--text-tertiary); font-weight: 400; margin-left: 6px; font-size: 12px; }
.status-warn { color: var(--warning); font-size: 13px; }
.status-error { color: var(--danger); font-size: 12px; margin-top: 4px; word-break: break-word; }

/* 暂不配置 */
.skip-info {
  text-align: center; padding: 20px;
  background: var(--bg-secondary); border-radius: 8px;
  border: 1px solid var(--border);
}
.skip-emoji { font-size: 40px; margin-bottom: 12px; }
.skip-info p { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }

/* 拖拽区 */
.drop-zone {
  padding: 36px 20px; border: 2px dashed var(--border-strong);
  border-radius: 8px; text-align: center; cursor: pointer;
  background: var(--bg-secondary); transition: all 0.2s;
}
.drop-zone:hover, .drop-zone.dragging {
  border-color: var(--accent); background: var(--accent-bg);
}
.drop-icon { font-size: 40px; margin-bottom: 10px; }
.drop-text { font-size: 14px; color: var(--text-primary); margin-bottom: 4px; font-weight: 500; }
.drop-hint { font-size: 12px; color: var(--text-tertiary); }

.import-status { margin-top: 12px; }
.file-list { margin-top: 16px; }
.file-list-header {
  font-size: 12px; color: var(--text-secondary); font-weight: 500;
  margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border);
}
.file-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: 4px;
  margin-bottom: 6px; font-size: 13px;
}
.file-item .file-icon { font-size: 16px; }
.file-item .file-name { flex: 1; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-item .file-size { color: var(--text-tertiary); font-size: 11px; }
.file-remove {
  width: 22px; height: 22px; background: transparent; border: none;
  color: var(--text-tertiary); font-size: 16px; cursor: pointer;
  border-radius: 3px; display: flex; align-items: center; justify-content: center;
}
.file-remove:hover { background: var(--danger); color: #fff; }

/* 进度条 */
.progress-bar {
  position: relative; height: 22px; background: var(--bg-tertiary);
  border-radius: 4px; overflow: hidden; border: 1px solid var(--border);
}
.progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-light));
  transition: width 0.3s ease; border-radius: 3px;
}
.progress-text {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 11px; color: var(--text-primary); font-weight: 600;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

/* 构建状态 */
.build-status { padding: 20px 0; }
.building { text-align: center; }
.spinner {
  width: 40px; height: 40px; margin: 0 auto 16px;
  border: 3px solid var(--bg-tertiary); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.build-stage { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; }
.build-done { text-align: center; }
.done-emoji { font-size: 48px; margin-bottom: 12px; }

/* 操作按钮 */
.wizard-actions {
  display: flex; justify-content: flex-end; gap: 10px;
  margin-top: 24px; padding-top: 18px;
  border-top: 1px solid var(--border);
}
.btn-primary {
  padding: 8px 20px; background: var(--accent); border: none;
  color: #fff; border-radius: 4px; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 0.15s, transform 0.05s;
}
.btn-primary:hover:not(:disabled) { background: var(--accent-light); }
.btn-primary:active:not(:disabled) { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  padding: 8px 20px; background: var(--bg-tertiary); border: 1px solid var(--border);
  color: var(--text-primary); border-radius: 4px; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 0.15s;
}
.btn-secondary:hover:not(:disabled) { background: var(--bg-hover); }
.btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

.wizard-fade-enter-active, .wizard-fade-leave-active { transition: opacity 0.3s ease; }
.wizard-fade-enter-from, .wizard-fade-leave-to { opacity: 0; }

.parse-progress-panel {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-md, 6px);
}
.parse-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.parse-progress-title {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
.parse-progress-stage {
  color: var(--accent, #3b82f6);
  font-weight: 500;
}
.parse-progress-bar-wrap {
  height: 6px;
  background: var(--bg-hover, #f1f5f9);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.parse-progress-bar {
  height: 100%;
  background: var(--accent, #3b82f6);
  transition: width 0.2s ease;
}
.parse-progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.parse-progress-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.parse-progress-actions .btn-text.danger {
  color: var(--danger, #ef4444);
}
</style>
