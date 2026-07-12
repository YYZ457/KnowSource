/** @module services/embedding-provider
 *  职责：embedding 提供者适配器（stub / Ollama / OpenAI 兼容） */

import { VENDOR_PRESETS, withRetry } from './llm-provider.js';

// 各 OpenAI 兼容供应商的默认 embedding 模型
const EMBEDDING_PRESETS = {
  openai: 'text-embedding-3-small',
  deepseek: '', // DeepSeek 暂不公开 embedding，留空由用户指定
  siliconflow: 'BAAI/bge-large-zh-v1.5',
  openrouter: '',
  moonshot: '',
  qwen: 'text-embedding-v3',
  zhipu: 'embedding-3',
  custom: '',
  // HuggingFace 默认使用轻量级 sentence-transformers 模型
  huggingface: 'sentence-transformers/all-MiniLM-L6-v2'
};

/** 校验 embedding 返回值是有效数值数组 */
function validateEmbedding(vec, providerName) {
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error(`${providerName} 返回了无效的 embedding：期望非空数值数组`);
  }
  // 检查首尾元素是否为数字（抽样检查，避免遍历整个向量）
  if (typeof vec[0] !== 'number' || typeof vec[vec.length - 1] !== 'number') {
    throw new Error(`${providerName} 返回的 embedding 包含非数值元素`);
  }
  // 维度一致性检测：首次调用时记录维度，后续调用校验
  if (expectedDimension === null) {
    expectedDimension = vec.length;
  } else if (vec.length !== expectedDimension) {
    throw new Error(
      `${providerName} 返回维度 ${vec.length} 与预期 ${expectedDimension} 不一致，` +
      `可能 provider 或 model 配置已变更，请重新构建图谱`
    );
  }
  return vec;
}

// 预期维度（首次 embedding 后设置，provider 切换时重置）
let expectedDimension = null;

// 默认 stub：基于 hash 的伪 embedding（保证无网络时可用）
class StubEmbeddingProvider {
  constructor(dim = 64) {
    this.dim = dim;
    this.name = 'stub';
  }

  async embed(text) {
    const vec = new Array(this.dim).fill(0);
    // 简单 hash-based 伪 embedding：按字符 hash 分桶
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      vec[i % this.dim] += (c / 65536);
    }
    // 归一化
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }
}

// Ollama 适配器
class OllamaEmbeddingProvider {
  constructor({ baseUrl = 'http://127.0.0.1:11434', model = 'nomic-embed-text' } = {}) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.name = 'ollama';
  }

  async embed(text) {
    const doFetch = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt: text }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          const err = new Error(`Ollama embed failed: ${resp.status} ${errText.slice(0, 200)}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        return validateEmbedding(data.embedding, 'Ollama');
      } finally {
        clearTimeout(timeout);
      }
    };
    return withRetry(doFetch, { maxRetries: 2, baseDelay: 1000 });
  }
}


// OpenAI 兼容 embedding 适配器（DeepSeek / SiliconFlow / 通义千问 / 智谱等）
class OpenAICompatibleEmbeddingProvider {
  constructor({ apiKey, model = '', baseUrl = 'https://api.openai.com/v1', vendor = 'openai' } = {}) {
    this.apiKey = apiKey;
    this.model = model || EMBEDDING_PRESETS[vendor] || '';
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.vendor = vendor;
    this.name = 'openai-compatible';
  }

  async embed(text) {
    if (!this.model) {
      throw new Error('未配置 embedding 模型，请手动指定');
    }
    const doFetch = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({ model: this.model, input: text }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          const err = new Error(`OpenAI-compatible embed failed: ${resp.status} ${errText.slice(0, 200)}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        const vec = data?.data?.[0]?.embedding;
        return validateEmbedding(vec, 'OpenAI-compatible');
      } finally {
        clearTimeout(timeout);
      }
    };
    return withRetry(doFetch, { maxRetries: 2, baseDelay: 1000 });
  }
}

// OpenAI embedding（保留别名，保持旧配置向后兼容）
class OpenAIEmbeddingProvider extends OpenAICompatibleEmbeddingProvider {
  constructor(options = {}) {
    super({ ...options, vendor: options.vendor || 'openai' });
    this.name = 'openai';
  }
}

// HuggingFace Inference API embedding 适配器
// 使用 HF 的 feature-extraction pipeline 生成文本向量
class HuggingFaceEmbeddingProvider {
  constructor({ apiKey, model = '', baseUrl = '' } = {}) {
    this.apiKey = apiKey;
    this.model = model || EMBEDDING_PRESETS.huggingface;
    this.baseUrl = baseUrl;
    this.name = 'huggingface';
  }

  _embedUrl() {
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/pipeline/feature-extraction/${this.model}`;
    }
    return `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`;
  }

  async embed(text) {
    const doFetch = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const resp = await fetch(this._embedUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          const err = new Error(`HuggingFace embed failed: ${resp.status} ${errText.slice(0, 200)}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        // HF feature-extraction 返回嵌套数组 [[...]]，取第一个 token 向量
        // 若返回 per-token 嵌套数组，取均值池化
        if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
          // per-token: [[v1, v2, ...], [v3, v4, ...], ...] → 均值池化
          const tokens = data[0];
          const dim = tokens[0].length;
          const pooled = new Array(dim).fill(0);
          for (const t of tokens) {
            for (let i = 0; i < dim; i++) pooled[i] += t[i] / tokens.length;
          }
          return validateEmbedding(pooled, 'HuggingFace');
        }
        const vec = Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : data;
        return validateEmbedding(vec, 'HuggingFace');
      } finally {
        clearTimeout(timeout);
      }
    };
    return withRetry(doFetch, { maxRetries: 2, baseDelay: 1000 });
  }
}

let currentProvider = new StubEmbeddingProvider();

export async function setEmbeddingProvider(provider) {
  currentProvider = provider;
  // 重置预期维度，允许新 provider 使用不同维度
  expectedDimension = null;
  // 清除向量库缓存，避免旧维度向量与新 provider 不匹配
  try {
    const { getVectorStore } = await import('./vector-store.js');
    const store = getVectorStore();
    if (store && typeof store.clear === 'function') {
      await store.clear();
      console.log('[embedding] 向量库缓存已清除（provider 切换）');
    }
  } catch (e) {
    // vector-store 可能未初始化，忽略
    console.warn('[embedding] 清除向量库缓存失败:', e.message);
  }
}

export function getEmbeddingProvider() {
  return currentProvider;
}


export function createProvider(type, options = {}) {
  switch (type) {
    case 'ollama': return new OllamaEmbeddingProvider(options);
    case 'huggingface': return new HuggingFaceEmbeddingProvider(options);
    case 'openai': return new OpenAIEmbeddingProvider(options);
    case 'openai-compatible': {
      const v = options.vendor || 'openai';
      const preset = VENDOR_PRESETS[v] || VENDOR_PRESETS.custom;
      return new OpenAICompatibleEmbeddingProvider({
        ...options,
        vendor: v,
        baseUrl: options.baseUrl || preset.baseUrl,
        model: options.model || EMBEDDING_PRESETS[v] || ''
      });
    }
    case 'deepseek':
    case 'siliconflow':
    case 'openrouter':
    case 'moonshot':
    case 'qwen':
    case 'zhipu':
    case 'custom': {
      const preset = VENDOR_PRESETS[type] || VENDOR_PRESETS.custom;
      return new OpenAICompatibleEmbeddingProvider({
        ...options,
        vendor: type,
        baseUrl: options.baseUrl || preset.baseUrl,
        model: options.model || EMBEDDING_PRESETS[type] || ''
      });
    }
    case 'stub':
    default: return new StubEmbeddingProvider(options.dim || 64);
  }
}

export async function embed(text) {
  return currentProvider.embed(text);
}

export { StubEmbeddingProvider, OllamaEmbeddingProvider, HuggingFaceEmbeddingProvider, OpenAIEmbeddingProvider, OpenAICompatibleEmbeddingProvider, EMBEDDING_PRESETS };
