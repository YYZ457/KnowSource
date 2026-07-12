/** @module services/api/handlers/settings
 *  职责：LLM / KG / Embedding 模型配置同步到后端服务进程
 */
import { setLLMProvider, getLLMProvider, setKGProvider, getKGProvider, createLLMProvider, VENDOR_PRESETS } from '../../llm-provider.js';
import { setEmbeddingProvider, createProvider as createEmbeddingProvider } from '../../embedding-provider.js';
import { detectOllama } from '../../ollama-detector.js';

/**
 * 校验 provider 配置，返回警告列表（不阻止保存，但提醒用户缺失的关键字段）
 * @param {object} cfg - 已规范化的配置
 * @returns {string[]} 警告消息列表，空数组表示无警告
 */
function validateConfig(cfg) {
  const { provider, vendor, model, apiKey } = cfg;
  const warnings = [];

  if (!provider || provider === 'stub') {
    return warnings;
  }

  // HuggingFace 需要 API Key
  if (provider === 'huggingface') {
    if (!apiKey) {
      warnings.push('HuggingFace provider 需要 API Key，当前未设置，LLM 调用将失败');
    }
  }

  // OpenAI 兼容 provider：按 vendor 预设检查是否需要 API Key
  if (provider === 'openai-compatible') {
    const preset = VENDOR_PRESETS[vendor] || VENDOR_PRESETS.custom;
    if (preset.needApiKey && !apiKey) {
      warnings.push(`${preset.label || vendor} 需要 API Key，当前未设置，LLM 调用将失败`);
    }
    // 自定义 vendor 未指定模型名时提醒
    if (vendor === 'custom' && !model) {
      warnings.push('自定义 provider 未指定模型名，请手动填写模型名');
    }
  }

  return warnings;
}

/**
 * 应用配置到后端 provider 实例（LLM + Embedding 同步设置）
 * @param {object} config - 原始配置
 * @param {function} setter - setLLMProvider 或 setKGProvider
 * @returns {{warnings: string[]}} 校验警告列表
 */
async function applyConfig(config, setter) {
  // 创建副本，避免直接修改传入的 config 对象（调用方可能复用该对象）
  const cfg = { ...config };
  // 兼容旧配置：将 legacy 'openai' 迁移到 'openai-compatible'
  if (cfg.provider === 'openai') {
    cfg.provider = 'openai-compatible';
    cfg.vendor = cfg.vendor || 'openai';
  }
  if (cfg.baseUrl && cfg.baseUrl.includes('localhost:11434')) {
    cfg.baseUrl = cfg.baseUrl.replace('localhost:11434', '127.0.0.1:11434');
  }
  const { provider, vendor, model, apiKey, baseUrl } = cfg || {};

  // 修复：校验 provider 是否有效
  const VALID_PROVIDERS = ['stub', 'ollama', 'openai-compatible', 'huggingface'];
  if (provider && !VALID_PROVIDERS.includes(provider)) {
    return { warnings: [`未知的 provider: ${provider}，支持的有: ${VALID_PROVIDERS.join(', ')}`], error: true };
  }

  // 修复：非 stub provider 必须有 model
  if (provider && provider !== 'stub' && !model) {
    return { warnings: ['模型名称不能为空'], error: true };
  }

  // 校验配置，收集警告（不阻止保存，允许用户保存部分配置）
  const warnings = validateConfig(cfg);

  if (!provider || provider === 'stub') {
    setter(createLLMProvider('stub'));
    await setEmbeddingProvider(createEmbeddingProvider('stub'));
    return { warnings };
  }
  setter(createLLMProvider(provider, { vendor, model, apiKey, baseUrl }));
  // 同步设置 embedding provider：与 LLM 使用同一接入点，但按供应商选择默认 embedding 模型
  // （不传递 LLM 的 model，避免把对话模型名覆盖 embedding 模型名）
  await setEmbeddingProvider(createEmbeddingProvider(provider, { vendor, apiKey, baseUrl }));

  // 通知 Electron 主进程更新 CSP connect-src 白名单（用于渲染进程直接 fetch LLM API）
  if (baseUrl) {
    try { process.emit('llm-config-changed', { baseUrl }); } catch {}
  }

  return { warnings };
}

export async function setLLMProviderHandler(config = {}) {
  const result = await applyConfig(config, setLLMProvider);
  if (result.error) return { success: false, warnings: result.warnings };
  return { success: true, provider: config.provider, warnings: result.warnings };
}

/**
 * 返回当前 LLM provider 配置（供前端读取并显示）
 * 注意：apiKey 属于敏感信息，不回传
 */
export function getLLMProviderHandler() {
  const provider = getLLMProvider();
  const config = provider?.config || { provider: 'stub' };
  const { apiKey, ...safeConfig } = config;
  return safeConfig;
}

export async function setKGProviderHandler(config = {}) {
  const result = await applyConfig(config, setKGProvider);
  if (result.error) return { success: false, warnings: result.warnings };
  return { success: true, provider: config.provider, warnings: result.warnings };
}

/**
 * 返回当前 KG provider 配置（供前端读取并比较本地与后端配置是否一致）
 * 注意：apiKey 属于敏感信息，不回传
 */
export function getKGProviderHandler() {
  const provider = getKGProvider();
  return provider?.config || { provider: 'stub' };
}

/**
 * 检测本地 Ollama 是否可用并列出可选模型
 * 智能检测：会尝试 127.0.0.1 / localhost，若未运行则尝试启动本地已安装的 Ollama 服务。
 * @param {{baseUrl?:string, tryStart?:boolean, maxWait?:number, customPath?:string}} param
 */
export async function ollamaStatusHandler({ baseUrl, tryStart = true, maxWait = 30000, customPath } = {}) {
  const result = await detectOllama({ baseUrl, tryStart, maxWait, customPath });
  // 业务状态统一返回 200，避免前端把"未检测到"当成 HTTP 异常
  return { success: true, ...result };
}
