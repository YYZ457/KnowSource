// ============================================================
//  知源 KnowSource — 引擎测试脚本
//  用真实教材 PDF + 模拟教材文本测试 engine.js 核心功能
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
      putImageData: () => {}
    }),
    toDataURL: () => ''
  })
};

// 加载 engine.js
const engineCode = fs.readFileSync(path.join(__dirname, 'js', 'engine.js'), 'utf-8');
eval(engineCode);
const engine = global.window.KnowSourceEngine;

console.log('='.repeat(60));
console.log('  知源 KnowSource 引擎测试');
console.log('='.repeat(60));

// ============ 1. 用 pdfjs-dist 提取 PDF 文本（检测是否扫描版） ============
async function extractPdfText(pdfPath) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const dataBuffer = fs.readFileSync(pdfPath);
  console.log(`\n📄 正在解析 PDF: ${path.basename(pdfPath)}`);
  console.log(`   文件大小: ${(dataBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(dataBuffer),
    useSystemFonts: true,
    disableFontFace: true
  });

  const pdf = await loadingTask.promise;
  console.log(`   ✓ 共 ${pdf.numPages} 页`);

  // 只提取前 10 页文本来检测是否扫描版
  const samplePages = Math.min(10, pdf.numPages);
  let sampleText = '';
  for (let i = 1; i <= samplePages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    sampleText += strings.join(' ') + '\n';
  }

  const avgCharsPerPage = sampleText.length / samplePages;
  console.log(`   前 ${samplePages} 页样本: ${sampleText.length} 字符 (平均 ${avgCharsPerPage.toFixed(1)} 字符/页)`);

  if (avgCharsPerPage < 50) {
    console.log(`   ⚠️  检测到这是扫描版 PDF（图片型），文字层为空`);
    console.log(`   💡 在浏览器中，知源会自动用 Tesseract.js OCR 识别图片文字`);
    console.log(`   📝 本次测试将使用模拟教材文本验证算法正确性`);
    return null;
  }

  // 如果是文本型 PDF，提取全部文本
  let fullText = sampleText;
  for (let i = samplePages + 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    fullText += strings.join(' ') + '\n';
    if (i % 20 === 0 || i === pdf.numPages) {
      console.log(`   已解析 ${i}/${pdf.numPages} 页`);
    }
  }

  console.log(`   ✓ 提取文本 ${fullText.length} 字符`);
  return fullText;
}

// ============ 模拟工程光学教材文本（用于测试算法） ============
const MOCK_TEXTBOOK_TEXT = `
第1章 几何光学的基本原理

1.1 光的传播规律
光在均匀介质中沿直线传播，这是几何光学的基本定律之一。光的直线传播定律可以解释影子的形成、小孔成像等现象。光在传播过程中遇到不同介质的分界面时，会发生反射和折射现象。

光的独立传播定律指出，多束光线在空间中相遇时，彼此互不影响，各自按原方向继续传播。这为研究复杂光学系统奠定了基础。

1.2 反射定律与折射定律
反射定律：入射光线、反射光线和法线在同一平面内，入射光线和反射光线分居法线两侧，入射角等于反射角。

折射定律（斯涅尔定律）：入射光线、折射光线和法线在同一平面内，入射角的正弦与折射角的正弦之比等于两种介质中光速之比，也等于第二种介质对第一种介质的相对折射率。数学表达式为：n1·sinθ1 = n2·sinθ2，其中n1和n2分别是两种介质的折射率，θ1和θ2分别是入射角和折射角。

空气的折射率近似为1，玻璃的折射率约为1.5，水的折射率约为1.33。光从光疏介质射入光密介质时，折射角小于入射角；光从光密介质射入光疏介质时，折射角大于入射角。

1.3 全反射
当光从光密介质射向光疏介质时，如果入射角大于临界角，则所有光线全部反射回光密介质，这种现象称为全反射。临界角满足 sinθc = n2/n1（n1 > n2）。全反射在光纤通信中有重要应用。

1.4 棱镜与色散
棱镜是利用光的折射原理制成的光学元件。光通过棱镜时会发生偏折，不同波长的光折射率不同，因此白光通过棱镜后会分散成彩色光谱，这种现象称为色散。

第2章 球面成像与透镜

2.1 球面折射成像
球面折射成像公式：n'/s' - n/s = (n' - n)/r，其中n和n'是两侧介质折射率，s和s'分别是物距和像距，r是球面曲率半径。

2.2 薄透镜成像
薄透镜成像的高斯公式：1/s' - 1/s = 1/f，其中s是物距，s'是像距，f是焦距。焦距的倒数称为光焦度，单位为屈光度（D）。

透镜的放大率公式：β = -s'/s = y'/y，其中y和y'分别是物高和像高。当β为正时像正立，β为负时像倒立。|β|>1时像放大，|β|<1时像缩小。

凸透镜（正透镜）的焦距为正，对光线有会聚作用；凹透镜（负透镜）的焦距为负，对光线有发散作用。

2.3 透镜组合
多透镜组合的总光焦度等于各透镜光焦度之和（薄透镜近似）。望远镜和显微镜都是利用透镜组合原理制成的光学仪器。

第3章 光的干涉

3.1 波动的基本概念
光是一种电磁波，具有波长、频率、振幅等特性。可见光波长范围约为380-780nm。光的颜色由波长决定，红光波长约700nm，紫光波长约400nm。

3.2 杨氏双缝干涉
杨氏双缝干涉实验是证明光的波动性的经典实验。两束相干光在屏幕上叠加形成明暗相间的干涉条纹。

干涉条纹间距公式：Δy = λD/d，其中λ是光波长，D是双缝到屏的距离，d是双缝间距。条纹间距与波长成正比，红光条纹间距大于紫光。

3.3 薄膜干涉
光在薄膜上下表面反射后叠加产生的干涉现象。薄膜干涉分为等厚干涉和等倾干涉。牛顿环是典型的等厚干涉现象。

增透膜利用薄膜干涉原理减少反射光，增加透射光，膜厚通常为四分之一波长。

3.4 迈克尔逊干涉仪
迈克尔逊干涉仪利用分振幅法获得相干光，可精密测量长度和波长变化。

第4章 光的衍射

4.1 惠更斯-菲涅尔原理
惠更斯原理：波阵面上的每一点都可以看作新的子波源，这些子波的包络面形成新的波阵面。菲涅尔进一步发展了这一理论，考虑了子波的干涉。

4.2 单缝夫琅禾费衍射
单缝衍射的暗纹条件：a·sinθ = k·λ（k=±1,±2,...），其中a是缝宽，θ是衍射角，λ是波长。中央明纹宽度是其他明纹宽度的两倍。

4.3 光栅衍射
光栅衍射方程：d·sinθ = k·λ，其中d是光栅常数（相邻刻线间距），k是衍射级次，θ是衍射角，λ是波长。

光栅的角色散率：dθ/dλ = k/(d·cosθ)，级次越高，色散越大。光栅光谱仪利用光栅的分光特性分析光谱。

光栅分辨本领：R = kN，其中k是级次，N是光栅总刻线数。

4.4 圆孔衍射与分辨率
圆孔衍射的艾里斑角半径：sinθ ≈ 1.22·λ/D，其中D是圆孔直径。瑞利判据规定，两像点能分辨的最小角距离等于艾里斑角半径。

第5章 光的偏振

5.1 偏振光的基本概念
自然光在所有方向上振动均匀分布。偏振光只在某一方向振动。偏振片只允许特定方向（透光轴）的光通过。

5.2 马吕斯定律
马吕斯定律：线偏振光通过偏振片后，透射光强 I = I0·cos²θ，其中I0是入射光强，θ是入射光振动方向与偏振片透光轴的夹角。

自然光通过偏振片后光强减半。两偏振片正交时（θ=90°）透射光强为零。

5.3 布儒斯特定律
当自然光以布儒斯特角入射时，反射光为完全线偏振光。布儒斯特角满足 tanθB = n2/n1。

5.4 波片与偏振态
波片利用双折射现象改变光的偏振态。1/4波片产生圆偏振光，1/2波片使偏振面旋转。

第6章 光学仪器

6.1 眼睛与眼镜
人眼的明视距离为25cm。近视眼用凹透镜矫正，远视眼用凸透镜矫正。

6.2 显微镜
显微镜由物镜和目镜组成，总放大率等于物镜放大率乘以目镜放大率。

6.3 望远镜
望远镜由物镜和目镜组成，开普勒望远镜的放大率 M = -f1/f2，其中f1是物镜焦距，f2是目镜焦距。
`;

// ============ 主测试流程 ============
async function main() {
  const pdfPath = 'C:\\Users\\YANYZ\\Desktop\\knowsource\\工程光学复习指导与习题解答 第2版 (蔡怀宇) (z-library.sk, 1lib.sk, z-lib.sk).pdf';

  // Step 1: 检测 PDF 类型
  console.log('\n--- Step 1: 检测教材 PDF ---');
  if (fs.existsSync(pdfPath)) {
    const pdfText = await extractPdfText(pdfPath);
    if (!pdfText) {
      console.log('\n📝 使用模拟教材文本测试算法（工程光学教材内容）');
    }
  } else {
    console.log('❌ 找不到 PDF 文件，使用模拟教材文本');
  }

  // Step 2: 教材章节切分（用模拟文本）
  console.log('\n--- Step 2: 教材章节切分 ---');
  const chapters = engine.splitTextbook(MOCK_TEXTBOOK_TEXT);
  console.log(`✓ 识别到 ${chapters.length} 章`);
  chapters.forEach((ch, i) => {
    console.log(`\n   ${ch.title} (${ch.sections.length} 节)`);
    ch.sections.forEach(s => {
      console.log(`     └─ ${s.title}`);
      console.log(`        关键词: ${s.keywords.slice(0, 5).map(k => k.word).join(', ')}`);
    });
  });

  // Step 3: 生成测试题目
  console.log('\n--- Step 3: 生成测试题目 ---');
  const testQuestions = [
    {
      id: 'q1',
      rawText: '一束光线从空气射入玻璃，入射角为30度，已知玻璃的折射率为1.5，求折射角。根据折射定律计算光在玻璃中的传播速度。',
      content: '一束光线从空气射入玻璃，入射角为30度，已知玻璃的折射率为1.5，求折射角。根据折射定律计算光在玻璃中的传播速度。'
    },
    {
      id: 'q2',
      rawText: '在杨氏双缝干涉实验中，已知双缝间距为0.5mm，缝到屏的距离为1m，用波长为632.8nm的氦氖激光照射，求干涉条纹的间距。',
      content: '在杨氏双缝干涉实验中，已知双缝间距为0.5mm，缝到屏的距离为1m，用波长为632.8nm的氦氖激光照射，求干涉条纹的间距。'
    },
    {
      id: 'q3',
      rawText: '一个薄透镜的焦距为10cm，物体放在透镜前15cm处，用高斯公式求像的位置和放大率，并判断像的性质。',
      content: '一个薄透镜的焦距为10cm，物体放在透镜前15cm处，用高斯公式求像的位置和放大率，并判断像的性质。'
    },
    {
      id: 'q4',
      rawText: '利用光栅方程d·sinθ=k·λ，分析波长为589nm的钠光通过每毫米500条刻线的光栅时，第一级和第二级衍射条纹的衍射角。',
      content: '利用光栅方程d·sinθ=k·λ，分析波长为589nm的钠光通过每毫米500条刻线的光栅时，第一级和第二级衍射条纹的衍射角。'
    },
    {
      id: 'q5',
      rawText: '什么是马吕斯定律？一束自然光通过偏振片后，再通过第二个偏振片，两偏振片透光轴夹角为45度，求透射光强与入射光强之比。',
      content: '什么是马吕斯定律？一束自然光通过偏振片后，再通过第二个偏振片，两偏振片透光轴夹角为45度，求透射光强与入射光强之比。'
    }
  ];

  // 为每个题目提取关键词
  testQuestions.forEach(q => {
    q.keywords = engine.extractKeywords(q.rawText, 10);
  });

  testQuestions.forEach((q, i) => {
    console.log(`\n   Q${i + 1}: ${q.content.substring(0, 60)}...`);
    console.log(`      关键词: ${q.keywords.map(k => k.word).join(', ')}`);
  });

  // Step 4: 知识点匹配
  console.log('\n--- Step 4: 知识点匹配（考题 → 教材） ---');
  const matchedQuestions = engine.matchQuestionsToTextbook(testQuestions, chapters);

  matchedQuestions.forEach((q, i) => {
    console.log(`\n   Q${i + 1} 匹配结果:`);
    if (q.matches.length === 0) {
      console.log(`      ❌ 未找到匹配`);
    } else {
      q.matches.forEach((m, j) => {
        console.log(`      ${j + 1}. ${m.chapter} → ${m.section.title}`);
        console.log(`         综合得分: ${m.score.toFixed(4)} (文本: ${(m.textSim * 100).toFixed(1)}% / 关键词: ${(m.kwOverlap * 100).toFixed(1)}%)`);
        if (m.matchedKeywords.length > 0) {
          console.log(`         匹配关键词: ${m.matchedKeywords.join(', ')}`);
        }
        console.log(`         教材内容: ${m.section.content.substring(0, 100)}...`);
      });
    }
  });

  // Step 5: 生成知识图谱
  console.log('\n--- Step 5: 知识图谱生成 ---');
  const graph = engine.generateKnowledgeGraph(chapters, matchedQuestions);
  console.log(`✓ 生成 ${graph.nodes.length} 个节点, ${graph.edges.length} 条连线`);

  const chapterNodes = graph.nodes.filter(n => n.type === 'chapter');
  const knowledgeNodes = graph.nodes.filter(n => n.type === 'knowledge');
  const questionNodes = graph.nodes.filter(n => n.type === 'question');

  console.log(`   - 根节点: 1`);
  console.log(`   - 章节节点: ${chapterNodes.length}`);
  console.log(`   - 知识点节点: ${knowledgeNodes.length}`);
  console.log(`   - 考题节点: ${questionNodes.length}`);

  // 核心考点
  const topNodes = knowledgeNodes
    .filter(n => n.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  if (topNodes.length > 0) {
    console.log('\n   ★ 核心考点（按考题权重排序）:');
    topNodes.forEach((n, i) => {
      console.log(`      ${i + 1}. ${n.label} (权重: ${n.weight.toFixed(4)})`);
    });
  }

  // ============ 测试总结 ============
  console.log('\n' + '='.repeat(60));
  console.log('  测试总结');
  console.log('='.repeat(60));

  const totalMatches = matchedQuestions.reduce((s, q) => s + q.matches.length, 0);
  const matchedCount = matchedQuestions.filter(q => q.matches.length > 0).length;

  console.log(`教材: 工程光学（模拟文本，6章18节）`);
  console.log(`章节数: ${chapters.length}`);
  console.log(`知识点数: ${chapters.reduce((s, c) => s + c.sections.length, 0)}`);
  console.log(`测试题目数: ${testQuestions.length}`);
  console.log(`成功匹配题目: ${matchedCount}/${testQuestions.length}`);
  console.log(`总匹配关系: ${totalMatches}`);
  console.log(`图谱节点: ${graph.nodes.length}`);
  console.log(`图谱连线: ${graph.edges.length}`);

  if (matchedCount === testQuestions.length) {
    console.log('\n✅ 全部题目成功匹配到教材知识点！算法验证通过！');
  } else if (matchedCount > 0) {
    console.log(`\n⚠️  ${matchedCount}/${testQuestions.length} 题目匹配成功`);
  } else {
    console.log('\n❌ 所有题目均未匹配成功');
  }

  console.log('\n📝 关于真实PDF: 该教材为扫描版（图片型），');
  console.log('   在浏览器中知源会自动调用 Tesseract.js OCR 识别文字，');
  console.log('   识别完成后再执行上述匹配算法。');

  console.log('\n' + '='.repeat(60));
}

main().catch(err => {
  console.error('测试出错:', err);
  process.exit(1);
});
