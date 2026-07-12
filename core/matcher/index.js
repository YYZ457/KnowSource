// ============================================================
// @module core/matcher
// 职责：四层匹配（关键词 Jaccard + TF-IDF + 语义 embedding + 图结构 PPR）+ 混合编排
// 依赖：core/extractor （tokenize / extractKeywords）
// 依赖方向：只能被上层（core/services / core/pipeline）调用，不可反向依赖
// 公开 API: textSimilarity, keywordOverlap, matchQuestionsToTextbook（向后兼容）
//           match, jaccardSimilarity, weightedKeywordOverlap,
//           computeTfIdf, queryToVector, cosineSimilarity,
//           semanticSimilarity, commonNeighbors, personalizedPageRank, graphMatchScore
// ============================================================

import { tokenize, extractKeywords } from '../extractor/index.js';
import { computeTfIdf, queryToVector, cosineSimilarity } from './tfidf.js';
import { jaccardSimilarity, weightedKeywordOverlap } from './keyword.js';
import { semanticSimilarity, getEmbedding } from './semantic.js';
import { graphMatchScore, personalizedPageRank } from './graph-match.js';
import { searchByContent } from '../graph/query.js';

// ============ 5. 文本相似度计算（Jaccard + Dice + 包含关系） ============
function textSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1.0;

  // 包含关系：一个文本包含另一个（如"随机变量"包含"随机"）
  if (text1.length >= 2 && text2.length >= 2) {
    if (text1.includes(text2) || text2.includes(text1)) {
      const shorter = Math.min(text1.length, text2.length);
      const longer = Math.max(text1.length, text2.length);
      return 0.5 + 0.5 * (shorter / longer);
    }
  }

  const tokens1 = new Set(tokenize(text1));
  const tokens2 = new Set(tokenize(text2));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Jaccard相似度
  const intersection = [...tokens1].filter(t => tokens2.has(t));
  const union = new Set([...tokens1, ...tokens2]);
  const jaccard = union.size === 0 ? 0 : intersection.length / union.size;

  // Dice系数（对长度差异大的文本更友好）
  const dice = (2 * intersection.length) / (tokens1.size + tokens2.size);

  // 字符重叠率（不依赖分词，直接比较字符）
  const chars1 = new Set(text1.replace(/\s/g, ''));
  const chars2 = new Set(text2.replace(/\s/g, ''));
  const charIntersection = [...chars1].filter(c => chars2.has(c));
  const charUnion = new Set([...chars1, ...chars2]);
  const charJaccard = charUnion.size === 0 ? 0 : charIntersection.length / charUnion.size;

  // 取三者最大值，让部分重叠的相关术语更容易达到阈值
  return Math.max(jaccard, dice, charJaccard);
}

// 关键词重叠度（加权）
function keywordOverlap(keywords1, keywords2) {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;

  const map1 = new Map(keywords1.map(k => [k.word, k.count]));
  const map2 = new Map(keywords2.map(k => [k.word, k.count]));

  let overlapScore = 0;
  let totalScore = 0;

  for (const [word, count] of map1) {
    totalScore += count;
    if (map2.has(word)) {
      overlapScore += Math.min(count, map2.get(word));
    }
  }

  return totalScore > 0 ? overlapScore / totalScore : 0;
}

// ============ 8. 考题-教材知识点匹配 ============
function matchQuestionsToTextbook(questions, chapters) {
  const results = [];

  for (const q of questions) {
    const matches = [];

    for (const ch of chapters) {
      for (const sec of ch.sections) {
        // 计算相似度
        const textSim = textSimilarity(q.rawText, sec.content);
        const kwOverlap = keywordOverlap(q.keywords, sec.keywords);
        const totalScore = textSim * 0.4 + kwOverlap * 0.6;

        if (totalScore > 0.05 || kwOverlap > 0.1) {
          matches.push({
            chapter: ch.title,
            section: sec,
            score: totalScore,
            textSim,
            kwOverlap,
            matchedKeywords: q.keywords
              .filter(k => sec.keywords.some(sk => sk.word === k.word))
              .map(k => k.word)
          });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    results.push({
      ...q,
      matches: matches.slice(0, 3) // 取前3个最匹配的
    });
  }

  return results;
}

// ============ 阶段4：四层混合匹配编排 ============

/**
 * 混合匹配（四层：关键词 Jaccard + TF-IDF + 语义 embedding + 图结构 PPR）
 * @param {string} query — 查询文本
 * @param {{strategy?:'keyword'|'tfidf'|'semantic'|'graph'|'hybrid', documents?:Object[], graph?:Object, embedFn?:function, weights?:Object}} options
 * @returns {Promise<import('../types.js').MatchResult[]>}
 */
export async function match(query, options = {}) {
  const strategy = options.strategy || 'hybrid';
  const documents = options.documents || [];
  const graph = options.graph;
  const embedFn = options.embedFn || (async () => []);
  // 四层默认权重（总和 = 1.0）。兼容旧版仅传 tfidf/semantic/graph 的权重对象：
  // 缺失的层权重默认为 0，不影响已有行为。
  // 修复：空对象 {} 是 truthy，会导致所有权重为 0、结果为空。需检查 keys 长度。
  const rawWeights = (options.weights && Object.keys(options.weights).length > 0)
    ? options.weights
    : { keyword: 0.2, tfidf: 0.3, semantic: 0.3, graph: 0.2 };
  const weights = {
    keyword: rawWeights.keyword ?? 0,
    tfidf: rawWeights.tfidf ?? 0,
    semantic: rawWeights.semantic ?? 0,
    graph: rawWeights.graph ?? 0
  };
  // 归一化权重，确保总和为 1.0（避免用户传入非归一化权重导致分数超出 [0,1]）
  const weightSum = weights.keyword + weights.tfidf + weights.semantic + weights.graph;
  if (weightSum > 0 && Math.abs(weightSum - 1) > 0.001) {
    weights.keyword /= weightSum;
    weights.tfidf /= weightSum;
    weights.semantic /= weightSum;
    weights.graph /= weightSum;
  }

  const results = [];

  // 预计算查询关键词
  const queryKeywords = extractKeywords(query, 10);

  // TF-IDF 预计算（如果需要）
  // 修复：原代码按文档级计算 TF-IDF，导致同一文档内所有 section 得分相同。
  // 改为按 section 级计算，使 section 间排序有意义。
  let tfidfData = null;
  let queryVec = null;
  let sectionIndexMap = null; // Map<docIdx_sectionId, vectorIdx>
  if (strategy === 'tfidf' || strategy === 'hybrid') {
    const sectionTexts = [];
    sectionIndexMap = new Map();
    for (let di = 0; di < documents.length; di++) {
      const doc = documents[di];
      const sections = doc.sections && doc.sections.length > 0
        ? doc.sections
        : [{ id: 'full', content: doc.rawText || '' }];
      for (const sec of sections) {
        const key = `${di}_${sec.id}`;
        sectionIndexMap.set(key, sectionTexts.length);
        sectionTexts.push(sec.content || '');
      }
    }
    // 用 section 文本计算 IDF（不包含 query，避免 query 污染 IDF）
    tfidfData = computeTfIdf(sectionTexts);
    // 再用已有 IDF 将 query 转向量
    queryVec = queryToVector(query, tfidfData.idf);
  }

  // 图结构预计算：在循环外执行一次，避免对每个 section 重复搜索和 PPR 迭代
  let matchedQueryNodeId = null;
  let pprScores = null;
  let graphNodeList = null;
  let sectionNodeIndex = null; // 预建索引，O(1) 查找
  if ((strategy === 'graph' || strategy === 'hybrid') && graph) {
    try {
      // searchByContent 只需执行一次，找到与查询最相关的节点
      const matchedNodes = searchByContent(graph, query, { limit: 1 });
      if (matchedNodes.length > 0) {
        matchedQueryNodeId = matchedNodes[0].id;
        // PPR 只需从查询节点执行一次，后续所有候选节点复用该分数
        pprScores = personalizedPageRank(graph, matchedQueryNodeId, { iterations: 10 });
      }
      // 预取节点列表，兼容 Map / Array / Object 三种结构
      graphNodeList = Array.isArray(graph.nodes)
        ? graph.nodes
        : (graph.nodes instanceof Map ? Array.from(graph.nodes.values()) : Object.values(graph.nodes));
      // 修复：预建 section → graphNode 的索引，避免循环内 O(n) find
      sectionNodeIndex = new Map();
      for (const n of graphNodeList) {
        if (n.source?.docId && n.source?.sectionId) {
          const key = `${n.source.docId}_${n.source.sectionId}`;
          if (!sectionNodeIndex.has(key)) sectionNodeIndex.set(key, n);
        }
      }
    } catch (e) {
      // 图查询初始化失败时降级为 0 分，不影响其他层
      console.warn('[matcher] 图结构预计算失败，图层级降级为 0:', e.message);
    }
  }

  // 预计算查询 embedding（语义层复用，避免重复网络请求）
  let queryEmbedding = null;
  if (strategy === 'semantic' || strategy === 'hybrid') {
    try {
      queryEmbedding = await getEmbedding(query, embedFn);
    } catch (e) {
      // embedding provider 不可用时降级为 0 分
      console.warn('[matcher] 查询 embedding 计算失败，语义层降级为 0:', e.message);
    }
  }

  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const doc = documents[docIdx];
    const sections = (doc.sections && doc.sections.length > 0)
      ? doc.sections
      : [{ id: 'full', content: doc.rawText || '', keywords: [] }];
    for (const section of sections) {
      const result = {
        docId: doc.meta?.docId || doc.docId || '',
        docName: doc.meta?.docName || doc.name || '',
        sectionId: section.id,
        sectionTitle: section.title || '',
        score: 0,
        breakdown: {}
      };

      // ---- 第 1 层：关键词（Jaccard 相似度）----
      if (strategy === 'keyword' || strategy === 'hybrid') {
        const sectionText = section.content || '';
        result.breakdown.keyword = jaccardSimilarity(query, sectionText);
      }

      // ---- 第 2 层：TF-IDF（余弦相似度）----
      // 修复：使用 section 级 TF-IDF 向量，而非文档级
      if (strategy === 'tfidf' || strategy === 'hybrid') {
        const sectionKey = `${docIdx}_${section.id}`;
        const vecIdx = sectionIndexMap?.get(sectionKey);
        if (tfidfData && vecIdx !== undefined && vecIdx < tfidfData.vectors.length) {
          result.breakdown.tfidf = cosineSimilarity(queryVec, tfidfData.vectors[vecIdx]);
        } else {
          result.breakdown.tfidf = 0;
        }
      }

      // ---- 第 3 层：语义（embedding 余弦相似度）----
      if (strategy === 'semantic' || strategy === 'hybrid') {
        try {
          if (queryEmbedding) {
            // 复用查询 embedding，只需计算 section 的 embedding
            const sectionEmbedding = await getEmbedding(section.content || '', embedFn);
            // 修复：维度不一致时直接归零，避免得到错误的偏低相似度
            if (!Array.isArray(sectionEmbedding) || sectionEmbedding.length !== queryEmbedding.length) {
              console.warn('[matcher] embedding 维度不匹配: query=' + queryEmbedding.length + ', section=' + (sectionEmbedding?.length || 'N/A'));
              result.breakdown.semantic = 0;
            } else {
              const m1 = new Map(queryEmbedding.map((v, i) => [String(i), v]));
              const m2 = new Map(sectionEmbedding.map((v, i) => [String(i), v]));
              result.breakdown.semantic = cosineSimilarity(m1, m2);
            }
          } else {
            result.breakdown.semantic = 0;
          }
        } catch (e) {
          result.breakdown.semantic = 0;
        }
      }

      // ---- 第 4 层：图结构（共同邻居 + PPR）----
      if (strategy === 'graph' || strategy === 'hybrid') {
        try {
          if (graph && matchedQueryNodeId && graphNodeList) {
            // 修复：O(1) 索引查找，替代 O(n) find
            const sectionKey = `${result.docId}_${section.id}`;
            let sectionNode = sectionNodeIndex?.get(sectionKey);
            // 兜底：索引未命中时回退到线性查找（兼容 heading/id 匹配）
            if (!sectionNode) {
              sectionNode = graphNodeList.find(n =>
                n.source?.docId === result.docId && (
                  n.source?.sectionId === section.id ||
                  (section.title && n.source?.heading === section.title) ||
                  n.id === section.id
                )
              );
            }
            if (sectionNode) {
              result.breakdown.graph = graphMatchScore(graph, matchedQueryNodeId, sectionNode.id, pprScores);
            } else {
              result.breakdown.graph = 0;
            }
          } else {
            result.breakdown.graph = 0;
          }
        } catch (e) {
          // 图结构计算失败时降级为 0，不影响其他层
          result.breakdown.graph = 0;
        }
      }

      // 计算总分
      if (strategy === 'hybrid') {
        result.score = (result.breakdown.keyword || 0) * weights.keyword
                     + (result.breakdown.tfidf || 0) * weights.tfidf
                     + (result.breakdown.semantic || 0) * weights.semantic
                     + (result.breakdown.graph || 0) * weights.graph;
      } else if (strategy === 'keyword') {
        result.score = result.breakdown.keyword || 0;
      } else if (strategy === 'tfidf') {
        result.score = result.breakdown.tfidf || 0;
      } else if (strategy === 'semantic') {
        result.score = result.breakdown.semantic || 0;
      } else if (strategy === 'graph') {
        result.score = result.breakdown.graph || 0;
      }

      // 命中关键词
      if (section.keywords) {
        result.matchedKeywords = queryKeywords
          .filter(qk => section.keywords.some(sk => sk.word === qk.word))
          .map(k => k.word);
      }

      if (result.score > 0) {
        results.push(result);
      }
    }
  }

  // 按分数降序
  results.sort((a, b) => b.score - a.score);
  return results;
}

export { textSimilarity, keywordOverlap, matchQuestionsToTextbook };
export { jaccardSimilarity, weightedKeywordOverlap };
export { computeTfIdf, queryToVector, cosineSimilarity } from './tfidf.js';
export { semanticSimilarity } from './semantic.js';
export { commonNeighbors, personalizedPageRank, graphMatchScore } from './graph-match.js';
