/** @module utils/kg-options
 *  职责：从 localStorage 读取知识图谱抽取参数，构造 extractOptions 对象。
 *  注意：不传递 provider/model/apiKey/baseUrl 字符串到后端，
 *  因为后端 extractKeyTermsWithMeta 期望 provider 实例（通过 getKGProvider() 获取），
 *  provider 实例的同步由 App.vue onMounted / ModelLab applyKGConfig 通过 /settings/kg 完成。
 *  这里只读取分块参数和全量抽取参数，确保各组件使用一致的配置。
 */

/**
 * 从 localStorage 读取分块参数和全量抽取参数，构造 extractOptions。
 * @returns {object} extractOptions 对象
 */
export function readKGExtractOptions() {
  const opts = {
    chunkSize: 2500,
    overlap: 200,
    maxTermsPerChunk: 15,
    splitMode: 'heading',
    maxTerms: 40,
    maxHeadings: 30,
    fullExtractEnabled: true,
    fullExtractMaxContextChars: 200000,
    fullExtractTimeoutMs: 300000
  };
  try {
    const chunkCfg = JSON.parse(localStorage.getItem('knowledge-ide-kg-chunks') || 'null');
    if (chunkCfg) {
      if (chunkCfg.chunkSize) opts.chunkSize = chunkCfg.chunkSize;
      if (chunkCfg.overlap != null) opts.overlap = chunkCfg.overlap;
      if (chunkCfg.maxTermsPerChunk) opts.maxTermsPerChunk = chunkCfg.maxTermsPerChunk;
      if (chunkCfg.splitMode) opts.splitMode = chunkCfg.splitMode;
    }
  } catch {
    // ignore
  }
  try {
    const feCfg = JSON.parse(localStorage.getItem('knowledge-ide-kg-full-extract') || 'null');
    if (feCfg) {
      if (feCfg.fullExtractEnabled != null) opts.fullExtractEnabled = feCfg.fullExtractEnabled;
      if (feCfg.fullExtractMaxContextChars != null) opts.fullExtractMaxContextChars = feCfg.fullExtractMaxContextChars;
      if (feCfg.fullExtractTimeoutMs != null) opts.fullExtractTimeoutMs = feCfg.fullExtractTimeoutMs;
      if (feCfg.maxTerms != null) opts.maxTerms = feCfg.maxTerms;
      if (feCfg.maxHeadings != null) opts.maxHeadings = feCfg.maxHeadings;
    }
  } catch {
    // ignore
  }
  return opts;
}
