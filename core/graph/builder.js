// ============================================================
// @module core/graph/builder
// 职责：从章节与匹配结果构建知识图谱（旧版 nodes/edges 数组结构）
// 备注：阶段3将升级为新的 Node/Edge 类模型，此处暂保留原实现
// 依赖方向：只能被上层（core/services / core/pipeline）调用，不可反向依赖
// 公开 API: generateKnowledgeGraph
// ============================================================

// ============ 9. 动态知识图谱生成 ============
function generateKnowledgeGraph(chapters, matchedQuestions) {
  const nodes = [];
  const edges = [];

  // 根节点
  nodes.push({
    id: 'root',
    label: '知识体系',
    type: 'root',
    x: 0, y: 0,
    size: 40,
    color: '#ffffff',
    weight: 0
  });

  // 统计每个知识点的考题权重
  const sectionWeights = new Map();
  for (const q of matchedQuestions) {
    for (const m of q.matches) {
      const key = m.section.id;
      sectionWeights.set(key, (sectionWeights.get(key) || 0) + m.score);
    }
  }

  // 章节节点
  const chapterColors = ['#00eaff', '#a855f7', '#ffb84d', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#a3e635'];
  chapters.forEach((ch, i) => {
    const angle = (i / chapters.length) * Math.PI * 2 - Math.PI / 2;
    const radius = 280;
    nodes.push({
      id: ch.id,
      label: ch.title.replace(/^第\d+章\s*/, ''),
      type: 'chapter',
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: 24,
      color: chapterColors[i % chapterColors.length],
      weight: 0
    });
    edges.push({ from: 'root', to: ch.id, type: 'related', weight: 1 });

    // 知识点节点
    ch.sections.forEach((sec, j) => {
      const secAngle = angle + (j - (ch.sections.length - 1) / 2) * 0.3;
      const secRadius = 450;
      const weight = sectionWeights.get(sec.id) || 0;

      nodes.push({
        id: sec.id,
        label: sec.title.replace(/^\d+\.\d+\s*/, ''),
        type: 'knowledge',
        x: Math.cos(secAngle) * secRadius,
        y: Math.sin(secAngle) * secRadius,
        size: 12 + Math.min(20, weight * 40), // 权重越大节点越大
        color: chapterColors[i % chapterColors.length],
        weight: weight,
        keywords: sec.keywords.map(k => k.word)
      });
      edges.push({ from: ch.id, to: sec.id, type: 'related', weight: 1 });
    });
  });

  // 预构建 Map<id, node> 索引，避免线性查找
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // 考题节点（连接到最匹配的知识点）
  matchedQuestions.forEach((q, i) => {
    if (q.matches.length === 0) return;
    const topMatch = q.matches[0];
    const targetNode = nodeMap.get(topMatch.section.id);
    if (!targetNode) return;

    // 考题节点放在知识点附近
    const angle = (i / matchedQuestions.length) * Math.PI * 2;
    const qRadius = 580;
    nodes.push({
      id: q.id,
      label: `Q${i + 1}`,
      type: 'question',
      x: targetNode.x + Math.cos(angle) * 80,
      y: targetNode.y + Math.sin(angle) * 80,
      size: 10,
      color: '#ff6b6b',
      weight: 1,
      question: q.content
    });
    edges.push({ from: topMatch.section.id, to: q.id, type: 'related', weight: 1 });
  });

  // 跨章节关联（基于关键词 Jaccard 相似度）
  const knowledgeNodes = nodes.filter(n => n.type === 'knowledge');
  for (let i = 0; i < knowledgeNodes.length; i++) {
    for (let j = i + 1; j < knowledgeNodes.length; j++) {
      const n1 = knowledgeNodes[i];
      const n2 = knowledgeNodes[j];
      if (n1.keywords && n2.keywords) {
        const set1 = new Set(n1.keywords.map(k => k.word || k));
        const set2 = new Set(n2.keywords.map(k => k.word || k));
        const intersection = [...set1].filter(k => set2.has(k));
        const union = new Set([...set1, ...set2]);
        // 使用 Jaccard 相似度 > 0.3 作为阈值
        const jaccard = union.size > 0 ? intersection.length / union.size : 0;
        if (jaccard > 0.3) {
          edges.push({ from: n1.id, to: n2.id, type: 'related', weight: 1 });
        }
      }
    }
  }

  return { nodes, edges };
}

export { generateKnowledgeGraph };
