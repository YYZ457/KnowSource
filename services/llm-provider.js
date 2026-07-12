/** @module services/llm-provider
 *  职责：LLM 适配器（统一接口 complete/embed），支持 OpenAI / Ollama / Stub
 */

/**
 * 推断 LLM 的能力等级和上下文窗口
 * 用于自适应参数调整（chunkSize/maxTokens/concurrency 等）
 * @param {string} vendor - 厂商标识（openai/deepseek/ollama/...）
 * @param {string} model - 模型名称
 * @returns {{qualityLevel: 'weak'|'medium'|'strong', contextWindow: number, supportsJsonMode: boolean}}
 */
export function inferCapabilities(vendor, model) {
  const m = (model || '').toLowerCase();

  // Ollama 本地模型：按参数量分级
  if (vendor === 'ollama') {
    if (/(?:0\.5b|1b|1\.5b|2b|3b|tiny|small)/.test(m)) {
      return { qualityLevel: 'weak', contextWindow: 2048, supportsJsonMode: false };
    }
    if (/(?:7b|8b|13b|phi3|gemma2:2|llama3\.2|qwen2\.5:1|qwen2\.5:3)/.test(m)) {
      return { qualityLevel: 'medium', contextWindow: 8192, supportsJsonMode: false };
    }
    // 较大本地模型（14b/32b/70b 等）
    return { qualityLevel: 'medium', contextWindow: 16384, supportsJsonMode: false };
  }

  // HuggingFace 模型：按模型名中的参数规模启发式判断
  // HF 模型名通常为 org/model 格式，参数量嵌入在名称中
  if (vendor === 'huggingface') {
    if (/(?:0\.5b|1b|1\.5b|2b|3b|tiny|small|mini)/.test(m)) {
      return { qualityLevel: 'weak', contextWindow: 4096, supportsJsonMode: false };
    }
    if (/(?:7b|8b|13b|phi3|gemma2|llama3|mistral)/.test(m)) {
      return { qualityLevel: 'medium', contextWindow: 8192, supportsJsonMode: false };
    }
    // 较大 HF 模型默认 medium，保守估计上下文窗口
    return { qualityLevel: 'medium', contextWindow: 8192, supportsJsonMode: false };
  }

  // 云端模型：默认 strong，部分轻量模型降级为 medium
  if (/(?:mini|flash|turbo|small|lite|nano|air)/.test(m)) {
    return { qualityLevel: 'medium', contextWindow: 32768, supportsJsonMode: true };
  }

  // 强模型：GPT-4o, Claude, DeepSeek-V3/R1, Qwen-Max, GLM-4 等
  return { qualityLevel: 'strong', contextWindow: 128000, supportsJsonMode: true };
}

/**
 * 通用重试包装函数：针对 LLM 调用的瞬态故障（网络抖动、429 限流、5xx 服务端错误）进行重试。
 *
 * 重试策略：
 * - 指数退避：delay = baseDelay * 2^attempt（1s, 2s, 4s ...）
 * - 4xx（非 429）错误视为不可恢复，立即抛出（如 401 鉴权失败、400 参数错误）
 * - 429（限流）与 5xx（服务端错误）以及无 status 的网络错误（含超时 abort）会重试
 * - 错误对象需携带 status 属性以便判断；调用方应在抛出错误时设置 err.status
 *
 * @param {() => Promise<any>} fn - 实际执行函数（每次重试都会重新调用，故应将
 *   AbortController 等一次性资源的创建放在 fn 内部，确保每次重试获得全新实例）
 * @param {{maxRetries?: number, baseDelay?: number}} [options]
 * @returns {Promise<any>} fn 的返回值
 */
async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelay = options.baseDelay ?? 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // 已达最大重试次数，直接抛出
      if (attempt === maxRetries) throw e;
      // 不可恢复的错误（如响应格式异常）不重试
      if (e.unrecoverable) throw e;
      // 4xx（非 429）错误不重试：这类错误重试也无法成功
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      // 指数退避等待后重试
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Stub LLM（无网络时回退）
class StubLLMProvider {
  constructor(options = {}) {
    this.name = 'stub';
    this.model = options.model || '';
    this.config = { provider: 'stub', model: this.model };
    this.capabilities = { qualityLevel: 'none', contextWindow: 0, supportsJsonMode: false };
  }

  async complete(prompt, options = {}) {
    // 返回简单回复，仅在 prompt 确实被截断时才追加省略号
    const truncated = prompt.length > 100;
    return `[stub-llm] ${prompt.slice(0, 100)}${truncated ? '...' : ''}`;
  }

  async embed(text) {
    // 复用 embedding-provider 的 stub 逻辑
    const dim = 64;
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 65536;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }
}

// Ollama LLM
class OllamaLLMProvider {
  constructor({ baseUrl = 'http://127.0.0.1:11434', model = 'llama3' } = {}) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.name = 'ollama';
    this.config = { provider: 'ollama', model, baseUrl };
    // 推断模型能力等级
    this.capabilities = inferCapabilities('ollama', model);
    // embed 模型：允许通过 options.embedModel 指定，默认 nomic-embed-text
    this.embedModel = null; // 由外部设置或使用默认
  }

  async complete(prompt, options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    const maxRetries = options.maxRetries ?? 2;

    // 实际的 fetch 逻辑提取为内部方法，便于 withRetry 包装。
    // 每次重试都会重新创建 AbortController（旧的 controller 可能已被 abort）。
    const doFetch = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // 使用 /api/chat 端点（支持所有现代聊天模型，包括 qwen2.5、llama3 等）
        const messages = [];
        if (options.system) {
          messages.push({ role: 'system', content: options.system });
        }
        messages.push({ role: 'user', content: prompt });

        const body = {
          model: this.model,
          messages,
          stream: false,
          options: { temperature: options.temperature || 0.7 }
        };
        // 支持 stop 序列：小模型输出 JSON 后停止，避免多余文本
        if (options.stop && Array.isArray(options.stop)) {
          body.options.stop = options.stop;
        }
        if (options.maxTokens) {
          body.options.num_predict = options.maxTokens;
        }
        // JSON mode：Ollama 原生支持 format: 'json'，让模型输出合法 JSON
        if (options.responseFormat === 'json') {
          body.format = 'json';
        }
        const resp = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          // 携带 status 属性，供 withRetry 判断是否重试
          const err = new Error(`Ollama complete failed: ${resp.status}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        return data.message?.content ?? data.response ?? '';
      } finally {
        clearTimeout(timer);
      }
    };

    return withRetry(doFetch, { maxRetries, baseDelay: 1000 });
  }

  async embed(text) {
    const timeoutMs = 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: this.embedModel || 'nomic-embed-text', prompt: text })
      });
      if (!resp.ok) throw new Error(`Ollama embed failed: ${resp.status}`);
      const data = await resp.json();
      return data.embedding;
    } finally {
      clearTimeout(timer);
    }
  }
}

// Hugging Face Inference API
class HuggingFaceLLMProvider {
  constructor({ apiKey, model = 'mistralai/Mistral-7B-Instruct-v0.2', baseUrl = '' } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.name = 'huggingface';
    this.config = { provider: 'huggingface', model, baseUrl: baseUrl || undefined };
    // 推断模型能力等级（weak/medium/strong）和上下文窗口
    this.capabilities = inferCapabilities('huggingface', model);
  }

  _completeUrl() {
    if (this.baseUrl) {
      return `${this.baseUrl.replace(/\/$/, '')}/${this.model}`;
    }
    return `https://api-inference.huggingface.co/models/${this.model}`;
  }

  async complete(prompt, options = {}) {
    const timeoutMs = options.timeoutMs || 60000;
    const maxRetries = options.maxRetries ?? 2;

    // 实际的 fetch 逻辑提取为内部方法，便于 withRetry 包装。
    // 每次重试都会重新创建 AbortController（旧的 controller 可能已被 abort）。
    const doFetch = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // HuggingFace 不支持 system role，将 system 前置拼接
        const inputs = options.system ? `${options.system}\n\n${prompt}` : prompt;
        const resp = await fetch(this._completeUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify({
            inputs,
            parameters: {
              max_new_tokens: options.maxTokens || 512,
              temperature: options.temperature || 0.3,
              return_full_text: false
            }
          })
        });
        if (!resp.ok) {
          // 携带 status 属性，供 withRetry 判断是否重试
          const err = new Error(`HuggingFace complete failed: ${resp.status}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        // HF text-generation returns [{ generated_text: '...' }] or [{ summary_text: '...' }]
        if (Array.isArray(data)) {
          return data[0]?.generated_text || data[0]?.summary_text || JSON.stringify(data[0]);
        }
        return data.generated_text || data.summary_text || JSON.stringify(data);
      } finally {
        clearTimeout(timer);
      }
    };

    return withRetry(doFetch, { maxRetries, baseDelay: 1000 });
  }

  async embed(text) {
    const url = this.baseUrl
      ? `${this.baseUrl.replace(/\/$/, '')}/pipeline/feature-extraction/${this.model}`
      : `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`HuggingFace embed failed: ${resp.status}`);
      const data = await resp.json();
      return Array.isArray(data) ? data[0] : data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// OpenAI 兼容云端 LLM（DeepSeek / SiliconFlow / OpenRouter / Moonshot / 通义千问 / 智谱等）
export const VENDOR_PRESETS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    needApiKey: true
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needApiKey: true
  },
  siliconflow: {
    label: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
    needApiKey: true
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
    needApiKey: true
  },
  moonshot: {
    label: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    needApiKey: true
  },
  qwen: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    needApiKey: true
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4', 'glm-4-air'],
    needApiKey: true
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    baseUrl: '',
    models: [],
    needApiKey: true
  }
};

class OpenAICompatibleLLMProvider {
  constructor({ apiKey, model = '', baseUrl = 'https://api.openai.com/v1', vendor = 'openai' } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.vendor = vendor;
    this.name = 'openai-compatible';
    this.config = { provider: 'openai-compatible', vendor, model, baseUrl: this.baseUrl };
    // 推断模型能力等级（weak/medium/strong）和上下文窗口
    this.capabilities = inferCapabilities(vendor, model);
  }

  async complete(prompt, options = {}) {
    const timeoutMs = options.timeoutMs || 60000;
    const maxRetries = options.maxRetries ?? 2;

    // 实际的 fetch 逻辑提取为内部方法，便于 withRetry 包装。
    // 每次重试都会重新创建 AbortController（旧的 controller 可能已被 abort）。
    const doFetch = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // 构建 messages：支持 system message 通道（strong 模型显著受益）
        const messages = [];
        if (options.system) {
          messages.push({ role: 'system', content: options.system });
        }
        messages.push({ role: 'user', content: prompt });

        const body = {
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.7,
          // strong 模型默认 4096，其他模型保留 1000
          max_tokens: options.maxTokens || (this.capabilities?.qualityLevel === 'strong' ? 4096 : 1000)
        };
        if (options.stop && Array.isArray(options.stop)) {
          body.stop = options.stop;
        }
        // JSON mode：strong 模型启用原生 JSON 输出，避免脆弱的正则解析
        if (options.responseFormat === 'json' && this.capabilities?.qualityLevel === 'strong') {
          body.response_format = { type: 'json_object' };
        }
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          signal: controller.signal,
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          // 携带 status 属性，供 withRetry 判断是否重试
          const err = new Error(`OpenAI-compatible complete failed: ${resp.status} ${errText.slice(0, 200)}`);
          err.status = resp.status;
          throw err;
        }
        const data = await resp.json();
        // 空值保护：部分兼容服务在限流/错误时返回非标准结构
        const content = data?.choices?.[0]?.message?.content;
        if (content == null) {
          // 修复：设置 status=200 使 withRetry 跳过重试（非 4xx/5xx，但内容不可恢复）
          const err = new Error(`LLM 响应格式异常：未找到 choices[0].message.content（status ${resp.status}）`);
          err.status = 200; // 标记为不可恢复（非网络错误、非限流）
          err.unrecoverable = true;
          throw err;
        }
        return content;
      } finally {
        clearTimeout(timer);
      }
    };

    return withRetry(doFetch, { maxRetries, baseDelay: 1000 });
  }

  async embed(text) {
    // 复用 embedding-provider 的厂商预设模型，而非硬编码 OpenAI 的模型
    const { createProvider: createEmbeddingProvider, EMBEDDING_PRESETS } = await import('./embedding-provider.js');
    // 动态导入避免循环依赖
    const embedModel = EMBEDDING_PRESETS[this.vendor] || 'text-embedding-3-small';
    const provider = createEmbeddingProvider(this.vendor === 'openai' ? 'openai' : 'openai-compatible', {
      apiKey: this.apiKey,
      model: embedModel,
      baseUrl: this.baseUrl,
      vendor: this.vendor
    });
    return provider.embed(text);
  }
}

// OpenAI LLM（保留别名，保持旧配置的向后兼容）
class OpenAILLMProvider extends OpenAICompatibleLLMProvider {
  constructor(options = {}) {
    super({
      ...options,
      vendor: options.vendor || 'openai',
      model: options.model || 'gpt-3.5-turbo',
      baseUrl: options.baseUrl || 'https://api.openai.com/v1'
    });
    this.name = 'openai';
    this.config = { provider: 'openai', vendor: this.vendor, model: this.model, baseUrl: this.baseUrl };
  }
}

let currentProvider = new StubLLMProvider();
let currentKGProvider = new StubLLMProvider();

export function setLLMProvider(provider) {
  currentProvider = provider;
}

export function getLLMProvider() {
  return currentProvider;
}

export function setKGProvider(provider) {
  currentKGProvider = provider;
}

export function getKGProvider() {
  return currentKGProvider;
}

export function createLLMProvider(type, options = {}) {
  switch (type) {
    case 'huggingface': return new HuggingFaceLLMProvider(options);
    case 'ollama': return new OllamaLLMProvider(options);
    case 'openai': return new OpenAILLMProvider(options);
    case 'openai-compatible': {
      const v = options.vendor || 'openai';
      const preset = VENDOR_PRESETS[v] || VENDOR_PRESETS.custom;
      // 校验 apiKey：非 stub/ollama 厂商需要 API Key
      if (preset.needApiKey && !options.apiKey) {
        throw new Error(`${v} 服务商需要 API Key，请在模型配置中填写`);
      }
      return new OpenAICompatibleLLMProvider({
        ...options,
        vendor: v,
        baseUrl: options.baseUrl || preset.baseUrl,
        model: options.model || preset.models[0] || ''
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
      if (preset.needApiKey && !options.apiKey) {
        throw new Error(`${type} 服务商需要 API Key，请在模型配置中填写`);
      }
      return new OpenAICompatibleLLMProvider({
        ...options,
        vendor: type,
        baseUrl: options.baseUrl || preset.baseUrl,
        model: options.model || preset.models[0] || ''
      });
    }
    case 'stub':
    default: return new StubLLMProvider(options);
  }
}

export async function complete(prompt, options) {
  return currentProvider.complete(prompt, options);
}

export async function embed(text) {
  return currentProvider.embed(text);
}

export { StubLLMProvider, HuggingFaceLLMProvider, OllamaLLMProvider, OpenAILLMProvider, OpenAICompatibleLLMProvider, withRetry };

/**
 * 判断给定的 provider 是否属于云端大模型（非本地 ollama / huggingface / stub）
 * 云端模型通常具有更大的上下文窗口和更强的指令遵循能力。
 */
export function isCloudProvider(provider) {
  if (!provider) return false;
  if (provider.name === 'stub' || provider.name === 'ollama' || provider.name === 'huggingface') return false;
  if (provider.vendor === 'ollama' || provider.vendor === 'huggingface') return false;
  return true;
}
