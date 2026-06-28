import { runPipeline } from '../core/pipeline/index.js';

const text = `## 3.1 概率模型

概率模型是统计学的基础。

## 3.2 随机变量

随机变量描述随机现象。

## 3.3 分布函数

分布函数描述概率分布。
`;

async function main() {
  const result = await runPipeline(
    [{ name: 'test.md', content: text }],
    { extractOptions: { splitMode: 'heading', maxTerms: 20 } }
  );

  const docNodes = result.graph.nodes.filter(n => n.type === 'document');
  const headingNodes = result.graph.nodes.filter(n => n.type === 'heading');
  const docHeadingEdges = result.graph.edges.filter(e => e.type === 'contains' && e.from.startsWith('doc-'));

  console.log('Document nodes:', docNodes.map(n => ({ id: n.id, content: n.content })));
  console.log('Heading nodes:', headingNodes.map(n => ({ id: n.id, label: n.label, level: n.level })));
  console.log('Document->heading edges:', docHeadingEdges.map(e => ({ from: e.from, to: e.to })));
  console.log('Total nodes:', result.graph.nodes.length, 'edges:', result.graph.edges.length);
}

main().catch(console.error);
