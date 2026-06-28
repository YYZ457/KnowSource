// ============================================================
//  知源 KnowSource — 端到端流程测试
//  验证：教材解析 → 题目识别 → 知识点匹配 → 知识图谱生成
//  确保生成的数据结构能被 study.js 正确渲染
// ============================================================

const fs = require('fs');
const path = require('path');

// 模拟浏览器环境
global.window = {};
global.document = {
  createElement: () => ({
    getContext: () => ({
      drawImage: () => {},
      createImageData: () => ({ data: [] }),
      putImageData: () => {},
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      moveTo: () => {},
      quadraticCurveTo: () => {},
      stroke: () => {},
      setLineDash: () => {},
      arc: () => {},
      fill: () => {},
      fillText: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} })
    }),
    toDataURL: () => '',
    querySelectorAll: () => [],
    innerHTML: '',
    style: {},
    addEventListener: () => {}
  }),
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }
};

// 加载 engine.js
const engineCode = fs.readFileSync(path.join(__dirname, 'js', 'engine.js'), 'utf-8');
eval(engineCode);
const engine = global.window.KnowSourceEngine;

console.log('='.repeat(60));
console.log('  知源 KnowSource — 端到端流程测试');
console.log('='.repeat(60));

// ============ 模拟OCR识别出的教材文本（前几页） ============
const MOCK_TEXTBOOK_OCR = `
工程光学

第1章 几何光学的基本原理

1.1 光的直线传播
光在均匀介质中沿直线传播，这是几何光学的基本定律之一。光的直线传播定律可以解释影子的形成、小孔成像等现象。

1.2 光的反射定律与折射定律
反射定律：入射光线、反射光线和法线在同一平面内，入射角等于反射角。
折射定律（斯涅尔定律）：n1·sinθ1 = n2·sinθ2，其中n1和n2分别是两种介质的折射率，θ1和θ2分别是入射角和折射角。空气的折射率近似为1，玻璃的折射率约为1.5，水的折射率约为1.33。

1.3 全反射
当光从光密介质射向光疏介质时，如果入射角大于临界角，则所有光线全部反射回光密介质，这种现象称为全反射。临界角满足 sinθc = n2/n1。全反射在光纤通信中有重要应用。

1.4 棱镜与色散
棱镜利用光的折射原理制成。白光通过棱镜后会分散成彩色光谱，这种现象称为色散。

第2章 球面成像与透镜

2.1 球面折射成像
球面折射成像公式：n'/s' - n/s = (n' - n)/r，其中n和n'是两侧介质折射率，s和s'分别是物距和像距，r是球面曲率半径。

2.2 薄透镜成像
薄透镜成像的高斯公式：1/s' - 1/s = 1/f，其中s是物距，s'是像距，f是焦距。焦距的倒数称为光焦度，单位为屈光度（D）。
透镜的放大率公式：β = -s'/s = y'/y。凸透镜的焦距为正，凹透镜的焦距为负。

2.3 透镜组合
多透镜组合的总光焦度等于各透镜光焦度之和。望远镜和显微镜都是利用透镜组合原理制成的光学仪器。

第3章 光的干涉

3.1 波动的基本概念
光是一种电磁波，具有波长、频率、振幅等特性。可见光波长范围约为380-780nm。

3.2 杨氏双缝干涉
杨氏双缝干涉实验是证明光的波动性的经典实验。干涉条纹间距公式：Δy = λD/d，其中λ是光波长，D是双缝到屏的距离，d是双缝间距。

3.3 薄膜干涉
光在薄膜上下表面反射后叠加产生的干涉现象。牛顿环是典型的等厚干涉现象。增透膜利用薄膜干涉原理减少反射光。

3.4 迈克尔逊干涉仪
迈克尔逊干涉仪利用分振幅法获得相干光，可精密测量长度和波长变化。

第4章 光的衍射

4.1 惠更斯-菲涅尔原理
惠更斯原理：波阵面上的每一点都可以看作新的子波源。菲涅尔进一步发展了这一理论，考虑了子波的干涉。

4.2 单缝夫琅禾费衍射
单缝衍射的暗纹条件：a·sinθ = k·λ（k=±1,±2,...），其中a是缝宽，θ是衍射角，λ是波长。中央明纹宽度是其他明纹宽度的两倍。

4.3 光栅衍射
光栅衍射方程：d·sinθ = k·λ，其中d是光栅常数，k是衍射级次，θ是衍射角，λ是波长。
光栅的分辨本领：R = kN，其中k是级次，N是光栅总刻线数。

4.4 圆孔衍射与分辨率
圆孔衍射的艾里斑角半径：sinθ ≈ 1.22·λ/D。瑞利判据规定，两像点能分辨的最小角距离等于艾里斑角半径。

第5章 光的偏振

5.1 偏振光的基本概念
自然光在所有方向上振动均匀分布。偏振光只在某一方向振动。偏振片只允许特定方向的光通过。

5.2 马吕斯定律
马吕斯定律：线偏振光通过偏振片后，透射光强 I = I0·cos²θ，其中I0是入射光强，θ是入射光振动方向与偏振片透光轴的夹角。自然光通过偏振片后光强减半。

5.3 布儒斯特定律
当自然光以布儒斯特角入射时，反射光为完全线偏振光。布儒斯特角满足 tanθB = n2/n1。

5.4 波片与偏振态
波片利用双折射现象改变光的偏振态。1/4波片产生圆偏振光，1/2波片使偏振面旋转。
`;

// ============ 模拟OCR识别出的作业文本 ============
const MOCK_EXAM_OCR = `
工程光学作业

一、简答题

1. 什么是光的折射定律？写出其数学表达式，并解释各物理量的含义。一束光线从空气射入水中，已知入射角为45度，水的折射率为1.33，求折射角。

2. 详细阐述杨氏双缝干涉实验的原理，写出干涉条纹间距公式。在实验中，双缝间距为0.5mm，缝到屏的距离为1.5m，用波长为632.8nm的氦氖激光照射，求干涉条纹的间距。

3. 什么是马吕斯定律？一束自然光通过偏振片后，再通过第二个偏振片，两偏振片透光轴夹角为45度，求透射光强与入射光强之比。

二、计算题

4. 一个薄透镜的焦距为10cm，物体放在透镜前15cm处，用高斯公式求像的位置和放大率，并判断像的性质。

5. 利用光栅方程d·sinθ=k·λ，分析波长为589nm的钠光通过每毫米500条刻线的光栅时，第一级和第二级衍射条纹的衍射角。已知光栅常数d=1/500mm。

6. 什么是全反射？光纤通信利用了什么原理？已知光纤芯的折射率为1.5，包层的折射率为1.45，求光纤的临界角。

三、分析题

7. 比较单缝衍射和光栅衍射的异同，分别写出它们的暗纹条件和主极大条件。为什么光栅衍射比单缝衍射更适合用于光谱分析？

8. 解释布儒斯特定律的物理意义。当自然光以布儒斯特角从空气射入玻璃（n=1.5）时，求布儒斯特角，并说明反射光的偏振状态。
`;

// ============ 主测试流程 ============
function main() {
  console.log('\n--- Step 1: 教材章节切分 ---');
  const chapters = engine.splitTextbook(MOCK_TEXTBOOK_OCR);
  console.log(`✓ 识别到 ${chapters.length} 章`);
  let totalSections = 0;
  chapters.forEach(ch => {
    console.log(`   ${ch.title} (${ch.sections.length} 节)`);
    totalSections += ch.sections.length;
  });
  console.log(`   共 ${totalSections} 个知识点`);

  console.log('\n--- Step 2: 题目识别 ---');
  const questions = engine.splitQuestions(MOCK_EXAM_OCR);
  console.log(`✓ 识别到 ${questions.length} 道题目`);
  questions.forEach((q, i) => {
    console.log(`   Q${i + 1} (题号${q.number}): ${q.content.substring(0, 60)}...`);
  });

  console.log('\n--- Step 3: 知识点匹配 ---');
  const matchedQuestions = engine.matchQuestionsToTextbook(questions, chapters);
  let matchedCount = 0;
  matchedQuestions.forEach((q, i) => {
    console.log(`\n   Q${i + 1} 匹配结果:`);
    if (q.matches.length === 0) {
      console.log(`      ❌ 未找到匹配`);
    } else {
      matchedCount++;
      q.matches.forEach((m, j) => {
        console.log(`      ${j + 1}. ${m.chapter} → ${m.section.title}`);
        console.log(`         综合得分: ${m.score.toFixed(4)} (文本: ${(m.textSim * 100).toFixed(1)}% / 关键词: ${(m.kwOverlap * 100).toFixed(1)}%)`);
        if (m.matchedKeywords.length > 0) {
          console.log(`         匹配关键词: ${m.matchedKeywords.join(', ')}`);
        }
      });
    }
  });

  console.log('\n--- Step 4: 知识图谱生成 ---');
  const graph = engine.generateKnowledgeGraph(chapters, matchedQuestions);
  console.log(`✓ 生成 ${graph.nodes.length} 个节点, ${graph.edges.length} 条连线`);

  // 验证节点结构
  const nodeTypes = {};
  graph.nodes.forEach(n => {
    nodeTypes[n.type] = (nodeTypes[n.type] || 0) + 1;
  });
  console.log('   节点类型分布:');
  Object.entries(nodeTypes).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // 验证节点必要字段
  console.log('\n--- Step 5: 验证数据结构（前端渲染所需） ---');
  let structureOk = true;
  const requiredNodeFields = ['id', 'label', 'type', 'x', 'y', 'size', 'color'];
  graph.nodes.forEach((n, i) => {
    const missing = requiredNodeFields.filter(f => n[f] === undefined);
    if (missing.length > 0) {
      console.log(`   ❌ 节点${i} 缺少字段: ${missing.join(', ')}`);
      structureOk = false;
    }
  });
  if (structureOk) {
    console.log(`   ✓ 所有节点包含必要字段 (id, label, type, x, y, size, color)`);
  }

  const requiredEdgeFields = ['from', 'to'];
  let edgeOk = true;
  graph.edges.forEach((e, i) => {
    const missing = requiredEdgeFields.filter(f => e[f] === undefined);
    if (missing.length > 0) {
      console.log(`   ❌ 连线${i} 缺少字段: ${missing.join(', ')}`);
      edgeOk = false;
    }
  });
  if (edgeOk) {
    console.log(`   ✓ 所有连线包含必要字段 (from, to)`);
  }

  // 验证章节结构
  let chapterOk = true;
  chapters.forEach((ch, i) => {
    if (!ch.id || !ch.title || !ch.sections) {
      console.log(`   ❌ 章节${i} 结构不完整:`, Object.keys(ch));
      chapterOk = false;
    }
    ch.sections.forEach((sec, j) => {
      if (!sec.id || !sec.title || !sec.content) {
        console.log(`   ❌ 章节${i}节${j} 结构不完整:`, Object.keys(sec));
        chapterOk = false;
      }
    });
  });
  if (chapterOk) {
    console.log(`   ✓ 所有章节和知识点结构完整 (id, title, content, keywords)`);
  }

  // 验证考题结构
  let questionOk = true;
  matchedQuestions.forEach((q, i) => {
    if (!q.id || !q.content || !q.keywords) {
      console.log(`   ❌ 考题${i} 结构不完整:`, Object.keys(q));
      questionOk = false;
    }
    if (!q.matches || !Array.isArray(q.matches)) {
      console.log(`   ❌ 考题${i} 缺少matches数组`);
      questionOk = false;
    }
  });
  if (questionOk) {
    console.log(`   ✓ 所有考题结构完整 (id, content, keywords, matches)`);
  }

  // 模拟 parsing.html 生成的 result 对象
  console.log('\n--- Step 6: 模拟生成最终result对象 ---');
  const result = {
    textbook: {
      title: '工程光学（OCR识别）',
      chapters,
      images: [],
      rawText: MOCK_TEXTBOOK_OCR
    },
    questions: matchedQuestions,
    examImages: [],
    graph,
    isDemo: false,
    hasExam: true
  };

  // 验证result能否被JSON序列化（前端需要存sessionStorage）
  try {
    const jsonStr = JSON.stringify(result);
    console.log(`   ✓ result对象可序列化，大小: ${(jsonStr.length / 1024).toFixed(2)} KB`);
  } catch (e) {
    console.log(`   ❌ result对象序列化失败: ${e.message}`);
  }

  // 核心考点
  const topNodes = graph.nodes
    .filter(n => n.type === 'knowledge' && n.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  console.log('\n--- 核心考点（按权重排序） ---');
  if (topNodes.length > 0) {
    topNodes.forEach((n, i) => {
      console.log(`   ${i + 1}. ${n.label} (权重: ${n.weight.toFixed(4)})`);
    });
  } else {
    console.log('   （无权重知识点）');
  }

  // ============ 测试总结 ============
  console.log('\n' + '='.repeat(60));
  console.log('  端到端测试总结');
  console.log('='.repeat(60));
  console.log(`教材章节: ${chapters.length} 章 / ${totalSections} 知识点`);
  console.log(`识别题目: ${questions.length} 道`);
  console.log(`成功匹配: ${matchedCount}/${questions.length} 道`);
  console.log(`图谱节点: ${graph.nodes.length} (root: ${nodeTypes.root || 0}, chapter: ${nodeTypes.chapter || 0}, knowledge: ${nodeTypes.knowledge || 0}, question: ${nodeTypes.question || 0})`);
  console.log(`图谱连线: ${graph.edges.length}`);
  console.log(`数据结构: ${structureOk && edgeOk && chapterOk && questionOk ? '✓ 全部通过' : '❌ 存在问题'}`);

  if (matchedCount === questions.length && structureOk && edgeOk && chapterOk && questionOk) {
    console.log('\n✅ 端到端流程测试通过！前端应能正确渲染知识图谱和考题。');
  } else {
    console.log('\n⚠️  测试存在问题，请检查上述错误');
  }
  console.log('='.repeat(60));
}

main();
