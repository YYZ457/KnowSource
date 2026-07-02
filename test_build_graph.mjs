import { buildKnowledgeGraph } from 'file:///C:/Users/YANYZ/Documents/trae_projects/Games/%E7%9F%A5%E6%BA%90-Demo/core/core/graph/unsupervised.js'

const pdfText = `\n--- 第1页 ---\n[fs24] 光学基础理论\n第一节 光的波动性\n光是一种电磁波，具有波粒二象性。\n光的干涉现象是波动性的重要证据。\n杨氏双缝实验证明了光的波动性。\n惠更斯-菲涅尔原理描述了波的传播规律。\n光的衍射现象包括单缝衍射和圆孔衍射。\n光栅衍射是衍射现象的重要应用。\n布拉格定律描述了晶体衍射的条件。\n偏振是横波特有的现象，马吕斯定律定量描述了偏振光的强度变化。\n\n\n--- 第2页 ---\n[fs24] 量子力学基础\n第二节 波函数与薛定谔方程\n波函数描述微观粒子的量子态。\n薛定谔方程是量子力学的基本方程。\n海森堡不确定性原理限制了位置和动量的同时测量精度。\n量子隧穿效应是量子力学的重要现象。\n波函数的统计诠释由玻恩提出。\n能量本征值和本征态是量子力学的核心概念。\n谐振子的能级是量子化的，能量间隔为 hf。\n氢原子光谱的巴耳末系可以用玻尔模型解释。\n\n\n--- 第3页 ---\n[fs24] 热力学基础\n第三节 热力学定律\n热力学第一定律即能量守恒定律。\n热力学第二定律描述了熵增原理。\n卡诺循环是理想热机的循环过程。\n熵是热力学中描述无序程度的物理量。\n玻尔兹曼分布描述了粒子在能级上的统计分布。\n麦克斯韦-玻尔兹曼分布适用于经典粒子系统。\n费米-狄拉克分布适用于费米子。\n玻色-爱因斯坦分布适用于玻色子。\n`;

const result = await buildKnowledgeGraph(pdfText, [], { useAI: false, seedTerms: [], headings: [], minSeedTerms: 5 });

const fsNodes = result.nodes.filter(n => /fs\d/i.test(n.content || n.label || ''));
const entityNodes = result.nodes.filter(n => n.type === 'entity');

console.log('Total nodes:', result.nodes.length);
console.log('Total edges:', result.edges.length);
console.log('FS nodes:', fsNodes.length);
if (fsNodes.length > 0) {
  console.log('FS node details:', JSON.stringify(fsNodes));
}
console.log('Entity labels:', entityNodes.map(n => n.content || n.label).slice(0, 20));
