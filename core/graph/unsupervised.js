/** @module core/graph/unsupervised
 *  职责：无监督知识图谱生成（TextRank + 共现 + PageRank + 社区发现）
 *  迁移自：js/kg-engine.js
 *  公开 API: ES Module export（buildKnowledgeGraph, textRankKeywords 等）
 *  注：浏览器全局挂载已移除，通过 export 暴露；旧页面请改用 js/kg-engine.js
 */
import { UNDIRECTED_TYPES } from './edge.js';

// ============================================================
//  知源 Demo — 无监督知识图谱生成引擎 v2
//  方法：TextRank + 短语抽取 + TF-IDF + 共现 + PageRank + 社区发现
//  改进：
//   1. 扩展停用词表，过滤"表明/其中/如下"等高频虚词
//   2. 节点标签提炼为小标题（从上下文抽取关键短语）
//   3. 考题用句子级语义匹配，连接多个相关实体
//   4. 保留页码/段落定位信息
// ============================================================

// ============ 1. 通用停用词表 ============
// 仅保留真正通用的虚词/代词/连接词/量词/教材套话
// 领域特定词（如"下雨""社会""期权"等）不在此处硬编码，由 TF-IDF + PMI 自动降权
const STOP_WORDS = new Set([
  // 中文虚词/助词
  '的', '了', '在', '是', '和', '与', '或', '一个', '可以', '这', '那', '为', '以', '及', '等',
  '中', '上', '下', '不', '有', '无', '到', '从', '被', '把', '将', '对', '向', '由', '于', '而',
  '且', '但', '则', '即', '若', '如', '虽', '然', '因', '故', '所', '之', '其', '此', '彼',
  // 代词
  '我', '你', '他', '它', '们', '我们', '你们', '他们', '它们', '自己', '某', '该',
  // 数词
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  // 教材结构词
  '第', '章', '节', '页', '图', '表', '例', '解', '答', '题', '问', '请', '述',
  '什么', '怎么', '如何', '为什么', '哪些', '哪个', '这种', '那种', '这样', '那样',
  // 连接词/过渡词
  '进行', '通过', '根据', '按照', '由于', '因为', '所以', '但是', '然而', '另外',
  '同时', '其中', '其他', '其它', '上述', '下面', '上面', '前面', '后面', '之间',
  '以及', '并且', '或者', '如果', '虽然', '尽管', '即使', '除非', '一旦', '当时',
  // 高频功能词
  '表明', '表示', '如下', '所示', '称为', '称作', '叫做', '定义', '是指', '就是',
  '具有', '含有', '包含', '包括', '存在', '发生', '产生', '形成', '组成', '构成',
  '得到', '获得', '获取', '取得', '求出', '求得', '算出', '计算',
  '需要', '要求', '应', '应当', '应该', '必须',
  '使用', '利用', '运用', '采用', '采取', '选用', '选择',
  '已知', '未知', '设', '假设', '令',
  // 教材常见非概念词
  '可能', '真正', '世界', '这个', '这些', '那些', '某个', '某些',
  '比较', '一般', '通常', '往往', '总是', '从不', '已经', '正在',
  '比如', '例如', '譬如', '举例', '即', '亦即', '也就是', '换言之',
  '可见', '可知', '得出', '例如', '比如', '譬如', '举例', '实例',
  '即', '亦即', '也就是', '换句话', '换言之',
  '分别', '各自', '每个', '每一', '各个', '各',
  '一定', '大致', '约', '大约', '左右',
  '此时', '上式', '下式', '左式', '右式', '该式', '此式', '其式',
  '上述', '下述', '此', '其',
  // 量词
  '个', '种', '类', '项', '条', '件', '本', '份', '次', '回', '遍', '趟',
  // 教材套话（通用，非领域特定）
  '内容', '方法', '方式', '方面', '方向',
  '情况', '情形', '状况', '状态', '条件', '前提',
  '问题', '事项', '事物', '事例',
  '目的', '目标', '结果', '结论', '效果', '影响',
  '原因', '理由', '依据', '根据',
  '特点', '特征', '特性', '性质', '属性',
  '过程', '步骤', '流程', '程序',
  '部分', '组成部', '基本部', '主要部',
  '本节', '本章', '本文', '本书', '本课',
  '一般', '通常', '常见', '常常', '经常', '往往',
  '重要', '主要', '基本', '基础', '根本', '核心', '关键',
  '注意', '不同', '相同', '一致', '类似', '相似',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'up', 'about', 'into', 'through', 'during', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'can', 'may', 'must', 'shall', 'as', 'if', 'then', 'than', 'so', 'such', 'also', 'too', 'very', 'just', 'only',
  // 英文学术论文非概念词
  'each', 'used', 'using', 'use', 'uses', 'more', 'most', 'over', 'other', 'another',
  'while', 'before', 'after', 'previously', 'between', 'different', 'same',
  'long', 'short', 'large', 'small', 'high', 'low', 'new', 'old', 'first', 'last',
  'number', 'table', 'figure', 'fig', 'results', 'result', 'state', 'states',
  'size', 'sizes', 'type', 'types', 'form', 'forms', 'case', 'cases',
  'way', 'ways', 'part', 'parts', 'line', 'lines', 'point', 'points',
  'side', 'sides', 'end', 'ends', 'top', 'bottom', 'left', 'right',
  'general', 'common', 'simple', 'complex', 'single', 'double', 'multiple',
  'following', 'above', 'below', 'however', 'therefore', 'thus', 'hence',
  'both', 'all', 'some', 'any', 'every', 'few', 'many',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'given', 'shown', 'called', 'known', 'unknown', 'defined',
  'based', 'base', 'overall', 'total', 'whole', 'full', 'empty',
  'output', 'outputs', 'input', 'inputs',
  'english', 'german', 'french',
  'google', 'facebook', 'microsoft',
  'usually', 'since', 'there', 'often', 'mainly', 'various', 'important',
  'specific', 'recent', 'major', 'larger', 'time', 'work', 'approach',
  'process', 'effect', 'study', 'solve', 'solving', 'good', 'paper',
  'proposed', 'proposes', 'propose', 'second', 'order', 'focus',
  'improve', 'connected', 'fully', 'category', 'wise',
  'randomly', 'capable', 'compute', 'style',
  'series', 'technical', 'representative', 'openai', 'palm',
  'fine', 'natural', 'word', 'data',
  // 英文学术论文元数据词（非领域概念，来自论文标题/期刊/会议信息）
  'conference', 'international', 'proceedings', 'journal', 'transactions',
  'press', 'society', 'institute', 'university', 'college', 'department',
  'author', 'authors', 'et', 'al', 'vol', 'pp', 'doi', 'isbn', 'issn',
  'abstract', 'keywords', 'introduction', 'conclusion', 'references',
  // 英文通用动词/名词（在学术语境中过于宽泛）
  'pattern', 'patterns', 'scale', 'scales', 'human', 'humans',
  'processing', 'recognition', 'vision', 'training', 'convolutional',
  'deep', 'neural', 'networks', 'network', 'machine', 'learning',
  'application', 'applications', 'performance', 'accuracy', 'method', 'methods',
  'model', 'models', 'layer', 'layers', 'feature', 'features',
  'classification', 'detection', 'segmentation', 'generation',
  'imagenet', 'cifar', 'mnist', 'dataset', 'datasets',
  'accuracy', 'loss', 'error', 'rate', 'rates',
  // 英文碎片词/通用词/人名（从实际图谱数据中发现的噪声实体）
  'speech', 'research', 'hierarchical', 'computer', 'saliency',
  'salient', 'visual', 'wang', 'attention',
  'information', 'analysis', 'system', 'systems', 'based', 'using',
  'proposed', 'method', 'results', 'show', 'table', 'figure',
]);

// ============ 1b. 通用过滤常量 ============
const MATH_SYMBOLS = /[∫∬∭∮∯∰∑∏∂∇√∞∈∉∪∩⊂⊃⊆⊇≈≠≡≤≥×÷±∞αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ¯ˆ˜¨˙\^\_]/;
const MATH_OPERATORS = /[+=\-*/<>^~|&%$#@!\?\{\}\[\]\(\)]/;
const MATH_VAR_PATTERN = /^(dx|dy|dz|dt|cov|var|std|sd|se|exp|ex|log|ln|lim|sin|cos|tan|xn|yn|fn|gx|hx|xi|yi|zi|fi|gi|hi|dxdy|dydx|dxdz|dzdx|dydz|dzdy|dtdx|dxdt|dtdy|dydt|[a-zA-Z][0-9]?)$/i;
const HEADING_NUMBER_PATTERN = /^\s*\d+(?:\.\d+)*\s*[\u4e00-\u9fa5]/;
const FRAGMENT_START_PATTERN = /^[的是在中为和以与或得次量互维\)\]）】]/;
const FRAGMENT_END_PATTERN = /[的是为与]$/;
// 扩展碎片词首字检查：仅在短词(≤5字)上生效，避免误伤"等价关系""度量学习"等合法术语
const FRAGMENT_START_SHORT_PATTERN = /^[等度才京宝层们被把将向由而且但则即若如虽然因故所之其此彼某该第章节页图表例解答题问述各约本个种类项目条件份回遍趟]/;
// 通用结构性垃圾词模式：断词（以虚词结尾且≤5字）、公式残留、章节编号开头
// 不再枚举领域特定断词，由结构性模式 + PMI + 子串抑制自动过滤
const JUNK_WORDS = /^([^\u4e00-\u9fa5a-zA-Z]{0,3}[的是为与以于从到在由向或及等]$|^[a-zA-Z]\s+[\u4e00-\u9fa5]|^[IVXivx]$)/i;

// ============ 1c. 实体质量增强过滤常量（v2 新增） ============
// 以下常量用于 isGarbageEntity 的增强过滤，解决 PDF 提取产生的碎片化实体问题

// 乱码/编码错误字符：替换符(U+FFFD)、控制字符(除制表/换行外)、
// PDF.js 逐字节 Latin-1 误读产生的重音拉丁字符密集组合
const GARBAGE_CHAR = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/;
// 检测连续 2 个及以上重音拉丁字符（PDF 中文被逐字节当 Latin-1 解码的典型乱码特征）
const MOJIBAKE_PATTERN = /[àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß]{2,}/;

// 纯数字或数字+符号组合（如 "3.14"、"2024"、"1,000"、"1.0.0"、"3-2"）
// 这类片段来自公式、年份、页码、编号，不是知识图谱实体
const PURE_NUMERIC_PATTERN = /^[\d\s.,;:_%\-+\/\*\^\(\)\[\]\{\}~]+$/;
// 数字占比过高（数字+少量字母/中文，如 "3a"、"x1"、"第3" 之类编号残留）
// 当实体中数字字符占比超过 60% 且总长 <=5 时视为编号碎片
function isNumericDominant(word) {
  const digits = (word.match(/\d/g) || []).length;
  const alpha = (word.match(/[\u4e00-\u9fa5a-zA-Z]/g) || []).length;
  const total = digits + alpha;
  return total > 0 && digits / total > 0.6 && word.length <= 5;
}

// 有效字符（中日韩统一表意文字 + 英文字母 + 数字）
const MEANINGFUL_CHARS = /[\u4e00-\u9fa5a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g;
// 当有效字符占比过低（<60%）时，判定为 PDF 提取碎片或乱码残留
const MIN_MEANINGFUL_RATIO = 0.6;

// 重复字符检测：同一字符连续出现 3 次以上（如 "随随随"、"的的的"），通常是解析错误
function hasExcessiveRepetition(word) {
  const runs = word.match(/(.)\1{2,}/g);
  if (!runs) return false;
  const repeated = runs.reduce((s, r) => s + r.length, 0);
  return repeated / word.length > 0.4;
}

// ============ 2. 中文分词（轻量级，无需词典） ============
// 改进：基于互信息(PMI)的多字词识别 + 学术后缀识别 + 词性启发式过滤

// 学术术语后缀：含这些后缀的词很可能是关键术语，应保留
// 精简为真正的学术术语后缀，移除"方面/层面/领域/对象/功能/作用/影响"等通用名词后缀（过拟合）
const ACADEMIC_SUFFIXES = /^(.*?)(定律|原理|公式|定理|法则|方程|效应|现象|分布|检验|估计|矩阵|过程|链|序列|空间|状态|模型|系统|方法|性质|特征|规律|关系|概念|定义|结构|机制|条件|常数|系数|参数|变量|函数|向量|标量|假设|算法|策略|框架|理论)$/;


// 更精确的动词/功能词后缀（避免误伤术语）
const FUNCTIONAL_SUFFIXES = /(表明|表示|说明|指出|认为|称为|称作|叫做|定义|属于|具有|含有|包含|包括|存在|发生|产生|形成|组成|构成|得到|获得|获取|取得|求出|求得|算出|计算|需要|要求|使用|利用|运用|采用|采取|选用|选择|已知|未知|假设|设为|可见|可知|得出|例如|比如|譬如|举例|即|亦即|也就是|换句话|换言之|分别|各自|进行|通过|根据|按照|由于|因为|所以|但是|然而|另外|同时|其中|其他|上述|下面|上面|前面|后面|之间|以及|并且|或者|如果|虽然|尽管|即使|除非|一旦|当时|可以|应当|应该|必须|得以|需要注|应当注|值得注)$/;

// 通用功能动词/教材套话动词 Set（替代过拟合的 verbEndings 枚举数组）
// 仅保留真正通用的虚化动词，不包含领域特定动词
const VERB_FUNCTION_WORDS = new Set([
  '用于', '发生', '形成', '得到', '获得', '取得', '需要', '进行', '通过', '根据', '按照',
  '产生', '使用', '利用', '运用', '采用', '采取', '称为', '称作', '叫做', '属于',
  '具有', '包含', '包括', '存在', '组成', '构成', '说明', '表明', '表示', '指出',
  '认为', '定义', '可知', '可见', '得出', '如下', '所示', '是指', '就是',
  '本节', '本章', '本文', '本书', '本课',
  '一般', '通常', '常见', '常常', '经常', '往往',
  '重要', '主要', '基本', '基础', '根本', '核心', '关键',
  '注意', '应当', '应该', '必须',
  '内容', '方法', '方式', '方面', '情况', '情形', '问题', '结果', '结论', '目的',
  '原因', '理由', '特点', '特征', '特性', '过程', '步骤',
  '分别', '各自', '例如', '比如', '譬如',
  '由于', '因为', '所以', '但是', '然而', '另外', '同时', '其中', '上述',
  '得以', '已知', '未知', '假设'
]);

function tokenize(text) {
  if (!text) return [];
  // 清理 PDF 内部标记：[fsXX] 字号标记、[bookmark:LX] 书签标记
  // 必须在保留字母数字的正则之前移除，否则 fs24 会被当作正常词提取
  const cleaned = (text || '')
                    .replace(/\[fs\d+(?:\.\d+)?\]/g, '')
                    .replace(/\[bookmark:L\d+\]/g, '')
                    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
  if (!cleaned) return [];

  const tokens = [];
  const englishParts = cleaned.match(/[a-zA-Z][a-zA-Z0-9\-_]*[a-zA-Z0-9]|[a-zA-Z]/g) || [];
  const chineseText = cleaned.replace(/[a-zA-Z0-9\s]/g, '');

  // 中文2字词候选
  for (let i = 0; i < chineseText.length - 1; i++) {
    tokens.push(chineseText.substr(i, 2));
  }
  // 中文3字词候选
  for (let i = 0; i < chineseText.length - 2; i++) {
    tokens.push(chineseText.substr(i, 3));
  }
  // 中文4字词候选（捕获更长术语）
  for (let i = 0; i < chineseText.length - 3; i++) {
    tokens.push(chineseText.substr(i, 4));
  }

  for (const w of englishParts) {
    if (w.length >= 2) tokens.push(w.toLowerCase());
  }

  return tokens;
}

// 提取最长连续中文术语片段（优先完整词，避免过度拆分）
function extractChineseTerms(text, maxLen = 6) {
  if (!text) return [];
  const cleaned = (text || '')
                    .replace(/\[fs\d+(?:\.\d+)?\]/g, '')
                    .replace(/\[bookmark:L\d+\]/g, '')
                    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
  if (!cleaned) return [];
  const terms = [];
  // 按空格切分出候选片段
  const parts = cleaned.split(/\s+/);
  for (const part of parts) {
    // 提取连续中文字符段
    const segs = part.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const seg of segs) {
      // 生成从2到maxLen的n-gram
      for (let n = 2; n <= Math.min(maxLen, seg.length); n++) {
        for (let i = 0; i <= seg.length - n; i++) {
          terms.push(seg.substr(i, n));
        }
      }
      // 如果整段本身有意义（>=2字），也作为候选
      if (seg.length >= 2) terms.push(seg);
    }
  }
  return terms;
}

// ============ 2b. 互信息(PMI)计算：过滤随机N-gram ============
// PMI高的多字词是真正的词组，PMI低的是随机拼接
// ★ 修复：从原始文本提取单字，而不是从tokens中提取
function computePMI(tokens, originalText) {
  const unigram = new Map(); // 单字频率
  const bigram = new Map();  // 双字频率
  const trigram = new Map(); // 三字频率
  let total = 0;

  // ★ 关键修复：从原始文本提取单字（中文字符）
  const chineseChars = (originalText || tokens.join('')).match(/[\u4e00-\u9fa5]/g) || [];
  for (const c of chineseChars) {
    unigram.set(c, (unigram.get(c) || 0) + 1);
    total++;
  }

  // 统计多字词频率
  let totalBigrams = 0;
  let totalTrigrams = 0;
  for (const t of tokens) {
    if (t.length === 2) {
      bigram.set(t, (bigram.get(t) || 0) + 1);
      totalBigrams++;
    } else if (t.length === 3) {
      trigram.set(t, (trigram.get(t) || 0) + 1);
      totalTrigrams++;
    }
  }

  // 单字总频率（用于PMI计算中的 P(单字)）
  const totalUnigram = total || 1;
  // 多字词总频率（用于PMI计算中的 P(词) = freq / totalBigrams）
  const totalBigram = totalBigrams || 1;
  const totalTrigram = totalTrigrams || 1;

  // 计算每个多字词的PMI
  // 使用拉普拉斯平滑，避免短文本中 PMI 因 total 小而剧烈波动
  const pmiScores = new Map();
  for (const [word, freq] of bigram) {
    const c1 = unigram.get(word[0]) || 1;
    const c2 = unigram.get(word[1]) || 1;
    if (c1 > 0 && c2 > 0) {
      // PMI = log(P(ab) / (P(a) * P(b)))
      // P(ab) = freq / totalBigrams（修正：用bigram总数而非unigram总数）
      const pWord = (freq + 0.1) / (totalBigram + 0.1 * totalBigram);
      const p1 = c1 / totalUnigram;
      const p2 = c2 / totalUnigram;
      const pmi = Math.log(pWord / (p1 * p2));
      pmiScores.set(word, pmi);
    }
  }
  for (const [word, freq] of trigram) {
    const c1 = unigram.get(word[0]) || 1;
    const c2 = unigram.get(word[1]) || 1;
    const c3 = unigram.get(word[2]) || 1;
    if (c1 > 0 && c2 > 0 && c3 > 0) {
      const pWord = (freq + 0.1) / (totalTrigram + 0.1 * totalTrigram);
      const p1 = c1 / totalUnigram;
      const p2 = c2 / totalUnigram;
      const p3 = c3 / totalUnigram;
      const pmi = Math.log(pWord / (p1 * p2 * p3));
      pmiScores.set(word, pmi);
    }
  }

  return pmiScores;
}

// 中文碎片噪声词：PDF分词产生的断裂片段
const ENTITY_NOISE = new Set([
  '码器', '解码', '编码', '卷积神经', '深度神', '经网络', '神网络',
  '深度学习研', '卷积神经网', '注意力机', '注意力机制研',
  '卷积层', '池化层', '全连接',
  // 中文碎片噪声词（PDF分词产生的断裂片段）
  '计算机应', '算机应用', '等人提出', '包含了',
  // 量词+名词碎片（PDF分词产生的断裂片段）
  '张图像', '个视频', '幅图像', '个特征', '种方法', '类网络', '个模型',
]);

// 轻量垃圾实体检测（不依赖 PMI，用于最终过滤阶段）
// 仅保留通用结构性检测，不包含领域特定词汇过滤
function isGarbageEntity(word) {
  if (!word || word.length < 2 || word.length > 18) return true;
  if (STOP_WORDS.has(word)) return true; // 命中通用停用词直接过滤
  if (ENTITY_NOISE.has(word)) return true;
  if (JUNK_WORDS.test(word)) return true;
  if (MATH_SYMBOLS.test(word)) return true;
  if (MATH_VAR_PATTERN.test(word)) return true;
  if (HEADING_NUMBER_PATTERN.test(word)) return true;
  if (FRAGMENT_START_PATTERN.test(word)) return true;
  if (FRAGMENT_END_PATTERN.test(word) && word.length <= 5) return true;
  // 扩展碎片词检查：短词(≤5字)以常见断词字开头时过滤
  if (word.length <= 5 && FRAGMENT_START_SHORT_PATTERN.test(word)) return true;
  if (/[+=<>^~]/.test(word)) return true;
  // 过滤包含逗号、顿号等的多词拼接或断裂标签
  if (/[，,、]/.test(word)) return true;
  // 过滤含罗马数字+数字混合的目录/页码片段
  if (/[IVXivx]/.test(word) && /\d/.test(word)) return true;
  // 过滤含箭头、反斜杠等连接符号的断裂标签
  if (/[→←↔⇒⇐⇔\/\\]/.test(word)) return true;
  // 过滤以单字母+空格开头的标签
  if (/^[a-zA-Z]\s+/.test(word)) return true;
  // 过滤全小写英文缩写（1-3字母），这类通常不是完整术语
  if (/^[a-z]{1,3}$/.test(word)) return true;
  // 运算符占比过高（公式残留）
  const ops = (word.match(MATH_OPERATORS) || []).length;
  const textChars = (word.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length;
  if (textChars > 0 && ops / (ops + textChars) > 0.25) return true;

  // ===== v2 新增：实体质量增强过滤 =====

  // 1. 乱码字符检测：PDF 提取产生的替换符、控制字符、C1 控制区字符
  //    这类字符不可能出现在正常学术术语中，直接过滤
  if (GARBAGE_CHAR.test(word)) return true;

  // 2. Mojibake 检测：PDF.js 将 UTF-8 多字节字符逐字节当 Latin-1 解码，
  //    会产生连续的重音拉丁字符（如 "ç""è""å"），这是中文乱码的典型特征
  if (MOJIBAKE_PATTERN.test(word)) return true;

  // 3. 纯数字或数字+符号组合过滤（如 "3.14"、"2024"、"1,000"、"1.0.0"）
  //    这类片段来自公式常量、年份、页码、章节编号，不是知识图谱实体
  if (PURE_NUMERIC_PATTERN.test(word)) return true;

  // 4. 数字占主导的短碎片过滤（如 "3a"、"x1"、"第3" 之类编号残留）
  if (isNumericDominant(word)) return true;

  // 5. 有效字符占比检测：当有效字符（中日韩/英文/数字）占比 < 60% 时，
  //    判定为 PDF 提取碎片或乱码残留（如 "摇βδ"、"底∫∑" 等混合乱码）
  const meaningful = (word.match(MEANINGFUL_CHARS) || []).length;
  if (word.length > 0 && meaningful / word.length < MIN_MEANINGFUL_RATIO) return true;

  // 6. 重复字符检测：同一字符连续出现 3 次以上（如 "随随随"、"的的的"），
  //    通常是 PDF 解析错误或 OCR 噪声，不是正常术语
  if (hasExcessiveRepetition(word)) return true;

  // 7. PDF 碎片化文本检测：含非常用符号组合的断裂片段
  //    过滤含方框、菱形、星号等特殊符号的实体（PDF 装饰符/占位符残留）
  if (/[□◇◆★☆●○▲△▼▽■◀▶◇※]/.test(word)) return true;

  return false;
}

// 判断一个词是否值得保留（基于PMI和后缀）
function isQualityWord(word, pmiScores, freq) {
  if (!word || word.length < 2) return false;
  if (STOP_WORDS.has(word)) return false;
  if (FUNCTIONAL_SUFFIXES.test(word)) return false;
  
  // ★ 过滤以"的"开头的词（如"的干涉"、"的衍射"）
  if (word.startsWith('的')) return false;
  
  // ★ 过滤以"中"开头的词（如"中的速度"、"中的现象"）
  if (word.startsWith('中') && word.length <= 4) return false;

  // ★ 过滤以"机"开头的断词（如"机过程的"、"机变量的"）
  if (word.startsWith('机') && word.length <= 5) return false;

  // ★ 过滤常见断词/垃圾词
  if (JUNK_WORDS.test(word)) return false;

  // ★ 过滤章节编号开头的标题片段（如"1 复合随机变量的特征"）
  if (HEADING_NUMBER_PATTERN.test(word)) return false;

  // ★ 过滤英文变量/函数缩写（如"dx"、"cov"、"xn"）
  if (MATH_VAR_PATTERN.test(word)) return false;

  // ★ 过滤公式残留：含大量数学运算符或数学符号
  if (MATH_SYMBOLS.test(word)) return false;
  const mathOps = (word.match(MATH_OPERATORS) || []).length;
  const textChars = (word.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length;
  if (textChars > 0 && mathOps / (mathOps + textChars) > 0.25) return false;

  // ★ 过滤以残缺标点/停用词开头的断词
  if (FRAGMENT_START_PATTERN.test(word)) return false;

  // ★ 过滤以"的""是""为""与"结尾的断词
  if (FRAGMENT_END_PATTERN.test(word) && word.length <= 5) return false;

  // ★ 扩展碎片词检查：短词(≤5字)以常见断词字开头时过滤
  if (word.length <= 5 && FRAGMENT_START_SHORT_PATTERN.test(word)) return false;

  // ★ 过滤通用功能动词/教材套话（VERB_FUNCTION_WORDS）
  if (VERB_FUNCTION_WORDS.has(word)) return false;

  // ★ v2 新增：PDF 乱码/碎片化文本早期拦截（与 isGarbageEntity 保持一致）
  // 虽然 tokenize() 已清理大部分非中英文字符，但种子术语/AI 术语路径可能绕过 tokenize
  if (GARBAGE_CHAR.test(word)) return false;                 // 控制字符/替换符
  if (MOJIBAKE_PATTERN.test(word)) return false;             // Latin-1 误读乱码
  if (PURE_NUMERIC_PATTERN.test(word)) return false; // 纯数字/数字+符号
  if (isNumericDominant(word)) return false;                  // 数字占主导的短碎片
  if (hasExcessiveRepetition(word)) return false;             // 重复字符过多
  // 有效字符占比过低（PDF 碎片残留）
  const _meaningful = (word.match(MEANINGFUL_CHARS) || []).length;
  if (word.length > 0 && _meaningful / word.length < MIN_MEANINGFUL_RATIO) return false;

  // 学术术语后缀：直接保留（高优先级）
  if (ACADEMIC_SUFFIXES.test(word)) return true;

  // PMI过滤：多字词必须有足够的互信息
  // 短文本/低频场景下放宽 PMI 阈值，避免把合理术语全部过滤掉
  if (word.length >= 2) {
    const pmi = pmiScores.get(word);
    if (pmi !== undefined) {
      // PMI阈值：频率越高要求越宽松；短文本中freq多为1，阈值不宜过高
      const threshold = freq > 5 ? -2 : (freq > 2 ? -1 : 1);
      if (pmi < threshold) return false;
    }
  }

  return true;
}

// ============ 3. TextRank 关键词抽取（无监督） ============
// 改进：基于句子边界构建共现图 + PMI质量过滤 + 学术后缀加权
function textRankKeywords(text, topN = 30, windowSize = 4) {
  const allTokens = tokenize(text);
  if (allTokens.length === 0) return [];

  // 计算PMI用于过滤随机N-gram（传入原始文本）
  const pmiScores = computePMI(allTokens, text);

  // 统计词频
  const wordFreq = new Map();
  for (const t of allTokens) {
    wordFreq.set(t, (wordFreq.get(t) || 0) + 1);
  }

  // ★ 子串抑制：若一个词是另一个更长候选词的子串且频率不更高，则视为片段
  // 限制在2-4字候选内，避免长片段误伤短词
  const suppressed = new Set();
  const candidates = [...wordFreq.keys()].filter(w => w.length >= 2 && w.length <= 4);
  for (let i = 0; i < candidates.length; i++) {
    const w1 = candidates[i];
    if (suppressed.has(w1)) continue;
    const f1 = wordFreq.get(w1) || 0;
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const w2 = candidates[j];
      if (w2.length <= w1.length) continue;
      if (w2.includes(w1) && (wordFreq.get(w2) || 0) >= f1) {
        suppressed.add(w1);
        break;
      }
    }
  }

  // ★ 质量过滤：只保留高质量词
  const tokens = allTokens.filter(t =>
    isQualityWord(t, pmiScores, wordFreq.get(t) || 0) && !suppressed.has(t));
  if (tokens.length === 0) return [];

  // ★ 基于句子边界构建共现图（避免跨句共现）
  // 按标点切分句子，每个句子内独立构建共现
  const sentences = text.split(/[。！？.;；\n]+/);
  const graph = new Map();

  for (const sent of sentences) {
    const sentTokens = tokenize(sent).filter(t =>
      isQualityWord(t, pmiScores, wordFreq.get(t) || 0) && !suppressed.has(t));
    for (let i = 0; i < sentTokens.length; i++) {
      const w1 = sentTokens[i];
      if (!graph.has(w1)) graph.set(w1, new Map());
      for (let j = Math.max(0, i - windowSize); j < Math.min(sentTokens.length, i + windowSize + 1); j++) {
        if (i === j) continue;
        const w2 = sentTokens[j];
        const neighbors = graph.get(w1);
        neighbors.set(w2, (neighbors.get(w2) || 0) + 1);
      }
    }
  }

  // PageRank迭代
  const scores = new Map();
  const d = 0.85;
  const iter = 30;
  const words = [...graph.keys()];
  for (const w of words) scores.set(w, 1.0);

  for (let it = 0; it < iter; it++) {
    const newScores = new Map();
    for (const w of words) {
      let sum = 0;
      const neighbors = graph.get(w);
      for (const [nb, weight] of neighbors) {
        const nbOut = graph.get(nb);
        let nbTotal = 0;
        for (const v of nbOut.values()) nbTotal += v;
        if (nbTotal > 0) {
          sum += (scores.get(nb) || 0) * weight / nbTotal;
        }
      }
      newScores.set(w, (1 - d) + d * sum);
    }
    // 移除迭代中的归一化，避免破坏概率分布
    for (const [k, v] of newScores) scores.set(k, v);
  }

  // 只在迭代结束后做一次归一化
  let max = 0;
  for (const v of scores.values()) if (v > max) max = v;
  if (max > 0) for (const [k, v] of scores) scores.set(k, v / max);

  // ★ 后处理：学术术语加权 + 子串去重
  const result = [...scores.entries()]
    .map(([word, score]) => {
      let finalScore = score;
      // 学术术语加权
      if (ACADEMIC_SUFFIXES.test(word)) finalScore *= 1.5;
      // 长词加权（3-4字词比2字词更有信息量）
      if (word.length >= 3) finalScore *= 1.2;
      // PMI加权：高PMI的词组更可能是真词
      const pmi = pmiScores.get(word);
      if (pmi !== undefined && pmi > 2) finalScore *= 1.1;
      // 惩罚明显断词：无学术后缀且被多个更长词包含的短片段
      const longerCount = candidates.filter(c => c.length > word.length && c.includes(word)).length;
      if (word.length <= 3 && longerCount >= 2 && !ACADEMIC_SUFFIXES.test(word)) finalScore *= 0.7;
      return { word, score: finalScore, rawScore: score, pmi: pmi || 0, freq: wordFreq.get(word) || 0 };
    })
    .sort((a, b) => b.score - a.score);

  // 去重：移除被高频词包含的子串（保留更长的术语）
  const filtered = [];
  const seen = new Set();
  for (const item of result) {
    if (seen.has(item.word)) continue;
    if (STOP_WORDS.has(item.word)) continue;
    if (FUNCTIONAL_SUFFIXES.test(item.word)) continue;
    // 检查是否是已选词的子串（仅当更长词得分不低时抑制）
    let isSub = false;
    for (const f of filtered) {
      if (f.word.includes(item.word) && f.word !== item.word && f.score >= item.score * 0.5) {
        isSub = true;
        break;
      }
      // 如果当前词更长且包含已选词，替换已选词
      if (item.word.includes(f.word) && item.word !== f.word && item.score >= f.score * 0.5) {
        const idx = filtered.indexOf(f);
        filtered[idx] = item;
        seen.add(item.word);
        isSub = true;
        break;
      }
    }
    if (isSub) continue;
    filtered.push(item);
    seen.add(item.word);
    if (filtered.length >= topN) break;
  }

  return filtered;
}

// ============ 4. TF-IDF 向量化 ============
function buildTfIdf(docs) {
  const N = docs.length;
  const df = new Map();
  const tfMap = new Map();

  for (const doc of docs) {
    const tokens = tokenize(doc.text).filter(t => !STOP_WORDS.has(t) && t.length >= 2);
    const tf = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    tfMap.set(doc.id, tf);
    for (const word of tf.keys()) {
      df.set(word, (df.get(word) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [word, count] of df) {
    idf.set(word, Math.log((N + 1) / (count + 1)) + 1);
  }

  return { tfMap, idf, N };
}

function docToVector(docId, model) {
  const tf = model.tfMap.get(docId);
  if (!tf) return new Map();
  const vec = new Map();
  for (const [word, freq] of tf) {
    const idfVal = model.idf.get(word) || 0;
    vec.set(word, freq * idfVal);
  }
  return vec;
}

function cosineSimilaritySparse(vec1, vec2) {
  let dot = 0;
  let norm1 = 0, norm2 = 0;
  const [small, large] = vec1.size < vec2.size ? [vec1, vec2] : [vec2, vec1];
  for (const [k, v] of small) {
    const v2 = large.get(k);
    if (v2 !== undefined) dot += v * v2;
    norm1 += v * v;
  }
  for (const v of vec2.values()) norm2 += v * v;
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ============ 5. 句子切分 ============
function splitSentences(text) {
  if (!text) return [];
  const sentences = text
    .split(/[。！？.;；\n]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 8);
  return sentences;
}

// ============ 6. 段落切分（保留页码信息） ============
function splitParagraphs(text, maxLen = 500) {
  if (!text) return [];
  let paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 30);
  if (paras.length < 3) {
    paras = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 30);
  }
  // 兜底：如果文本极短或没有换行，整段作为单个段落，避免无监督算法无输入
  if (paras.length === 0 && text.trim().length > 0) {
    paras = [text.trim()];
  }
  const result = [];
  for (const p of paras) {
    // 提取页码标记 --- 第X页 ---
    const pageMatch = p.match(/---\s*第(\d+)页/g);
    const pages = pageMatch ? pageMatch.map(m => parseInt(m.match(/\d+/)[0])) : [];
    if (p.length <= maxLen) {
      result.push({ text: p, pages });
    } else {
      const sents = splitSentences(p);
      let cur = '';
      let curPages = [...pages];
      for (const s of sents) {
        if ((cur + s).length <= maxLen) {
          cur += s + '。';
        } else {
          if (cur) result.push({ text: cur, pages: curPages });
          cur = s + '。';
          curPages = [...pages];
        }
      }
      if (cur) result.push({ text: cur, pages: curPages });
    }
  }
  return result;
}

// ============ 7. ★ 新增：从上下文提炼节点小标题 ============
// 给定一个关键词，从原文中找出包含它的最佳短语作为标签。
// 策略非常保守：只有当 keyword 本身太短或太泛，且 phrase 是明确、完整、
// 带学术后缀的术语时才替换；否则保留 keyword，避免把“区间估计”扩展成“得区间估计”。
function extractPhraseLabel(keyword, text) {
  if (!text || !keyword) return keyword;

  // 不再使用硬编码的 ENTITY_ALIASES / DO_NOT_EXPAND / 超长领域特定后缀列表（用户要求"不要硬编码过拟合"）
  // 如果 LLM 已精炼标签（通过 refineTermsWithLLM），调用方应直接使用，不再调用此函数
  // 此函数仅作为 rule fallback 路径的保守标签提取

  // 通用学术后缀检测（跨领域通用，非物理化学特定）
  // 与模块级 ACADEMIC_SUFFIXES 保持一致（含效应/现象/假设/算法/策略/框架/理论）
  const ACADEMIC_SUFFIX_UNIVERSAL = /(定律|原理|公式|定理|法则|方程|效应|现象|分布|检验|估计|矩阵|过程|链|序列|空间|状态|模型|系统|方法|性质|特征|规律|关系|概念|定义|结构|机制|条件|常数|系数|参数|变量|函数|向量|标量|假设|算法|策略|框架|理论)$/;
  if (keyword.length >= 3 && ACADEMIC_SUFFIX_UNIVERSAL.test(keyword)) {
    return keyword;
  }

  const sentences = text.split(/[。！？\.\n；;：:]+/);
  let bestPhrase = keyword;
  let bestScore = 0;

  // 通用套话过滤（跨领域通用，非领域特定）
  const PHRASE_JUNK_UNIVERSAL = /(两种|三种|常见|常用|基本|主要|最佳|最优|特殊|一个|一种|这个|那个|这些|那些|以下|下面|上面|其中|因此|所以|因为|由于|可以|需要|进行|使用|通过|根据|按照|对于|关于|满足|等于|称为|叫做|但是|然而|并且|或者|如果|虽然|尽管|即使|除非|一旦|则|即|是|为)/;

  for (const sent of sentences) {
    const idx = sent.indexOf(keyword);
    if (idx === -1) continue;

    // 提取 keyword 前后各 4 字以内的上下文
    const start = Math.max(0, idx - 4);
    const end = Math.min(sent.length, idx + keyword.length + 4);
    let phrase = sent.substring(start, end).trim();

    // 清理首尾的非中文/非字母数字字符
    phrase = phrase.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+$/, '');
    if (phrase.length < keyword.length) continue;

    // 基础质量检查
    if (/[+=<>^~，,、]/.test(phrase)) continue;
    if (MATH_SYMBOLS.test(phrase) || MATH_OPERATORS.test(phrase)) continue;
    if (HEADING_NUMBER_PATTERN.test(phrase)) continue;
    if (JUNK_WORDS.test(phrase)) continue;
    if (FRAGMENT_START_PATTERN.test(phrase)) continue;
    if (PHRASE_JUNK_UNIVERSAL.test(phrase)) continue;
    // ★ v2 新增：PDF 乱码/碎片化文本提前拦截，避免垃圾短语进入评分
    if (GARBAGE_CHAR.test(phrase)) continue;
    if (MOJIBAKE_PATTERN.test(phrase)) continue;
    if (PURE_NUMERIC_PATTERN.test(phrase)) continue;
    if (/[□◇◆★☆●○▲△▼▽■◀▶◇※]/.test(phrase)) continue;

    // 评分
    let score = 0;
    if (phrase.includes(keyword)) score += 2;
    const extraLen = phrase.length - keyword.length;
    if (extraLen >= 0 && extraLen <= 2) score += 3;
    else continue;
    if (phrase.length >= 4 && phrase.length <= 10) score += 2;
    else if (phrase.length > 10 && phrase.length <= 12) score += 1;
    // 通用学术后缀加分
    if (ACADEMIC_SUFFIX_UNIVERSAL.test(phrase)) score += 4;
    else score -= 2;
    if (/[的是为与]$/.test(phrase)) score -= 3;
    const firstTwo = phrase.substring(0, 2);
    if (!STOP_WORDS.has(firstTwo)) score += 1;
    else score -= 1;

    if (score > bestScore) {
      bestScore = score;
      bestPhrase = phrase;
    }
  }

  // 最终过滤：质量不过关则回退到 keyword
  if (bestPhrase.length < 2 || bestPhrase.length > 10) return keyword;
  if (bestPhrase.length > keyword.length + 2) return keyword;
  if (PHRASE_JUNK_UNIVERSAL.test(bestPhrase)) return keyword;
  if (/[的是为与]$/.test(bestPhrase)) return keyword;
  if (/[与或]/.test(bestPhrase)) return keyword;
  if (MATH_SYMBOLS.test(bestPhrase) || MATH_OPERATORS.test(bestPhrase) || /[+=<>^~，,、]/.test(bestPhrase)) return keyword;
  if (HEADING_NUMBER_PATTERN.test(bestPhrase) || JUNK_WORDS.test(bestPhrase) || FRAGMENT_START_PATTERN.test(bestPhrase)) return keyword;
  if (/[→←↔⇒⇐⇔\/\\]/.test(bestPhrase)) return keyword;
  if (/^[a-zA-Z]\s+/.test(bestPhrase)) return keyword;
  if (/[IVXivx]/.test(bestPhrase) && /\d/.test(bestPhrase)) return keyword;
  // ★ v2 新增：与 isGarbageEntity 保持一致的增强质量检查
  // 防止 PDF 提取的乱码/碎片化文本通过标签提炼进入节点
  if (GARBAGE_CHAR.test(bestPhrase)) return keyword;                       // 控制字符/替换符
  if (MOJIBAKE_PATTERN.test(bestPhrase)) return keyword;                   // Latin-1 误读乱码
  if (PURE_NUMERIC_PATTERN.test(bestPhrase)) return keyword;   // 纯数字/数字+符号
  if (isNumericDominant(bestPhrase)) return keyword;                        // 数字占主导的短碎片
  if (hasExcessiveRepetition(bestPhrase)) return keyword;                   // 重复字符过多
  if (/[□◇◆★☆●○▲△▼▽■◀▶◇※]/.test(bestPhrase)) return keyword;             // PDF 装饰符残留
  // 必须有通用学术后缀才允许替换
  if (!ACADEMIC_SUFFIX_UNIVERSAL.test(bestPhrase)) return keyword;

  return bestPhrase;
}

// ============ 8. ★ 新增：考题-教材句子级语义匹配 ============
// 不只匹配关键词，而是把考题与教材每个句子算TF-IDF相似度
function matchQuestionToSentences(question, sentences, tfidfModel, sentenceVectors) {
  // 把考题转为向量
  const qTokens = tokenize(question).filter(t => !STOP_WORDS.has(t) && t.length >= 2);
  const qTf = new Map();
  for (const t of qTokens) qTf.set(t, (qTf.get(t) || 0) + 1);
  const qVec = new Map();
  for (const [word, freq] of qTf) {
    const idfVal = tfidfModel.idf.get(word) || (Math.log((tfidfModel.N + 1) / 1.5) + 1);
    qVec.set(word, freq * idfVal);
  }

  // 计算考题与每个句子的相似度
  const scored = [];
  for (let i = 0; i < sentences.length; i++) {
    const sim = cosineSimilaritySparse(qVec, sentenceVectors[i]);
    if (sim > 0.05) {
      scored.push({ idx: i, sim, sentence: sentences[i] });
    }
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored.slice(0, 5); // 返回top5最相似句子
}

// ============ 9a. ★ 新增：模式匹配关系抽取 ============
// 从文本中提取显式关系，而非仅靠共现
// 支持的学术常见模式：
//   "A是B的C" → A--[is]--C, B--[of]--C
//   "A分为B和C" → A--[includes]--B, A--[includes]--C
//   "A包括B和C" → A--[includes]--B, A--[includes]--C
//   "A的B" → A--[of]--B
//   "A与B的关系" → A--[relates]--B
//   "A对B的C" → A--[of]--C, B--[of]--C
function extractPatternRelations(text, entitySet) {
  const relations = [];
  if (!text || entitySet.size === 0) return relations;
  
  // 将实体按长度排序（长实体优先匹配，避免"光"匹配到"光的折射"之前）
  const sortedEntities = [...entitySet].sort((a, b) => b.length - a.length);
  
  // 每段文字中出现的实体
  function findEntitiesInText(txt) {
    const found = new Set();
    for (const e of sortedEntities) {
      if (txt.includes(e)) found.add(e);
    }
    return found;
  }
  
  // 按句号/分号切分
  const clauses = text.split(/[。；;]/);
  
  for (const clause of clauses) {
    if (clause.length < 10) continue;
    
    // 模式1: "A是B的C" → A of C, B's C
    let m = clause.match(/([\u4e00-\u9fa5]{2,})是([\u4e00-\u9fa5]{1,10})的([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[2], c = m[3];
      if (entitySet.has(a) && entitySet.has(c)) 
        relations.push({ from: a, to: c, type: 'is', weight: 2.0, source: 'pattern:是...的' });
      if (entitySet.has(b) && entitySet.has(c) && b !== a)
        relations.push({ from: b, to: c, type: 'of', weight: 1.5, source: 'pattern:是...的' });
    }
    
    // 模式2: "A分为B和C" / "A分成B和C"
    m = clause.match(/([\u4e00-\u9fa5]{2,})分[为成]([\u4e00-\u9fa5]{2,})[和与、]([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[2], c = m[3];
      if (entitySet.has(a)) {
        if (entitySet.has(b)) relations.push({ from: a, to: b, type: 'includes', weight: 1.8, source: 'pattern:分为' });
        if (entitySet.has(c)) relations.push({ from: a, to: c, type: 'includes', weight: 1.8, source: 'pattern:分为' });
      }
    }
    
    // 模式3: "A包括B" / "A包含B" / "A含有B"
    m = clause.match(/([\u4e00-\u9fa5]{2,})(包括|包含|含有|由.+组成|由.+构成)([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[3];
      if (entitySet.has(a) && entitySet.has(b))
        relations.push({ from: a, to: b, type: 'includes', weight: 1.5, source: 'pattern:包含' });
    }
    
    // 模式4: "A与B的关系/区别/联系/比较/差异"
    m = clause.match(/([\u4e00-\u9fa5]{2,})与([\u4e00-\u9fa5]{2,})的(关系|区别|联系|比较|差异|异同|关联|相互作用|相互影响)/);
    if (m) {
      const a = m[1], b = m[2];
      if (entitySet.has(a) && entitySet.has(b))
        relations.push({ from: a, to: b, type: 'relates', weight: 2.0, source: 'pattern:与...的关系' });
    }
    
    // 模式5: "A对B的C" (如"光对眼睛的刺激")
    m = clause.match(/([\u4e00-\u9fa5]{2,})对([\u4e00-\u9fa5]{2,})的([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[2], c = m[3];
      if (entitySet.has(a) && entitySet.has(c))
        relations.push({ from: a, to: c, type: 'affects', weight: 1.5, source: 'pattern:对...的' });
      if (entitySet.has(b) && entitySet.has(c) && b !== a)
        relations.push({ from: b, to: c, type: 'of', weight: 1.2, source: 'pattern:对...的' });
    }
    
    // 模式6: "叫B做A" / "称B为A"
    m = clause.match(/([\u4e00-\u9fa5]{2,})是([\u4e00-\u9fa5]{2,})的简称/);
    if (m) {
      const a = m[1], b = m[2];
      if (entitySet.has(a) && entitySet.has(b))
        relations.push({ from: b, to: a, type: 'refers-to', weight: 1.5, source: 'pattern:的简称' });
    }
    
    // 模式7: "A叫作B" / "A称为B" / "A称为是B"
    m = clause.match(/([\u4e00-\u9fa5]{2,})(叫作|称为|称为是|名为|称做)([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[3];
      if (entitySet.has(a) && entitySet.has(b))
        relations.push({ from: a, to: b, type: 'also-known-as', weight: 1.5, source: 'pattern:称为' });
    }
    
    // 模式8: "根据A,B" / "由A可,B" 因果关系
    m = clause.match(/([\u4e00-\u9fa5]{2,})[，,]([\u4e00-\u9fa5]{2,})/);
    if (m) {
      const a = m[1], b = m[2];
      // 只保留句首实体 + 句尾实体 出现在同一短句中
      if (entitySet.has(a) && entitySet.has(b) && a !== b) {
        // 检查A,B均为实体且长度≥2
        // 因果连接词辅助判断
        if (/因|由|根据|按照|基于|通过|利用|使用|借助/.test(clause.substring(0, 6))) {
          relations.push({ from: a, to: b, type: 'enables', weight: 1.2, source: 'pattern:因果' });
        }
      }
    }
  }
  
  // 去重合并
  const seen = new Set();
  const unique = [];
  for (const r of relations) {
    const key = `${r.from}|||${r.to}|||${r.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  
  return unique;
}

// ============ 8b. 标题-段落偏移匹配辅助函数 ============
function findBestHeadingForOffset(items, offset) {
  function walk(nodes) {
    for (const node of nodes) {
      if (offset >= node.start && offset < node.end) {
        if (node.children && node.children.length > 0) {
          const childHit = walk(node.children);
          if (childHit) return childHit;
        }
        return node;
      }
    }
    return null;
  }
  return walk(items);
}

// ============ 9. 核心知识图谱生成函数 ============
// 改进：支持AI增强关键词提取（可选）
// 当 useAI=true 且 KSAIKeywords.isAIEnabled() 时，使用AI提取关键词
// 新增：headings 参数传入层级标题，构建骨架型知识图谱
async function buildKnowledgeGraph(textbookText, examQuestions = [], options = {}) {
  const { useAI = false, onProgress = null, seedTerms = null, headings = null, signal = null, docId = null } = options;
  const nodes = [];
  const edges = [];
  const startTime = Date.now();
  const MAX_NODES = 80; // ★ 限制最大节点数，避免性能问题

  // ★ AbortSignal 支持：超时或取消后提前返回，避免后台继续消耗 CPU/内存
  function checkAborted() {
    if (signal && signal.aborted) {
      throw new Error('知识图谱构建已被取消（超时或外部中止）');
    }
  }

  try {
    // ---------- Step 1: 段落切分（保留页码） ----------
    if (onProgress) onProgress('段落切分中...');
    const paragraphs = splitParagraphs(textbookText);
    if (paragraphs.length === 0) {
      return { nodes, edges, communities: [], stats: { error: 'No paragraphs' } };
    }

    const docs = paragraphs.map((p, i) => ({
      id: `p${i}`,
      text: p.text,
      pages: p.pages || []
    }));

    // ---------- Step 2: 关键词抽取（种子术语 / 本地TextRank / AI增强） ----------
    checkAborted();
    let globalKeywords = [];
    let aiKeywords = null;
    let usedAI = false;

    const minSeedTerms = options.minSeedTerms ?? 5;
    const seedTermsSufficient = seedTerms && seedTerms.length >= minSeedTerms;

    if (seedTerms && seedTerms.length > 0) {
      // 使用外部传入的种子术语作为核心关键词
      // ★ 注意：usedAI 不应仅因 seedTerms 存在就置为 true，
      // 它只反映本次 buildKnowledgeGraph 是否真正调用了 AI。
      if (onProgress) onProgress('正在使用模型抽取的关键术语...');
      globalKeywords = seedTerms.map((t, i) => ({
        word: t.term,
        score: t.score || Math.max(1, seedTerms.length - i),
        specificity: t.specificity,
        isGeneric: t.isGeneric
      }));
    } else {
      // ★ 浏览器全局通过 typeof guard 访问，Node 环境下为 null，自动回退到本地 TextRank
      const KSAIKeywords = (typeof window !== 'undefined') ? window.KSAIKeywords : null;
      if (useAI && KSAIKeywords && KSAIKeywords.isAIEnabled()) {
        try {
          if (onProgress) onProgress('正在使用AI提取关键词...');
          aiKeywords = await KSAIKeywords.extractKeywordsWithAI(
            textbookText, 40,
            textbookText.substring(0, 200)
          );
          globalKeywords = aiKeywords.map(k => ({
            word: k.word,
            score: k.score,
            type: k.type,
            explanation: k.explanation
          }));
          usedAI = true;
          if (onProgress) onProgress('AI关键词提取完成...');
        } catch (e) {
          console.warn('AI关键词提取失败，回退到本地TextRank:', e.message);
          const errMsg = e.message || '';
          let userMsg = errMsg;
          // 检测CORS相关错误，给出明确提示
          if (errMsg.includes('CORS') || errMsg.includes('cors') || errMsg.includes('浏览器跨域')) {
            userMsg = '浏览器跨域限制(CORS)，请在AI设置中勾选"使用CORS代理"。已回退到本地算法。';
          } else if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
            userMsg = '网络请求失败，可能由于CORS跨域限制。请在AI设置中启用CORS代理。已回退到本地算法。';
          }
          if (onProgress) onProgress(`AI提取失败: ${userMsg}`);
          globalKeywords = textRankKeywords(textbookText, 40);
        }
      } else {
        if (onProgress) onProgress('正在提取关键词（本地TextRank）...');
        globalKeywords = textRankKeywords(textbookText, 40);
      }
    }
    const entitySet = new Set(globalKeywords.map(k => k.word));
    const seedMetaMap = new Map();
    for (const k of globalKeywords) {
      if (k.specificity !== undefined || k.isGeneric !== undefined) {
        seedMetaMap.set(k.word, { specificity: k.specificity, isGeneric: k.isGeneric });
      }
    }

    // ---------- Step 3: 每个段落抽取局部关键词 ----------
    checkAborted();
    // 只有传入足够多高质量种子术语时，才跳过段落噪声扩展；否则保留扩展以补充实体覆盖
    const paraKeywords = new Map();
    if (seedTermsSufficient) {
      if (onProgress) onProgress('使用种子术语，跳过段落噪声扩展...');
      for (const doc of docs) {
        paraKeywords.set(doc.id, []);
      }
    } else {
      if (onProgress) onProgress('提取段落关键词...');
      for (const doc of docs) {
        const kws = textRankKeywords(doc.text, 10);
        paraKeywords.set(doc.id, kws);
        for (const k of kws) entitySet.add(k.word);
      }
    }

    // ---------- Step 4: 构建TF-IDF模型 ----------
    checkAborted();
    if (onProgress) onProgress('构建TF-IDF模型...');
    const tfidfModel = buildTfIdf(docs);
    const paraVectors = new Map();
    for (const doc of docs) {
      paraVectors.set(doc.id, docToVector(doc.id, tfidfModel));
    }

    // ---------- Step 5: 实体节点构建 + 小标题提炼 ----------
    if (onProgress) onProgress('构建实体节点...');
    const entityScores = new Map();
    for (const kw of globalKeywords) {
      entityScores.set(kw.word, { textrank: kw.score, df: 0, total: 0 });
    }
    for (const [pid, kws] of paraKeywords) {
      for (const k of kws) {
        if (!entityScores.has(k.word)) {
          entityScores.set(k.word, { textrank: k.score, df: 0, total: 0 });
        }
      }
    }

    const entityParas = new Map();
    for (const doc of docs) {
      const tokens = new Set(tokenize(doc.text).filter(t => !STOP_WORDS.has(t)));
      for (const entity of entitySet) {
        if (doc.text.includes(entity) || tokens.has(entity)) {
          if (!entityParas.has(entity)) entityParas.set(entity, new Set());
          entityParas.get(entity).add(doc.id);
          const s = entityScores.get(entity);
          if (s) s.df++;
        }
      }
    }

    for (const [entity, s] of entityScores) {
      s.total = s.textrank * (1 + Math.log(s.df + 1));
    }

    // ★ 最终实体质量过滤：再次剔除标题片段、公式残留、断词等
    const validEntities = [...entityScores.entries()]
      .filter(([word, s]) => s.df >= 1 && s.total > 0)
      .filter(([word]) => !isGarbageEntity(word))
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, MAX_NODES); // ★ 限制最大节点数

    // ★★★ 跨实体碎片抑制（v2 新增）★★★
    // 解决 n-gram 分词和 AI/种子术语产生的碎片化实体问题：
    //   "卷积神经" → 被 "卷积神经网络" 抑制
    //   "深度神"   → 被 "深度神经网络" 抑制
    //   "经网络"   → 被 "深度神经网络" 抑制
    // 抑制条件（全部满足才抑制，避免误伤合法独立术语）：
    //   1. 碎片是某个更长实体的子串/前缀/后缀（prefix/suffix/infix 均覆盖，前缀/后缀匹配要求碎片长度>=3）
    //   2. 长度差 <= 4（避免 "网络" 被 "卷积神经网络" 过度抑制）
    //   3. 更长实体得分 >= 碎片得分的 30%（保证更长术语同样重要）
    //   4. 碎片本身没有学术后缀（如"定律/模型/方法"等，有后缀的通常是合法独立术语）
    //   5. 碎片不是其他更短实体的超串（避免抑制中间层术语，如"神经网络"若"网络"也存在）
    //      —— 仅当碎片本身也是某更短实体的超串时，认为它是合法的中间层术语，予以保留
    {
      const suppressed = new Set();
      for (let i = 0; i < validEntities.length; i++) {
        const [word, s] = validEntities[i];
        if (suppressed.has(word)) continue;
        // 条件5预检：如果当前词是其他更短实体的超串，跳过（它是中间层术语）
        let isIntermediateTerm = false;
        for (let k = 0; k < validEntities.length; k++) {
          if (k === i) continue;
          const otherWord = validEntities[k][0];
          if (otherWord.length < word.length && word.includes(otherWord) && (word.length - otherWord.length) <= 3) {
            isIntermediateTerm = true;
            break;
          }
        }
        if (isIntermediateTerm) continue;
        // 检查是否是某个更长实体的碎片
        for (let j = 0; j < validEntities.length; j++) {
          if (i === j) continue;
          const [longerWord, longerS] = validEntities[j];
          if (longerWord.length <= word.length) continue;
          // 检查是否是更长实体的子串（包括精确子串和前缀/后缀匹配）
          const isSubstring = longerWord.includes(word);
          const isPrefixMatch = longerWord.startsWith(word) && word.length >= 3;
          const isSuffixMatch = longerWord.endsWith(word) && word.length >= 3;
          if ((isSubstring || isPrefixMatch || isSuffixMatch)
              && (longerWord.length - word.length) <= 4
              && longerS.total >= s.total * 0.3
              && !ACADEMIC_SUFFIXES.test(word)) {
            suppressed.add(word);
            break;
          }
        }
      }
      if (suppressed.size > 0) {
        // 原地替换 validEntities，移除被抑制的碎片
        const filtered = validEntities.filter(([w]) => !suppressed.has(w));
        validEntities.length = 0;
        validEntities.push(...filtered);
      }
    }

    // ---------- Step 5b: 标题骨架节点（如果传入了 headings） ----------
    checkAborted();
    const headingNodeMap = new Map(); // headingId -> nodeId
    const headingEntityLinks = [];    // { headingId, entity }
    const headingColors = [
      '#00eaff', '#a855f7', '#ffb84d', '#34d399', '#f472b6',
      '#60a5fa', '#fb923c', '#a3e635', '#fbbf24', '#22d3ee'
    ];
    if (headings && Array.isArray(headings) && headings.length > 0) {
      if (onProgress) onProgress('构建标题层级骨架...');
      let headingIndex = 0;
      function walkHeadingTree(items, parentId = null) {
        for (const item of items) {
          const nodeId = `h_${item.id}`;
          headingNodeMap.set(item.id, nodeId);
          nodes.push({
            id: nodeId,
            label: item.title,
            type: 'heading',
            level: item.level,
            page: item.page,
            start: item.start,
            end: item.end,
            source: { docId, page: item.page || 0, start: item.start || 0, end: item.end || 0, sectionId: item.id },
            weight: 5 - (item.level || 1), // 高层级权重更高
            color: headingColors[headingIndex % headingColors.length],
            size: 18 - (item.level || 1) * 3,
            x: 0, y: 0
          });
          headingIndex++;
          if (parentId) {
            edges.push({ from: parentId, to: nodeId, type: 'hierarchy', weight: 3 });
          }
          if (item.children && item.children.length > 0) {
            walkHeadingTree(item.children, nodeId);
          }
        }
      }
      walkHeadingTree(headings);

      // 建立实体与标题的归属关系：实体出现的位置落在哪个标题范围
      // 改进：用实体关键词在全文正文中的位置（跳过目录区域），而非首次出现
      // 因为首次出现可能在目录中，目录不在任何 heading 范围内
      for (const [entity, s] of validEntities) {
        // 方案1：找实体在全文中第一个落在 heading 范围内的出现位置
        let bestHeading = null;
        let searchFrom = 0;
        for (let attempt = 0; attempt < 10 && !bestHeading; attempt++) {
          const offset = textbookText.indexOf(entity, searchFrom);
          if (offset < 0) break;
          bestHeading = findBestHeadingForOffset(headings, offset);
          searchFrom = offset + 1;
        }
        if (bestHeading) {
          headingEntityLinks.push({ headingId: bestHeading.id, entity });
          continue;
        }
        // 方案2：回退到段落位置匹配
        const paras = entityParas.get(entity);
        if (!paras || paras.size === 0) continue;
        const firstParaId = [...paras][0];
        const para = docs.find(d => d.id === firstParaId);
        if (!para) continue;
        const paraStart = textbookText.indexOf(para.text.slice(0, 40));
        if (paraStart < 0) continue;
        const fallbackHeading = findBestHeadingForOffset(headings, paraStart);
        if (fallbackHeading) {
          headingEntityLinks.push({ headingId: fallbackHeading.id, entity });
        }
      }
    }

    const entityNodeMap = new Map();
    const seenLabels = new Set(); // ★ 按最终标签去重，避免“随机过程/独立”都扩展成同一标签
    for (const [entity, s] of validEntities) {
      const phraseLabel = extractPhraseLabel(entity, textbookText);
      const normalizedLabel = phraseLabel.toLowerCase().replace(/\s+/g, '');
      if (seenLabels.has(normalizedLabel)) {
        continue;
      }
      seenLabels.add(normalizedLabel);
      const nodeId = `e_${entity}`;
      entityNodeMap.set(entity, nodeId);
      const entityPages = [...new Set([...(entityParas.get(entity) || [])].flatMap(pid => {
        const doc = docs.find(d => d.id === pid);
        return doc ? doc.pages : [];
      }))];
      // 计算实体在原文正文中的首次出现偏移（跳过目录区域），用于 docx/markdown 等可滚动文档精确定位
      // 与 heading-entity 关联逻辑保持一致：找第一个落在 heading 范围内的出现位置
      let entityStart = -1;
      {
        let searchFrom = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
          const offset = textbookText.indexOf(entity, searchFrom);
          if (offset < 0) break;
          const heading = findBestHeadingForOffset(headings, offset);
          if (heading) { entityStart = offset; break; }
          searchFrom = offset + 1;
        }
      }
      // 回退1：短语标签
      if (entityStart < 0 && phraseLabel && phraseLabel !== entity) {
        let searchFrom = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
          const offset = textbookText.indexOf(phraseLabel, searchFrom);
          if (offset < 0) break;
          const heading = findBestHeadingForOffset(headings, offset);
          if (heading) { entityStart = offset; break; }
          searchFrom = offset + 1;
        }
      }
      // 回退2：段落首位置
      if (entityStart < 0) {
        const paras = entityParas.get(entity);
        if (paras && paras.size > 0) {
          const firstParaId = [...paras][0];
          const para = docs.find(d => d.id === firstParaId);
          if (para) {
            const paraOffset = textbookText.indexOf(para.text.slice(0, 40));
            if (paraOffset >= 0) entityStart = paraOffset;
          }
        }
      }
      // 回退3：无 heading 时的首次出现
      if (entityStart < 0) {
        entityStart = textbookText.indexOf(entity);
        if (entityStart < 0) entityStart = textbookText.indexOf(phraseLabel);
      }
      const seedMeta = seedMetaMap.get(entity) || {};
      const meta = {};
      if (seedMeta.specificity !== undefined) meta.specificity = seedMeta.specificity;
      if (seedMeta.isGeneric !== undefined) meta.isGeneric = seedMeta.isGeneric;
      nodes.push({
        id: nodeId,
        label: phraseLabel,
        keyword: entity,
        type: 'entity',
        weight: s.total,
        textrank: s.textrank,
        df: s.df,
        paragraphs: [...(entityParas.get(entity) || [])],
        pages: entityPages,
        source: { docId, page: entityPages.length > 0 ? entityPages[0] : 1, start: Math.max(0, entityStart) },
        size: 0,
        x: 0, y: 0,
        meta: Object.keys(meta).length > 0 ? meta : undefined
      });

      // 如果实体属于某个标题，建立 heading -> entity 边
      const link = headingEntityLinks.find(l => l.entity === entity);
      if (link) {
        const headingNodeId = headingNodeMap.get(link.headingId);
        if (headingNodeId) {
          edges.push({ from: headingNodeId, to: nodeId, type: 'contains', weight: 1.5 });
        }
      }
    }

  // ---------- Step 6: 关系抽取（模式匹配 + 共现补全） ----------
  checkAborted();
  if (onProgress) onProgress('抽取实体关系（模式匹配+共现分析）...');
  
  // 6a. 模式匹配关系（精确提取显式关系）
  const patternRelations = extractPatternRelations(textbookText, entityNodeMap);
  
  for (const pr of patternRelations) {
    const id1 = entityNodeMap.get(pr.from);
    const id2 = entityNodeMap.get(pr.to);
    if (id1 && id2) {
      edges.push({
        from: id1, to: id2,
        type: pr.type,
        weight: pr.weight,
        source: pr.source
      });
    }
  }

  // 6b. 共现关系（补全模式匹配未覆盖的关系，限制计算量）
  // ★ 性能保护：限制处理的句子数 + 实体数
  const MAX_COOCCUR_SENTENCES = 300;  // 最多处理300个句子
  const entityList = [...entityNodeMap.keys()];
  const entityNameSet = new Set(entityList);
  const cooccurrenceMap = new Map();
  let processedSentences = 0;
  
  for (const doc of docs) {
    const sentences = splitSentences(doc.text);
    for (const sent of sentences) {
      if (processedSentences >= MAX_COOCCUR_SENTENCES) break;
      processedSentences++;
      
      // ★ 优化：只检查实体列表（用set.has替换includes）
      // 先用includes快速筛查，避免set.has对大量实体调用
      const sentEntities = [];
      for (const entity of entityList) {
        if (sent.includes(entity)) {
          sentEntities.push(entity);
        }
      }
      // 如果实体太多，只取前10个
      if (sentEntities.length > 10) {
        // 保留最长的实体（短实体通常为噪音）
        sentEntities.sort((a, b) => b.length - a.length);
        sentEntities.length = 10;
      }
      for (let i = 0; i < sentEntities.length; i++) {
        for (let j = i + 1; j < sentEntities.length; j++) {
          const e1 = sentEntities[i];
          const e2 = sentEntities[j];
          if (e1 === e2) continue;
          const key = e1 < e2 ? `${e1}|||${e2}` : `${e2}|||${e1}`;
          cooccurrenceMap.set(key, (cooccurrenceMap.get(key) || 0) + 1);
        }
      }
    }
    if (processedSentences >= MAX_COOCCUR_SENTENCES) break;
  }

  for (const [key, count] of cooccurrenceMap) {
    const [e1, e2] = key.split('|||');
    const id1 = entityNodeMap.get(e1);
    const id2 = entityNodeMap.get(e2);
    if (!id1 || !id2) continue;
    edges.push({
      from: id1, to: id2,
      type: 'co-occurrence',
      weight: Math.min(count, 5),  // 权重上限，避免个别边过大
      source: 'sentence'
    });
  }

  // ---------- Step 7: 段落语义相似关系（已由模式+共现覆盖，减少冗余） ----------
  if (onProgress) onProgress('补充语义关联...');
  const SIM_THRESHOLD = 0.20;  // ★ 提高阈值，减少噪音
  const MAX_PARAGRAPH_PAIRS = 200; // ★ 限制计算量
  let paraPairsChecked = 0;
  
  for (let i = 0; i < docs.length && paraPairsChecked < MAX_PARAGRAPH_PAIRS; i++) {
    for (let j = i + 1; j < docs.length && paraPairsChecked < MAX_PARAGRAPH_PAIRS; j++) {
      paraPairsChecked++;
      const sim = cosineSimilaritySparse(paraVectors.get(docs[i].id), paraVectors.get(docs[j].id));
      if (sim > SIM_THRESHOLD) {
        const kws1 = new Set((paraKeywords.get(docs[i].id) || []).map(k => k.word));
        const kws2 = new Set((paraKeywords.get(docs[j].id) || []).map(k => k.word));
        const shared = [...kws1].filter(k => kws2.has(k));
        if (shared.length === 0) {
          const top1 = (paraKeywords.get(docs[i].id) || [])[0];
          const top2 = (paraKeywords.get(docs[j].id) || [])[0];
          if (top1 && top2) {
            const id1 = entityNodeMap.get(top1.word);
            const id2 = entityNodeMap.get(top2.word);
            if (id1 && id2 && id1 !== id2) {
              edges.push({
                from: id1, to: id2,
                type: 'semantic',
                weight: sim,
                source: 'paragraph-similarity'
              });
            }
          }
        }
      }
    }
  }

  // ---------- Step 7b: L1 标题之间相关性连线（基于子级共享关系推断） ----------
  // 用户要求："检测到他们本身或者他们下面的次级次次级之间有关系就需要在他们之间连线"
  // 算法：收集每个 L1 heading 的子树（L2/L3 heading + 归属 entity），
  //       若两个 L1 的子树有共享 entity 或子级之间有 co-occurrence 边，则在 L1 之间建 cross-link 边
  if (headings && Array.isArray(headings) && headings.length > 0 && headingNodeMap.size > 0) {
    if (onProgress) onProgress('推断 L1 标题相关性...');

    // 1. 收集每个 heading 的子树（递归）
    // headingId -> { nodeId, level, childHeadingIds: Set, entityIds: Set }
    const headingSubtree = new Map();

    // 递归收集子标题
    function collectChildHeadings(items, rootId) {
      for (const item of items || []) {
        const childNodeId = `h_${item.id}`;
        if (childNodeId !== rootId) {
          const sub = headingSubtree.get(rootId);
          if (sub) sub.childHeadingIds.add(childNodeId);
        }
        if (item.children && item.children.length > 0) {
          collectChildHeadings(item.children, rootId);
        }
      }
    }

    // 初始化所有 heading 的子树
    for (const [headingId, nodeId] of headingNodeMap) {
      headingSubtree.set(nodeId, { nodeId, headingId, childHeadingIds: new Set(), entityIds: new Set() });
    }

    // 递归收集每个 heading 的子标题（从树结构）
    for (const root of headings) {
      const rootNodeId = `h_${root.id}`;
      const sub = headingSubtree.get(rootNodeId);
      if (sub && root.children) {
        collectChildHeadings(root.children, rootNodeId);
      }
    }

    // 收集每个 heading 直接归属的 entity（通过 headingEntityLinks）
    for (const link of headingEntityLinks) {
      const nodeId = headingNodeMap.get(link.headingId);
      const entityId = entityNodeMap.get(link.entity);
      if (nodeId && entityId) {
        const sub = headingSubtree.get(nodeId);
        if (sub) sub.entityIds.add(entityId);
      } else {
        if (!nodeId) console.warn(`[KG] headingId ${link.headingId} 不在节点映射中`);
      }
    }

    // 递归收集子树的所有 entity（包括子标题的 entity）
    function collectSubtreeEntities(nodeId, visited = new Set()) {
      if (visited.has(nodeId)) return new Set();
      visited.add(nodeId);
      const sub = headingSubtree.get(nodeId);
      if (!sub) return new Set();
      const allEntities = new Set(sub.entityIds);
      for (const childId of sub.childHeadingIds) {
        const childEntities = collectSubtreeEntities(childId, visited);
        for (const e of childEntities) allEntities.add(e);
      }
      return allEntities;
    }

    // 改进：对于 subtreeEntities 为 0 的 L1，直接用 L1 的扩展范围找 entity
    // L1 的扩展范围 = L1.start 到下一个同级 L1 的 start（覆盖所有子标题内容）
    const l1NodesOrdered = [];
    for (const [nodeId, sub] of headingSubtree) {
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.level === 1) {
        l1NodesOrdered.push({ nodeId, sub, start: node.start || 0, end: node.end || 0 });
      }
    }
    l1NodesOrdered.sort((a, b) => a.start - b.start);
    // 计算每个 L1 的扩展 end（到下一个 L1 的 start）
    for (let i = 0; i < l1NodesOrdered.length; i++) {
      const next = l1NodesOrdered[i + 1];
      l1NodesOrdered[i].expandedEnd = next ? next.start : textbookText.length;
    }

    for (const l1 of l1NodesOrdered) {
      const allEntities = collectSubtreeEntities(l1.nodeId);
      if (allEntities.size === 0 && l1.expandedEnd > l1.start) {
        // 用 L1 的扩展范围找 entity
        for (const [entity, entityId] of entityNodeMap) {
          const offset = textbookText.indexOf(entity, l1.start);
          if (offset >= 0 && offset < l1.expandedEnd) {
            l1.sub.entityIds.add(entityId);
          }
        }
      }
    }

    // 2. 找出所有 L1 heading（level === 1）
    const l1Headings = [];
    for (const [nodeId, sub] of headingSubtree) {
      // 通过 nodes 数组找到 level
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.level === 1) {
        l1Headings.push({ nodeId, sub, allEntities: collectSubtreeEntities(nodeId) });
      }
    }

    // 3. 对每对 L1 计算子树交集
    const existingEdges = new Set();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join('|||');
      existingEdges.add(key);
    }

    for (let i = 0; i < l1Headings.length; i++) {
      for (let j = i + 1; j < l1Headings.length; j++) {
        const a = l1Headings[i];
        const b = l1Headings[j];

        // 跳过自身
        if (a.nodeId === b.nodeId) continue;

        // 计算共享 entity 数量
        let sharedEntityCount = 0;
        for (const e of a.allEntities) {
          if (b.allEntities.has(e)) sharedEntityCount++;
        }

        // 计算子级 heading 之间的 co-occurrence 边数量
        // 改进：不仅检查子级 heading，还检查子树中的 entity 之间的 co-occurrence 边
        let childCoOccurCount = 0;
        for (const e of edges) {
          if (e.type !== 'co-occurrence' && e.type !== 'semantic') continue;
          // 检查边的两端是否分别属于两个 L1 的子树
          const aHasFrom = a.sub.childHeadingIds.has(e.from) || a.allEntities.has(e.from);
          const bHasTo = b.sub.childHeadingIds.has(e.to) || b.allEntities.has(e.to);
          const aHasTo = a.sub.childHeadingIds.has(e.to) || a.allEntities.has(e.to);
          const bHasFrom = b.sub.childHeadingIds.has(e.from) || b.allEntities.has(e.from);
          if ((aHasFrom && bHasTo) || (aHasTo && bHasFrom)) {
            childCoOccurCount++;
          }
        }

        // 改进：还检查 entity 共现（不依赖 heading 归属）
        // 如果两个 L1 的标题文本中包含相同的关键词，也认为相关
        const aNode = nodes.find(n => n.id === a.nodeId);
        const bNode = nodes.find(n => n.id === b.nodeId);
        let titleSharedKw = 0;
        if (aNode?.label && bNode?.label) {
          // 提取标题中的关键词（3字以上的中文片段，避免2字通用词导致过度连线）
          const aKws = new Set((aNode.label.match(/[\u4e00-\u9fa5]{3,}/g) || []));
          const bKws = (bNode.label.match(/[\u4e00-\u9fa5]{3,}/g) || []);
          for (const kw of bKws) {
            if (aKws.has(kw)) titleSharedKw++;
          }
        }

        // 连线条件：共享 >=1 个 entity，或子级之间有 >=1 条关系边，或标题共享关键词
        const shouldLink = sharedEntityCount >= 1 || childCoOccurCount >= 1 || titleSharedKw >= 1;
        if (!shouldLink) continue;

        // 避免重复边
        const edgeKey = [a.nodeId, b.nodeId].sort().join('|||');
        if (existingEdges.has(edgeKey)) continue;
        existingEdges.add(edgeKey);

        const weight = Math.min(1 + sharedEntityCount * 0.5 + childCoOccurCount * 0.3, 5);
        edges.push({
          from: a.nodeId,
          to: b.nodeId,
          type: 'cross-link',
          weight,
          source: 'heading-relation-infer'
        });
      }
    }
  }

  // ---------- Step 8: ★ 考题-实体关联（句子级语义匹配） ----------
  checkAborted();
  if (onProgress) onProgress('处理考题关联...');
  // 准备所有句子及其向量
  const allSentences = [];
  const allSentenceVectors = [];
  for (const doc of docs) {
    const sents = splitSentences(doc.text);
    for (const s of sents) {
      allSentences.push(s);
      const sTf = new Map();
      const sTokens = tokenize(s).filter(t => !STOP_WORDS.has(t) && t.length >= 2);
      for (const t of sTokens) sTf.set(t, (sTf.get(t) || 0) + 1);
      const sVec = new Map();
      for (const [word, freq] of sTf) {
        const idfVal = tfidfModel.idf.get(word) || (Math.log((tfidfModel.N + 1) / 1.5) + 1);
        sVec.set(word, freq * idfVal);
      }
      allSentenceVectors.push(sVec);
    }
  }

  for (let qi = 0; qi < examQuestions.length; qi++) {
    if (qi % 5 === 0 && onProgress) {
      onProgress(`处理考题关联 (${qi + 1}/${examQuestions.length})...`);
    }
    const q = examQuestions[qi];
    const qText = typeof q === 'string' ? q : (q.content || q.question || '');
    if (!qText) continue;

    // 用句子级语义匹配找相关句子
    const matchedSentences = matchQuestionToSentences(qText, allSentences, tfidfModel, allSentenceVectors);

    const qNode = {
      id: `q_${qi}`,
      label: `Q${qi + 1}`,
      type: 'question',
      weight: 1,
      size: 14,
      color: '#ff6b6b',
      question: qText,
      matchedSentences: matchedSentences.map(m => ({
        sentence: m.sentence.substring(0, 80),
        similarity: parseFloat(m.sim.toFixed(3))
      })),
      x: 0, y: 0
    };
    nodes.push(qNode);

    // 从匹配句子中抽取实体连接（主要来源）
    // 收集候选连接及其权重，后续按权重排序截断
    const candidateConnections = new Map(); // entity -> maxSim
    for (const m of matchedSentences) {
      for (const entity of entityNodeMap.keys()) {
        if (m.sentence.includes(entity)) {
          const prev = candidateConnections.get(entity) || 0;
          if (m.sim > prev) candidateConnections.set(entity, m.sim);
        }
      }
    }

    // 补充：考题关键词直接匹配实体（仅当句子匹配不足时）
    const qKeywords = textRankKeywords(qText, 8);
    if (candidateConnections.size < 3) {
      for (const qk of qKeywords) {
        if (entityNodeMap.has(qk.word)) {
          const prev = candidateConnections.get(qk.word) || 0;
          const w = qk.score * 0.5;
          if (w > prev) candidateConnections.set(qk.word, w);
        } else {
          // 模糊匹配
          for (const entity of entityNodeMap.keys()) {
            if (entity.includes(qk.word) || qk.word.includes(entity)) {
              const prev = candidateConnections.get(entity) || 0;
              const w = qk.score * 0.5;
              if (w > prev) candidateConnections.set(entity, w);
              break;
            }
          }
        }
      }
    }

    // 按权重排序，只保留top 8个最相关的实体连接（避免噪音）
    const sortedConnections = [...candidateConnections.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // 建立考题-实体边
    for (const [entity, sim] of sortedConnections) {
      const entityId = entityNodeMap.get(entity);
      if (!entityId) continue;
      edges.push({
        from: qNode.id, to: entityId,
        type: 'examines',
        weight: Math.max(0.15, sim),
        source: 'sentence-semantic'
      });
    }
    qNode.weight = sortedConnections.length;
  }

  // ---------- Step 9: PageRank 找核心节点 ----------
    checkAborted();
    if (onProgress) onProgress('计算节点重要性...');
    const prScores = pageRank(nodes, edges, 0.85, 30);
    let maxPr = 0;
    for (const v of prScores.values()) if (v > maxPr) maxPr = v;
    for (const node of nodes) {
      if (node.type === 'entity') {
        const pr = prScores.get(node.id) || 0;
        node.pagerank = pr;
        const normalizedPr = maxPr > 0 ? pr / maxPr : 0;
        node.size = 8 + normalizedPr * 22;
        node.isHub = normalizedPr > 0.5;
      } else if (node.type === 'heading') {
        // 标题节点不参与 PageRank 大小重算，保持层级大小
        node.pagerank = prScores.get(node.id) || 0;
      }
    }

    // ---------- Step 10: 社区发现 ----------
    checkAborted();
    if (onProgress) onProgress('社区发现...');
    const communities = detectCommunities(nodes, edges);
    for (const node of nodes) {
      // 记录社区 ID 供后续分析使用，但不再硬编码颜色；
      // 颜色由前端根据文档 ID 统一分配，满足"同一文档同色"的需求
      const cid = communities.get(node.id) || 0;
      node.community = cid;
    }

    // ---------- Step 11: 力导向布局（带性能监控） ----------
    checkAborted();
    if (onProgress) onProgress('布局计算...');
    // 根据节点数量动态调整迭代次数，避免卡死
    const layoutIterations = Math.min(300, Math.max(100, nodes.length * 3));
    forceDirectedLayout(nodes, edges, {
      iterations: layoutIterations,
      idealDistance: 140,
      repulsion: 25000,
      attraction: 0.04,
      centerForce: 0.0008,
      damping: 0.88,
      minNodeDistance: 80,
      hubRepulsion: 3.0
    });

    // ---------- Step 12: 统计信息 ----------
    const totalTime = Date.now() - startTime;
    const stats = {
      paragraphs: paragraphs.length,
      entities: nodes.filter(n => n.type === 'entity').length,
      questions: nodes.filter(n => n.type === 'question').length,
      edges: edges.length,
      cooccurrenceEdges: edges.filter(e => e.type === 'co-occurrence').length,
      semanticEdges: edges.filter(e => e.type === 'semantic').length,
      examinesEdges: edges.filter(e => e.type === 'examines').length,
      communities: new Set(communities.values()).size,
      avgDegree: (edges.length * 2 / Math.max(1, nodes.length)).toFixed(2),
      usedAI: usedAI,
      aiKeywordCount: aiKeywords ? aiKeywords.length : 0,
      headingNodes: nodes.filter(n => n.type === 'heading').length,
      totalTime: totalTime.toFixed(0) + 'ms'
    };

    return { nodes, edges, communities, stats };

  } catch (e) {
    console.error('[KG] 知识图谱构建异常:', e);
    const totalTime = Date.now() - startTime;
    return { 
      nodes, 
      edges, 
      communities: [], 
      stats: { 
        error: e.message, 
        totalTime: totalTime.toFixed(0) + 'ms',
        entities: nodes.length,
        edges: edges.length
      } 
    };
  }
}

// ============ 10. PageRank 算法 ============
function pageRank(nodes, edges, d = 0.85, iterations = 30) {
  const scores = new Map();
  const outDeg = new Map();
  const inLinks = new Map();

  for (const node of nodes) {
    scores.set(node.id, 1 / nodes.length);
    outDeg.set(node.id, 0);
    inLinks.set(node.id, []);
  }

  // 无向边类型：双向建立出度与入链；有向边仅 from→to
  // UNDIRECTED_TYPES 已从 edge.js 导入
  for (const edge of edges) {
    const w = edge.weight || 1;
    outDeg.set(edge.from, (outDeg.get(edge.from) || 0) + w);
    inLinks.get(edge.to).push({ from: edge.from, weight: w });
    if (UNDIRECTED_TYPES.has(edge.type)) {
      outDeg.set(edge.to, (outDeg.get(edge.to) || 0) + w);
      inLinks.get(edge.from).push({ from: edge.to, weight: w });
    }
  }

  for (let it = 0; it < iterations; it++) {
    const newScores = new Map();
    let danglingSum = 0;
    for (const node of nodes) {
      if ((outDeg.get(node.id) || 0) === 0) {
        danglingSum += scores.get(node.id);
      }
    }

    for (const node of nodes) {
      let sum = 0;
      const links = inLinks.get(node.id);
      for (const link of links) {
        const deg = outDeg.get(link.from) || 0;
        if (deg > 0) {
          sum += (scores.get(link.from) || 0) * link.weight / deg;
        }
      }
      sum += danglingSum / nodes.length;
      newScores.set(node.id, (1 - d) / nodes.length + d * sum);
    }

    for (const [k, v] of newScores) scores.set(k, v);
  }

  return scores;
}

// ============ 11. 社区发现（标签传播算法） ============
// Fisher-Yates 均匀洗牌，替代 sort(() => Math.random() - 0.5) 的有偏排序
function fisherYatesShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function detectCommunities(nodes, edges) {
  const community = new Map();
  const adj = new Map();

  for (const node of nodes) {
    community.set(node.id, node.id);
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    const w = edge.weight || 1;
    adj.get(edge.from).push({ neighbor: edge.to, weight: w });
    adj.get(edge.to).push({ neighbor: edge.from, weight: w });
  }

  const maxIter = 50;
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    const order = fisherYatesShuffle([...community.keys()]);
    for (const nodeId of order) {
      const neighbors = adj.get(nodeId);
      if (neighbors.length === 0) continue;

      const commWeight = new Map();
      for (const { neighbor, weight } of neighbors) {
        const c = community.get(neighbor);
        commWeight.set(c, (commWeight.get(c) || 0) + weight);
      }

      let bestComm = community.get(nodeId);
      let bestWeight = 0;
      for (const [c, w] of commWeight) {
        // 随机打破平局，避免字符串序比较导致的偏差
        if (w > bestWeight || (w === bestWeight && Math.random() < 0.5)) {
          bestWeight = w;
          bestComm = c;
        }
      }

      if (bestComm !== community.get(nodeId)) {
        community.set(nodeId, bestComm);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 重新编号社区为 0,1,2,...
  const uniqueComms = [...new Set(community.values())];
  const commMap = new Map();
  uniqueComms.forEach((c, i) => commMap.set(c, i));
  const result = new Map();
  for (const [nodeId, c] of community) {
    result.set(nodeId, commMap.get(c));
  }
  return result;
}

// ============ 12. 力导向布局 ============
// 改进：增大斥力 + 节点大小感知 + 碰撞硬约束 + 枢纽节点额外排斥，解决节点重叠
function forceDirectedLayout(nodes, edges, options = {}) {
  const {
    iterations = 400,           // 增加迭代次数（200→400）
    idealDistance = 140,        // 理想间距（120→140）
    repulsion = 25000,          // 斥力（8000→25000，大幅增强）
    attraction = 0.04,          // 引力（0.05→0.04，稍降避免拉太紧）
    centerForce = 0.0008,
    damping = 0.88,
    minNodeDistance = 80,       // ★ 节点间最小距离（硬约束，接近idealDistance避免参数冲突）
    hubRepulsion = 3.0          // ★ 枢纽节点额外斥力倍数
  } = options;

  // 初始化位置（圆形分布，避免初始重叠）
  const cx = 500, cy = 400;
  // 按节点大小排序，大节点先放置在外圈，避免初始重叠
  const sortedIndices = nodes.map((n, i) => ({ idx: i, size: n.size || 15 }))
    .sort((a, b) => b.size - a.size);
  for (let k = 0; k < sortedIndices.length; k++) {
    const i = sortedIndices[k].idx;
    const angle = (k / nodes.length) * Math.PI * 2;
    // 大节点放更外圈，给小节点留空间
    const baseR = 200 + Math.random() * 80;
    const sizeBonus = (nodes[i].size || 15) * 3;
    const r = baseR + sizeBonus;
    nodes[i].x = cx + r * Math.cos(angle);
    nodes[i].y = cy + r * Math.sin(angle);
    nodes[i].vx = 0;
    nodes[i].vy = 0;
  }

  // 预构建邻接表
  const adj = new Map();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const edge of edges) {
    if (adj.has(edge.from)) adj.get(edge.from).add(edge.to);
    if (adj.has(edge.to)) adj.get(edge.to).add(edge.from);
  }

  // 节点大小感知：大节点需要更大排斥距离
  const getNodeRadius = (n) => (n.size || 15) + 5;

  // 预构建节点 Map，避免边循环内 O(E*N) 的 find 查找
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // ★ 斥力（所有节点对，考虑节点大小和枢纽倍数）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
          // 完全重合：随机方向推开
          const randAngle = Math.random() * Math.PI * 2;
          nodes[i].x += Math.cos(randAngle) * 5;
          nodes[i].y += Math.sin(randAngle) * 5;
          nodes[j].x -= Math.cos(randAngle) * 5;
          nodes[j].y -= Math.sin(randAngle) * 5;
          dist = 1;
        }
        // 节点大小感知：有效距离减去两节点半径
        const ri = getNodeRadius(nodes[i]);
        const rj = getNodeRadius(nodes[j]);
        const effectiveDist = Math.max(1, dist - ri - rj);
        // 枢纽节点额外斥力
        const hubMult = (nodes[i].isHub ? hubRepulsion : 1) * (nodes[j].isHub ? hubRepulsion : 1);
        const force = (repulsion * hubMult) / (effectiveDist * effectiveDist);
        const fx = (dx / dist) * force * temp;
        const fy = (dy / dist) * force * temp;
        nodes[i].vx += fx;
        nodes[i].vy += fy;
        nodes[j].vx -= fx;
        nodes[j].vy -= fy;
      }
    }

    // 引力（有边连接的节点对）
    for (const edge of edges) {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = attraction * (dist - idealDistance) * (edge.weight || 1);
      const fx = (dx / dist) * force * temp;
      const fy = (dy / dist) * force * temp;
      from.vx += fx;
      from.vy += fy;
      to.vx -= fx;
      to.vy -= fy;
    }

    // 中心力
    for (const node of nodes) {
      node.vx -= (node.x - cx) * centerForce * temp;
      node.vy -= (node.y - cy) * centerForce * temp;
    }

    // 更新位置
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      const maxSpeed = 30 * temp;
      if (speed > maxSpeed) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  // ★ 后处理：碰撞检测，强制分离重叠节点
  // 多轮迭代确保所有节点满足最小距离约束
  for (let pass = 0; pass < 5; pass++) {
    let overlapCount = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ri = getNodeRadius(nodes[i]);
        const rj = getNodeRadius(nodes[j]);
        const minDist = Math.max(minNodeDistance, ri + rj + 8);
        if (dist < minDist && dist > 0.01) {
          overlapCount++;
          const overlap = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          // 大节点移动更少（更稳定），小节点移动更多
          const wi = (nodes[i].size || 15) / ((nodes[i].size || 15) + (nodes[j].size || 15));
          const wj = 1 - wi;
          nodes[i].x += ux * overlap * (1 - wi + 0.5);
          nodes[i].y += uy * overlap * (1 - wi + 0.5);
          nodes[j].x -= ux * overlap * (1 - wj + 0.5);
          nodes[j].y -= uy * overlap * (1 - wj + 0.5);
        } else if (dist <= 0.01) {
          // 完全重合：随机推开
          const randAngle = Math.random() * Math.PI * 2;
          nodes[i].x += Math.cos(randAngle) * minNodeDistance;
          nodes[i].y += Math.sin(randAngle) * minNodeDistance;
        }
      }
    }
    if (overlapCount === 0) break;
  }

  for (const node of nodes) {
    delete node.vx;
    delete node.vy;
  }
}

// ============ 13. 导出 ============
// ★ 移除 window 全局挂载，改为 ES Module export（core 层无 DOM 依赖）
export {
  buildKnowledgeGraph,
  textRankKeywords,
  tokenize,
  splitSentences,
  splitParagraphs,
  extractPhraseLabel,
  STOP_WORDS
};

