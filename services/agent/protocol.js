// Parse only complete JSON objects. Never execute or silently mend model code.
export function parseAgentReply(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('模型未返回可执行的内容');
  if (raw.length > 90000) throw new Error('模型输出过长，请缩小本阶段任务');
  let source = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const candidates = [source];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { candidates.push(source.slice(start, i + 1)); start = -1; }
  }
  for (const candidate of candidates) {
    let value;
    try { value = JSON.parse(candidate); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (typeof value.answer === 'string' || Array.isArray(value.toolCalls) || Array.isArray(value.actions)) return value;
  }
  throw new Error('模型响应不是完整的任务 JSON；将尝试修复格式');
}
