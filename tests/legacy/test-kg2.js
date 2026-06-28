// 测试脚本 - 输出JSON结果避免编码问题
const fs = require('fs');
const path = require('path');

const kgCode = fs.readFileSync(path.join(__dirname, 'js', 'kg-engine.js'), 'utf-8');
global.window = {};
eval(kgCode);
const KGEngine = global.window.KGEngine;

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

const graph = KGEngine.buildKnowledgeGraph(opticsTextbook, examQuestions);

// 输出JSON结果
const result = {
  stats: graph.stats,
  topEntities: graph.nodes.filter(n => n.type === 'entity')
    .sort((a, b) => (b.pagerank || 0) - (a.pagerank || 0))
    .slice(0, 20)
    .map(n => ({
      label: n.label,
      pagerank: parseFloat((n.pagerank || 0).toFixed(4)),
      community: n.community,
      df: n.df,
      isHub: n.isHub || false
    })),
  questionConnections: graph.nodes.filter(n => n.type === 'question').map(q => {
    const conns = graph.edges
      .filter(e => e.from === q.id || e.to === q.id)
      .map(e => {
        const otherId = e.from === q.id ? e.to : e.from;
        const node = graph.nodes.find(n => n.id === otherId);
        return node ? { entity: node.label, weight: parseFloat((e.weight || 0).toFixed(2)) } : null;
      })
      .filter(Boolean);
    return { question: q.label, connections: conns };
  }),
  communities: (() => {
    const m = {};
    for (const n of graph.nodes) {
      if (n.type === 'entity' && n.community !== undefined) {
        if (!m[n.community]) m[n.community] = [];
        m[n.community].push(n.label);
      }
    }
    return m;
  })()
};

fs.writeFileSync('test-kg-json.json', JSON.stringify(result, null, 2), 'utf-8');
console.log('JSON result written to test-kg-json.json');
console.log('Stats:', JSON.stringify(graph.stats));
