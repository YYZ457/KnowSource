/** @module services/embedding-provider
 *  职责：embedding 提供者适配器（stub / Ollama / OpenAI 兼容） */

import { VENDOR_PRESETS } from './llm-provider.js';

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`Ollama embed failed: ${resp.status}`);
      const data = await resp.json();
      return data.embedding;
    } finally {
      clearTimeout(timeout);
    }
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
        throw new Error(`OpenAI-compatible embed failed: ${resp.status} ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();
      return data.data[0].embedding;
    } finally {
      clearTimeout(timeout);
    }
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
      // HF feature-extraction 返回嵌套数组 [[...]]，取第一层
      return Array.isArray(data) ? (Array.isArray(data[0]) ? data[0] : data) : data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let currentProvider = new StubEmbeddingProvider();

export function setEmbeddingProvider(provider) {
  currentProvider = provider;
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

export { StubEmbeddingProvider, OllamaEmbeddingProvider, HuggingFaceEmbeddingProvider, OpenAIEmbeddingProvider, OpenAICompatibleEmbeddingProvider };
