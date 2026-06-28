// ============================================================
//  测试新的无监督知识图谱生成引擎
//  验证：TextRank + 共现 + PageRank + 社区发现
// ============================================================
const fs = require('fs');
const path = require('path');

// 加载 kg-engine.js
const kgCode = fs.readFileSync(path.join(__dirname, 'js', 'kg-engine.js'), 'utf-8');
// 模拟浏览器环境
global.window = {};
eval(kgCode);
const KGEngine = global.window.KGEngine;

console.log('='.repeat(60));
console.log('测试1: 工程光学教材文本（模拟OCR结果）');
console.log('='.repeat(60));

// 模拟工程光学教材文本（包含多个章节的真实内容）
const opticsTextbook = `
第一章 几何光学基本原理

光的直线传播定律：光在均匀介质中沿直线传播。这是几何光学的基础定律之一。
光的独立传播定律：多束光在空间相遇时，彼此独立传播，互不干扰。
光的反射定律：入射光线、反射光线和法线在同一平面内，入射角等于反射角。
反射定律的数学表达式：入射角i等于反射角i'，即 i = i'。
光的折射定律：光从一种介质进入另一种介质时，光线发生偏折。
折射定律也称为斯涅尔定律，其数学表达式为 n1 sin θ1 = n2 sin θ2。
其中n1和n2分别是两种介质的折射率，θ1是入射角，θ2是折射角。
折射率是描述介质光学性质的重要参数，真空的折射率为1。
光在介质中的传播速度 v = c/n，其中c是真空中光速。

全反射：当光从光密介质射向光疏介质，且入射角大于临界角时，光线全部反射回光密介质。
全反射现象是光纤通信的基础。光纤利用全反射原理传输光信号。
临界角的计算公式：sin θc = n2/n1，其中n1 > n2。

第二章 球面系统与透镜

球面折射：光线在球面分界面上的折射遵循折射定律。
近轴条件下，球面折射成像公式为 n'/s' - n/s = (n' - n)/r。
其中s是物距，s'是像距，r是球面曲率半径。
焦距是光学系统的重要参数，描述了光学系统的聚焦能力。
薄透镜成像公式：1/s + 1/s' = 1/f，其中f是透镜焦距。
透镜的焦距与折射率和曲率半径有关：1/f = (n-1)(1/r1 - 1/r2)。
凸透镜对光有会聚作用，凹透镜对光有发散作用。
透镜组合：多个透镜组合可以构成复杂的光学系统，如显微镜、望远镜。

第三章 光的干涉

光的干涉现象：两束或多束相干光波叠加时，光强重新分布的现象。
杨氏双缝干涉实验是证明光波动性的经典实验。
双缝干涉条纹间距公式：Δy = λD/d，其中λ是波长，D是缝到屏的距离，d是双缝间距。
相干条件：频率相同、振动方向相同、相位差恒定。
薄膜干涉：光在薄膜上下表面反射后叠加产生的干涉现象。
薄膜干涉公式：2nd = kλ，其中n是薄膜折射率，d是薄膜厚度。
迈克尔逊干涉仪利用分振幅法产生双光束干涉。
干涉现象在精密测量中有重要应用，如测量波长、检测表面平整度。

第四章 光的衍射

光的衍射：光绕过障碍物传播的现象，是光波动性的体现。
惠更斯-菲涅尔原理：波阵面上每一点都是新的子波源。
单缝衍射：光通过单缝后形成衍射条纹。
单缝衍射暗纹条件：a sin θ = kλ，其中a是缝宽。
圆孔衍射：光通过圆孔形成爱里斑。
爱里斑角半径：sin θ ≈ 1.22 λ/D，其中D是孔径。
光栅衍射：多缝干涉形成的光栅光谱。
光栅方程：d sin θ = kλ，其中d是光栅常数。
衍射现象限制了光学仪器的分辨率。
瑞利判据：两个点光源刚好能被分辨的最小角距离。

第五章 光的偏振

光的偏振：光波电矢量的振动方向相对于传播方向的不对称性。
自然光：电矢量在垂直于传播方向的平面内随机振动。
线偏振光：电矢量只在一个方向振动。
偏振片：能够产生偏振光的器件，利用二向色性原理。
马吕斯定律：线偏振光通过偏振片后，光强 I = I0 cos²θ。
其中I0是入射光强，θ是偏振方向与偏振片透光轴的夹角。
布儒斯特定律：当入射角等于布儒斯特角时，反射光是完全偏振光。
布儒斯特角公式：tan θB = n2/n1。
偏振光在液晶显示、3D电影、应力检测等领域有广泛应用。
`;

const examQuestions = [
  '光的折射定律是什么？写出其数学表达式，并解释各物理量的含义。',
  '什么是全反射现象？计算从玻璃（n=1.5）到空气的临界角。',
  '杨氏双缝干涉实验中，已知双缝间距0.5mm，缝到屏距离1m，波长632.8nm，求条纹间距。',
  '简述马吕斯定律的内容及其数学表达式。',
  '什么是布儒斯特角？当光从空气射向玻璃（n=1.5）时，布儒斯特角是多少？'
];

console.log('教材字数:', opticsTextbook.length);
console.log('考题数:', examQuestions.length);
console.log();

// 生成知识图谱
console.log('正在生成知识图谱...');
const startTime = Date.now();
const graph = KGEngine.buildKnowledgeGraph(opticsTextbook, examQuestions);
const elapsed = Date.now() - startTime;

console.log('生成耗时:', elapsed, 'ms');
console.log();
console.log('=== 图谱统计 ===');
console.log(JSON.stringify(graph.stats, null, 2));
console.log();

// 输出实体节点
console.log('=== 实体节点 (Top 20 by PageRank) ===');
const entities = graph.nodes.filter(n => n.type === 'entity')
  .sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0));
entities.slice(0, 20).forEach((n, i) => {
  const hub = n.isHub ? ' [HUB]' : '';
  console.log(`${(i+1).toString().padStart(2)}. ${n.label.padEnd(12)} PR=${(n.pagerank||0).toFixed(4)} 社区=${n.community} 出现段落=${n.df}${hub}`);
});
console.log();

// 输出边类型统计
console.log('=== 边类型统计 ===');
const edgeTypes = {};
for (const e of graph.edges) {
  edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
}
for (const [type, count] of Object.entries(edgeTypes)) {
  console.log(`  ${type}: ${count}条`);
}
console.log();

// 输出考题连接情况
console.log('=== 考题-实体连接 ===');
const questionNodes = graph.nodes.filter(n => n.type === 'question');
for (const q of questionNodes) {
  const connected = graph.edges
    .filter(e => e.from === q.id || e.to === q.id)
    .map(e => {
      const otherId = e.from === q.id ? e.to : e.from;
      const node = graph.nodes.find(n => n.id === otherId);
      return node ? `${node.label}(${(e.weight||0).toFixed(2)})` : '';
    })
    .filter(s => s);
  console.log(`  ${q.label}: 连接 ${connected.length} 个实体 → ${connected.join(', ')}`);
}
console.log();

// 输出社区分布
console.log('=== 社区分布 ===');
const commMap = {};
for (const n of graph.nodes) {
  if (n.type === 'entity' && n.community !== undefined) {
    if (!commMap[n.community]) commMap[n.community] = [];
    commMap[n.community].push(n.label);
  }
}
for (const [cid, members] of Object.entries(commMap)) {
  console.log(`  社区${cid} (${members.length}个): ${members.slice(0, 8).join(', ')}${members.length > 8 ? '...' : ''}`);
}
console.log();

// 输出枢纽节点
console.log('=== 核心枢纽节点 (PageRank Top 5) ===');
entities.filter(n => n.isHub).slice(0, 5).forEach((n, i) => {
  console.log(`  ${i+1}. ${n.label} (PR=${(n.pagerank||0).toFixed(4)}, 连接${graph.edges.filter(e=>e.from===n.id||e.to===n.id).length}条边)`);
});
console.log();

console.log('='.repeat(60));
console.log('测试2: 法律教材文本（验证领域无关性）');
console.log('='.repeat(60));

const lawTextbook = `
第一章 合同法基本原理

合同的订立：合同是平等主体的自然人、法人、其他组织之间设立、变更、终止民事权利义务关系的协议。
要约是一方希望与他人订立合同的意思表示。要约应当内容具体确定。
承诺是受要约人同意要约的意思表示。承诺生效时合同成立。
合同的效力：依法成立的合同，对当事人具有法律约束力。
违约责任：当事人一方不履行合同义务或者履行合同义务不符合约定的，应当承担违约责任。
违约金的约定应当合理，过分高于实际损失的，当事人可以请求人民法院予以减少。

第二章 物权法

物权是权利人依法对特定的物享有直接支配和排他的权利。
所有权是物权中最完整、最充分的权利。所有权包括占有、使用、收益、处分四项权能。
用益物权是对他人所有的不动产或者动产，依法享有占有、使用和收益的权利。
担保物权是在债务人或者第三人的特定财产上设定的物权。
抵押权是债务人或者第三人不转移财产的占有，将该财产作为债权的担保。

第三章 侵权责任

侵权行为是侵害他人民事权益的行为。
侵权责任的原则：过错责任原则、无过错责任原则、公平责任原则。
过错责任原则要求行为人主观上有过错才承担侵权责任。
无过错责任原则不论行为人有无过错都应当承担责任。
损害赔偿是侵权责任的主要承担方式。
精神损害赔偿适用于侵害人身权益造成严重精神损害的情形。
`;

console.log('教材字数:', lawTextbook.length);
const lawGraph = KGEngine.buildKnowledgeGraph(lawTextbook, []);
console.log('图谱统计:', lawGraph.stats);
console.log();
console.log('=== 法律实体节点 (Top 15) ===');
const lawEntities = lawGraph.nodes.filter(n => n.type === 'entity')
  .sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0));
lawEntities.slice(0, 15).forEach((n, i) => {
  const hub = n.isHub ? ' [HUB]' : '';
  console.log(`${(i+1).toString().padStart(2)}. ${n.label.padEnd(12)} PR=${(n.pagerank||0).toFixed(4)} 社区=${n.community}${hub}`);
});
console.log();

console.log('='.repeat(60));
console.log('测试3: 医学教材文本（再次验证领域无关性）');
console.log('='.repeat(60));

const medTextbook = `
第一章 心血管系统

心脏是循环系统的核心器官，负责泵血维持血液循环。
心肌细胞具有自律性、传导性、兴奋性和收缩性四种生理特性。
窦房结是心脏的起搏点，发出电冲动控制心跳节律。
心电图是记录心脏电活动的检查方法，包括P波、QRS波群、T波。
血压是血液对血管壁的侧压力，正常收缩压90-139mmHg，舒张压60-89mmHg。
高血压是心血管疾病的重要危险因素。

第二章 呼吸系统

肺是气体交换的主要器官，肺泡是气体交换的基本单位。
呼吸包括外呼吸（肺通气、肺换气）和内呼吸（组织换气）。
氧气通过肺泡壁和毛细血管壁进入血液，与血红蛋白结合运输。
二氧化碳主要以碳酸氢盐形式在血浆中运输。
呼吸调节由脑干呼吸中枢控制，通过化学感受器感受血液氧分压和二氧化碳分压变化。
`;

console.log('教材字数:', medTextbook.length);
const medGraph = KGEngine.buildKnowledgeGraph(medTextbook, []);
console.log('图谱统计:', medGraph.stats);
console.log();
console.log('=== 医学实体节点 (Top 10) ===');
const medEntities = medGraph.nodes.filter(n => n.type === 'entity')
  .sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0));
medEntities.slice(0, 10).forEach((n, i) => {
  const hub = n.isHub ? ' [HUB]' : '';
  console.log(`${(i+1).toString().padStart(2)}. ${n.label.padEnd(12)} PR=${(n.pagerank||0).toFixed(4)} 社区=${n.community}${hub}`);
});

console.log();
console.log('='.repeat(60));
console.log('测试完成！三个不同领域都能成功生成知识图谱。');
console.log('='.repeat(60));
