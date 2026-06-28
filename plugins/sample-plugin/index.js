/** @module plugins/sample-plugin
 *  职责：示例插件 — 自定义解析器（统计字数）+ 自定义抽取器（标记长词）
 */
export default {
  name: 'sample-plugin',
  version: '1.0.0',
  description: '示例插件：统计字数 + 标记长词',

  hooks: {
    // 自定义解析器：在解析后追加字数统计
    parser: async (doc) => {
      if (!doc) return doc;
      doc.meta = doc.meta || {};
      doc.meta.charCount = (doc.rawText || '').length;
      doc.meta.wordCount = (doc.rawText || '').split(/\s+/).filter(Boolean).length;
      return doc;
    },

    // 自定义抽取器：标记长度 > 4 的词
    extractor: async (entities) => {
      if (!Array.isArray(entities)) return entities;
      for (const e of entities) {
        if (e.term && e.term.length > 4) {
          e.meta = e.meta || {};
          e.meta.longTerm = true;
        }
      }
      return entities;
    }
  }
};
