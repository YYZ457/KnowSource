// The desktop remains unrestricted; the public trial must not reach its host LAN.
export const hostedTrial = process.env.KNOWLEDGE_IDE_HOSTED_TRIAL === '1';
const allowedHosts = new Set(['api.openai.com', 'api.deepseek.com', 'api.siliconflow.cn', 'openrouter.ai', 'api.moonshot.cn', 'dashscope.aliyuncs.com', 'open.bigmodel.cn', 'api-inference.huggingface.co', 'router.huggingface.co']);
export function validateHostedModel(config) {
  if (!hostedTrial || !config.provider || config.provider === 'stub') return;
  if (config.provider === 'ollama') throw new Error('云端试验不能连接你电脑的本地 Ollama。请选云端模型，或在桌面版使用 Ollama。');
  if (config.baseUrl) {
    let url;
    try { url = new URL(config.baseUrl); } catch { throw new Error('模型地址格式无效'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowedHosts.has(url.hostname)) throw new Error('云端试验仅支持设置中列出的官方 HTTPS 模型地址。');
  }
}
export function installHostedFetchGuard() {
  if (!hostedTrial) return;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('云端试验拒绝访问非受支持的模型地址');
    // Model endpoints must not redirect to a private address.
    return original(input, { ...options, redirect: 'error' });
  };
}
