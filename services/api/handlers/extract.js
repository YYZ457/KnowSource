/** @module services/api/handlers/extract
 *  职责：POST /extract — 实体/关键词抽取
 */
import { extractKeywords } from '../../../core/extractor/index.js';
import { extractKeyTerms, extractKeyTermsWithMeta } from '../../../core/graph/llm-extractor.js';
import { storage } from '../../storage.js';
import { getKGProvider } from '../../llm-provider.js';

export async function extractHandler({ docId, text, topN, extractOptions = {} } = {}) {
  // 从共享存储获取文档，或直接用传入的 text
  let sourceText = text;
  let sourceDocId = docId;

  if (docId && storage.documents.has(docId)) {
    const doc = storage.documents.get(docId);
    sourceText = doc.rawText;
  }

  if (!sourceText) {
    return { success: false, error: '没有可用的文本', entities: [] };
  }

  // 优先使用 LLM 抽取（若配置了 KG 模型），否则回退 TF-IDF
  const kgProvider = getKGProvider();
  if (kgProvider && kgProvider.name !== 'stub') {
    try {
      const { terms, meta } = await extractKeyTermsWithMeta(sourceText, {
        provider: kgProvider,
        maxTerms: topN || 15,
        ...extractOptions
      });
      const entities = terms.map(t => ({
        term: t.term,
        score: t.score,
        source: meta.usedLLM ? 'llm' : 'rule',
        docId: sourceDocId
      }));
      return { docId: sourceDocId, entities, usedLLM: meta.usedLLM };
    } catch (e) {
      console.warn('[extract] LLM 抽取失败，回退 TF-IDF:', e.message);
      storage.setTaskProgress({ stage: 'fallback', log: 'LLM 抽取失败，回退 TF-IDF' });
    }
  }

  const keywords = extractKeywords(sourceText, topN || 15);
  const entities = keywords.map(k => ({
    term: k.word,
    score: k.count,
    source: 'tfidf',
    docId: sourceDocId
  }));

  return { docId: sourceDocId, entities, usedLLM: false };
}

/**
 * 使用当前配置的 KG 专用模型抽取关键术语（模型实验室）
 * @param {{docId?:string, text?:string, chunkSize?:number, overlap?:number, maxTermsPerChunk?:number, maxTerms?:number, splitMode?:string, enableSpecificityScoring?:boolean, specificityThreshold?:number, specificityBatchSize?:number, specificityTimeoutMs?:number}} param
 */
export async function modelTestHandler({
  docId, text,
  chunkSize, overlap, maxTermsPerChunk, maxTerms, splitMode,
  enableSpecificityScoring, specificityThreshold, specificityBatchSize, specificityTimeoutMs,
  fullExtractEnabled, fullExtractMaxContextChars, fullExtractTimeoutMs, maxHeadings
} = {}) {
  const taskId = 'model-test-' + Date.now();
  storage.resetTaskProgress(taskId);

  let sourceText = text;
  if (docId && storage.documents.has(docId)) {
    sourceText = storage.documents.get(docId).rawText;
  }
  if (!sourceText) {
    storage.setTaskProgress({ stage: 'error', percent: 100, log: '没有可用的文本' });
    return { success: false, error: '没有可用的文本', terms: [] };
  }

  const extractOptions = {
    chunkSize,
    overlap,
    maxTermsPerChunk,
    maxTerms,
    splitMode,
    enableSpecificityScoring,
    specificityThreshold,
    specificityBatchSize,
    specificityTimeoutMs,
    fullExtractEnabled,
    fullExtractMaxContextChars,
    fullExtractTimeoutMs,
    maxHeadings
  };
  // 过滤掉 undefined，让后端使用默认值
  Object.keys(extractOptions).forEach(key => {
    if (extractOptions[key] === undefined) delete extractOptions[key];
  });

  // 估算分块数，用于进度展示
  const effChunkSize = extractOptions.chunkSize || 2500;
  const estimatedChunks = Math.max(1, Math.ceil(sourceText.length / effChunkSize));
  storage.setTaskProgress({
    stage: 'start',
    percent: 5,
    log: `开始测试模型（文本 ${sourceText.length} 字符，预计 ${estimatedChunks} 个分块）...`,
    chunkCount: estimatedChunks
  });

  // 传入 onProgress 回调，让 llm-extractor 更新共享进度
  const { terms, meta } = await extractKeyTermsWithMeta(sourceText, {
    ...extractOptions,
    provider: getKGProvider(),
    onProgress: (p) => {
      storage.setTaskProgress({
        stage: p.stage || 'extract',
        percent: Math.min(95, Math.max(5, p.percent || 0)),
        log: p.log || '',
        chunkIndex: p.chunkIndex || 0,
        chunkCount: p.chunkCount || estimatedChunks
      });
    }
  });

  storage.setTaskProgress({
    stage: 'done',
    percent: 100,
    log: `测试完成：${terms.length} 个术语`
  });

  return {
    success: true,
    docId: docId || null,
    provider: meta.providerName || 'kg',
    usedLLM: meta.usedLLM,
    fallbackReason: meta.fallbackReason || '',
    warning: meta.error || '',
    model: meta.model || '',
    chunkCount: meta.chunkCount || 0,
    termsPerChunk: meta.termsPerChunk || [],
    totalRawTerms: meta.totalRawTerms || 0,
    uniqueAfterDedup: meta.uniqueAfterDedup || 0,
    terms: terms.map(t => ({ term: t.term, score: t.score }))
  };
}
