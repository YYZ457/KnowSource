// 测试改进后的关键词提取和图谱布局
const fs = require('fs');

// 加载kg-engine.js
const code = fs.readFileSync('./js/kg-engine.js', 'utf8');
// 在Node环境模拟window
global.window = {};
eval(code);
const KGEngine = global.window.KGEngine;

(async () => {
const output = [];
output.push('=== 关键词提取测试 ===\n');

// 测试1：物理教材文本
const physicsText = `光的折射定律：光从一种介质进入另一种介质时，光线发生偏折。
折射率n定义为光在真空中的速度与光在介质中的速度之比。
斯涅尔定律描述了入射角和折射角的关系：n1 sin θ1 = n2 sin θ2。
全反射现象发生在光从光密介质射向光疏介质，且入射角大于临界角时。
光的干涉现象：两束相干光波叠加时，光强重新分布，形成明暗相间的条纹。
杨氏双缝干涉实验是经典的干涉实验，证明了光的波动性。
光的衍射现象：光波遇到障碍物时绕过障碍物传播。
惠更斯-菲涅尔原理用于解释衍射现象。
光的偏振现象表明光是横波。
马吕斯定律描述了偏振光通过偏振片后光强的变化。
牛顿环是等厚干涉的典型例子。
迈克耳孙干涉仪利用分振幅法获得相干光。
法布里-珀罗干涉仪用于高分辨率光谱分析。
菲涅尔衍射和夫琅禾费衍射是两种主要的衍射类型。
布拉格定律用于X射线衍射分析晶体结构。`;

const keywords = KGEngine.textRankKeywords(physicsText, 15);
output.push('物理教材关键词（top15）:');
keywords.forEach((k, i) => {
  output.push(`  ${i+1}. ${k.word}  (score=${k.score.toFixed(3)}, freq=${k.freq}, pmi=${k.pmi.toFixed(2)})`);
});

output.push('\n=== 图谱构建+布局测试 ===\n');

// 测试2：构建完整图谱，检测节点重叠
const graph = await KGEngine.buildKnowledgeGraph(physicsText, []);
output.push(`图谱统计:`);
output.push(`  节点数: ${graph.nodes.length}`);
output.push(`  边数: ${graph.edges.length}`);
output.push(`  社区数: ${graph.stats.communities}`);

// 检测重叠
let overlapCount = 0;
let minDist = Infinity;
const entityNodes = graph.nodes.filter(n => n.type === 'entity' || n.type === 'root');
for (let i = 0; i < graph.nodes.length; i++) {
  for (let j = i + 1; j < graph.nodes.length; j++) {
    const dx = graph.nodes[i].x - graph.nodes[j].x;
    const dy = graph.nodes[i].y - graph.nodes[j].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minRequired = (graph.nodes[i].size || 15) + (graph.nodes[j].size || 15) + 8;
    if (dist < minRequired) overlapCount++;
    if (dist < minDist) minDist = dist;
  }
}

output.push(`\n节点重叠检测:`);
output.push(`  最小节点距离: ${minDist.toFixed(2)}`);
output.push(`  重叠节点对数: ${overlapCount}`);
output.push(overlapCount === 0 ? '  ✓ 无重叠' : `  ✗ 仍有 ${overlapCount} 对重叠`);

// 输出节点坐标范围
const xs = graph.nodes.map(n => n.x);
const ys = graph.nodes.map(n => n.y);
output.push(`  X范围: [${Math.min(...xs).toFixed(0)}, ${Math.max(...xs).toFixed(0)}]`);
output.push(`  Y范围: [${Math.min(...ys).toFixed(0)}, ${Math.max(...ys).toFixed(0)}]`);

// 枢纽节点位置
output.push('\n枢纽节点位置:');
graph.nodes.filter(n => n.isHub).slice(0, 5).forEach(n => {
  output.push(`  ${n.label}: (${n.x.toFixed(0)}, ${n.y.toFixed(0)}) size=${n.size.toFixed(0)}`);
});

fs.writeFileSync('test-improve-result.txt', output.join('\n'), 'utf8');
console.log('结果已写入 test-improve-result.txt');
})();


