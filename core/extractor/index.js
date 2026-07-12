// ============================================================
// @module core/extractor
// 职责：实体/关键词/概念抽取（中文分词 + TF-IDF + 教材/考题切分）
// 依赖方向：只能被上层（core/services / core/pipeline / core/matcher）调用，不可反向依赖
// 公开 API: tokenize, extractKeywords, splitTextbook, splitQuestions
// ============================================================

import { extractHeadings, flattenHeadings } from './headings.js';

// ============ 3. 中文分词（简单实现） ============
// 物理学术语词典 + 数学/统计学术语词典 + 通用分词
const PHYSICS_TERMS = [
  '折射定律', '斯涅尔定律', '全反射', '临界角', '光密介质', '光疏介质', '折射率',
  '反射定律', '直线传播', '光纤', '棱镜',
  '理想光学系统', '共轭', '主平面', '主点', '焦点', '焦距', '物距', '像距',
  '高斯公式', '牛顿公式', '放大率', '垂轴放大率', '物像关系', '光轴',
  '显微镜', '物镜', '目镜', '数值孔径', '分辨本领', '望远镜', '开普勒', '伽利略',
  '杨氏双缝', '干涉', '相干光', '条纹间距', '明纹', '暗纹', '光程差', '相位差',
  '薄膜干涉', '等厚干涉', '等倾干涉', '牛顿环', '增透膜', '迈克尔逊',
  '夫琅禾费衍射', '单缝衍射', '光栅', '光栅方程', '光栅常数', '分辨本领', '主极大',
  '次极大', '暗纹', '瑞利判据', '圆孔衍射', '艾里斑',
  '偏振', '偏振光', '线偏振', '自然光', '偏振片', '马吕斯定律', '布儒斯特角',
  '布儒斯特定律', '双折射', '波片', '四分之一波片', '二分之一波片',
  '波长', '频率', '光速', '电磁波', '光子', '光电效应',
  '透镜', '凸透镜', '凹透镜', '球面镜', '抛物面镜', '曲率半径',
  '入射角', '反射角', '折射角', '衍射角', '偏向角',
  '成像', '实像', '虚像', '倒立', '正立', '放大', '缩小',
  '光谱', '色散', '单色光', '白光', '激光',
  '光强', '照度', '亮度', '辐射', '通量',
  '费马原理', '惠更斯原理', '叠加原理', '菲涅尔', '基尔霍夫',
  'sin', 'cos', 'tan', '角度', '弧度',

  // 力学
  '牛顿运动定律', '牛顿第一定律', '牛顿第二定律', '牛顿第三定律', '惯性', '惯性参考系',
  '动量', '动量定理', '动量守恒', '冲量', '角动量', '角动量守恒', '力矩', '转动惯量',
  '重力', '摩擦力', '弹性力', '万有引力', '引力常数', '加速度', '速度', '位移',
  '功', '功率', '动能', '势能', '机械能', '机械能守恒', '能量守恒',
  '碰撞', '弹性碰撞', '非弹性碰撞', '质心', '转动', '角速度', '角加速度',
  '简谐运动', '振幅', '周期', '相位', '单摆', '复摆', '阻尼振动', '受迫振动', '共振',
  '横波', '纵波', '波速', '声波', '多普勒效应', '驻波', '波前', '波面',
  '流体', '压强', '浮力', '阿基米德原理', '帕斯卡定律', '伯努利方程', '表面张力', '粘性',
  '应力', '应变', '杨氏模量', '胡克定律', '弹性模量',

  // 电磁学
  '电荷', '电场', '电场强度', '电势', '电势差', '电压', '电流', '电阻', '电阻率',
  '欧姆定律', '基尔霍夫定律', '基尔霍夫电流定律', '基尔霍夫电压定律',
  '电容', '电容器', '电感', '磁场', '磁感应强度', '磁通量', '电磁感应',
  '法拉第电磁感应定律', '楞次定律', '洛伦兹力', '安培力', '安培定律',
  '毕奥-萨伐尔定律', '麦克斯韦方程组', '电磁波', '电磁场', '电磁振荡',
  '交流电', '变压器', '电动机', '发电机', '磁矩', '磁化', '磁介质',
  '电介质', '极化', '压电效应', '霍尔效应', '涡流', '自感', '互感',
  '电场线', '磁感线', '高斯定律', '库仑定律', '库仑力', '电偶极子', '磁偶极子',

  // 热学
  '热力学', '热量', '比热容', '热容', '内能', '熵', '熵增原理',
  '热力学第一定律', '热力学第二定律', '热力学第三定律',
  '等温过程', '等压过程', '等容过程', '绝热过程',
  '卡诺循环', '热机', '制冷机', '热机效率',
  '热传导', '热对流', '热辐射',
  '理想气体', '理想气体状态方程', '玻尔兹曼常数', '阿伏伽德罗常数',
  '分子动理论', '布朗运动', '扩散', '蒸发', '凝结', '沸腾', '熔化', '凝固',
  '升华', '相变', '临界点', '饱和蒸汽压',

  // 量子力学
  '量子', '波粒二象性', '德布罗意波', '不确定性原理', '薛定谔方程',
  '波函数', '概率密度', '量子数', '主量子数', '角量子数', '磁量子数',
  '自旋', '泡利不相容原理', '量子态', '量子跃迁', '能级', '基态', '激发态',
  '隧道效应', '零点能', '量子隧穿', '哈密顿量', '算符', '本征值', '本征态',
  '期望值', '矩阵力学', '波动力学', '量子电动力学', '量子色动力学',
  '光电效应', '康普顿效应', '黑体辐射', '普朗克常数', '波尔模型'
];

// 数学/统计学术语词典（覆盖概率论、数理统计、随机过程等常见课程）
const MATH_STAT_TERMS = [
  '随机变量', '随机向量', '随机过程', '随机事件', '随机试验',
  '概率论', '数理统计', '概率统计', '概率分布', '概率模型', '概率密度',
  '条件概率', '联合分布', '边缘分布', '先验概率', '后验概率', '贝叶斯',
  '分布函数', '密度函数', '离散型', '连续型',
  '正态分布', '均匀分布', '指数分布', '泊松分布', '二项分布', '几何分布',
  '超几何分布', '卡方分布', 't分布', 'F分布', '伽马分布', '伯努利',
  '数学期望', '方差', '标准差', '协方差', '相关系数', '矩', '矩母函数',
  '特征函数', '偏度', '峰度', '中位数', '众数', '分位数',
  '大数定律', '中心极限定理', '极限定理', '极限分布', '切比雪夫不等式',
  '马尔可夫链', '马氏链', '平稳过程', '泊松过程', '生灭过程', '状态空间',
  '转移概率', '平稳分布', '遍历性',
  '参数估计', '点估计', '区间估计', '置信区间', '置信度', '最大似然估计',
  '矩估计', '无偏估计', '有效估计', '一致估计',
  '假设检验', '显著性检验', '显著性水平', 'p值', '拒绝域', '接受域',
  '原假设', '备择假设', '第一类错误', '第二类错误',
  '回归分析', '线性回归', '最小二乘法', '相关分析', '方差分析',
  '样本空间', '样本均值', '样本方差', '总体', '统计量',
  '独立同分布', '相互独立', '条件独立',
  '似然函数', '对数似然', '充分统计量',
  '矩阵', '行列式', '特征值', '特征向量', '线性变换', '线性方程组',
  '向量空间', '内积', '正交', '投影', '秩',
  '导数', '偏导数', '积分', '微分', '梯度', '泰勒展开', '级数',
  '傅里叶变换', '拉普拉斯变换', '卷积',
  '图论', '组合数学', '离散数学', '优化', '线性规划'
];

// 合并所有术语词典
const ALL_TERMS = [...PHYSICS_TERMS, ...MATH_STAT_TERMS];

// 预排序的术语（按长度降序，只排序一次）
const SORTED_PHYSICS_TERMS = [...ALL_TERMS].sort((a, b) => b.length - a.length);

function tokenize(text) {
  const tokens = [];
  // 清理 PDF 内部标记：[fsXX] 字号标记、[bookmark:LX] 书签标记
  let remaining = (text || '')
    .replace(/\[fs\d+(?:\.\d+)?\]/g, '')
    .replace(/\[bookmark:L\d+\]/g, '');

  // 先匹配长术语
  while (remaining.length > 0) {
    let matched = false;
    for (const term of SORTED_PHYSICS_TERMS) {
      if (remaining.startsWith(term)) {
        tokens.push(term);
        remaining = remaining.substring(term.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 中文：收集连续中文字符，生成2字n-gram作为候选token（配合停用词过滤）
      const ch = remaining[0];
      if (/[\u4e00-\u9fa5]/.test(ch)) {
        let chineseStr = '';
        while (remaining.length > 0 && /[\u4e00-\u9fa5]/.test(remaining[0])) {
          chineseStr += remaining[0];
          remaining = remaining.substring(1);
        }
        // 生成2字n-gram作为候选token，但标记为 ngram 类型以便后续过滤
        // 修复：只有连续中文段 >=4 字时才生成 n-gram，短段直接跳过避免碎片
        if (chineseStr.length >= 4) {
          for (let i = 0; i < chineseStr.length - 1; i++) {
            tokens.push(chineseStr.substr(i, 2));
          }
        }
        continue;
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        let word = '';
        while (remaining.length > 0 && /[a-zA-Z0-9]/.test(remaining[0])) {
          word += remaining[0];
          remaining = remaining.substring(1);
        }
        if (word.length > 1) tokens.push(word.toLowerCase());
        continue;
      }
      remaining = remaining.substring(1);
    }
  }

  return tokens;
}

// ============ 4. 关键词提取（TF-IDF） ============
// 计算文档级IDF：统计每个token在多少个section中出现，IDF = log(N / df)
function computeIdf(sections) {
  const N = sections.length;
  if (N === 0) return new Map();
  const df = new Map();
  for (const section of sections) {
    const text = typeof section === 'string' ? section : (section.content || section.text || '');
    const tokens = new Set(tokenize(text));
    for (const t of tokens) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [word, count] of df) {
    idf.set(word, Math.log(N / count));
  }
  return idf;
}

function extractKeywords(text, topN = 15, idfMap = null) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  // 词频统计
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }

  // 过滤停用词和单字（除非是术语）
  const stopWords = new Set([
    '的', '了', '在', '是', '和', '与', '或', '一个', '可以', '这', '那', '为', '以', '及', '等',
    '中', '上', '下', '不', '有', '无', '到', '从', '被', '把', '将', '对', '向', '由', '于', '而',
    '且', '但', '则', '即', '若', '如', '虽', '然', '因', '故', '所', '之', '其', '此', '彼',
    '我', '你', '他', '它', '们',
    // 常见中文停用词补充
    '进行', '通过', '根据', '由于', '因为', '所以', '但是', '然而', '同时', '其中', '上述', '下面',
    '例如', '比如', '即', '分别', '已知', '假设', '设', '可见', '得出', '如下', '所示',
    '称为', '称作', '叫做', '定义', '是指', '就是', '具有', '包含', '包括', '存在', '发生',
    '产生', '形成', '组成', '构成', '得到', '获得', '需要', '要求', '使用', '利用', '采用',
    '方法', '分析', '结果', '问题', '情况', '方面', '方式', '过程', '系统', '结构', '功能',
    '作用', '影响', '关系', '变化', '规律', '原理', '特点', '特征', '性质', '概念', '理论',
    '实际', '应用', '实践', '实验', '观察', '测量', '计算', '求解', '证明', '推导',
    '表达式', '公式', '方程', '函数', '变量', '参数', '常数', '系数', '因子', '元素', '因素',
    '条件', '状态', '阶段', '步骤', '类型', '种类', '形式', '形态', '模式', '层次', '级别',
    '程度', '范围', '领域', '方向', '目标', '目的', '意义', '价值', '效果', '效率', '质量',
    '数量', '大小', '长度', '面积', '体积', '重量', '密度', '温度', '压力', '速度', '加速度',
    '能量', '功率', '电流', '电压', '电阻', '电容', '电感', '磁场', '电场', '频率', '波长',
    '振幅', '相位', '周期'
  ]);
  const termSet = new Set(ALL_TERMS);

  // 修复：先收集术语匹配结果，用于后续过滤碎片 n-gram
  const matchedTerms = new Set();
  for (const word of Object.keys(tf)) {
    if (termSet.has(word)) matchedTerms.add(word);
  }

  const keywords = [];
  for (const [word, count] of Object.entries(tf)) {
    // 保留：术语 或 （长度>1且非停用词且非纯数字/科学计数法）
    if (termSet.has(word) || (word.length >= 2 && !stopWords.has(word) && !/^[\d\.\-\+eE×x⁻]+$|^[\d]+[a-zA-Z]{1,2}$/.test(word))) {
      // 修复：非术语的中文 2-gram 一律跳过（碎片太多，只保留术语和 3 字以上词）
      if (word.length === 2 && !termSet.has(word) && /[\u4e00-\u9fa5]/.test(word)) {
        continue;
      }
      // 术语权重提升
      const weight = termSet.has(word) ? 3 : 1;
      // IDF加权：当提供idfMap时，使用真正的TF-IDF；否则退化为纯TF
      const idfVal = idfMap ? (idfMap.get(word) || 1) : 1;
      keywords.push({ word, count: count * weight * idfVal, isTerm: termSet.has(word) });
    }
  }

  keywords.sort((a, b) => b.count - a.count);
  return keywords.slice(0, topN);
}

// ============ 6. 教材章节切分 ============
// 优先复用 extractHeadings 的标题树（与 headings.js 一致），无标题时回退正则
function splitTextbook(text, options = {}) {
  // 修复：防御 null/undefined text 导致后续 text.slice 崩溃
  const safeText = text || '';
  let chapters;
  // 优先使用传入的标题树切分
  if (options.headings && options.headings.length > 0) {
    chapters = splitByHeadings(safeText, options.headings);
    if (chapters.length > 0) return applyIdfToChapters(chapters);
  }
  // 回退：尝试用 extractHeadings 自动提取标题树
  try {
    const tree = extractHeadings(safeText, { fontSizeStats: options.fontSizeStats });
    if (tree && tree.length > 0) {
      const flat = flattenHeadings(tree);
      if (flat.length > 0) {
        chapters = splitByHeadings(safeText, flat);
        if (chapters.length > 0) return applyIdfToChapters(chapters);
      }
    }
  } catch (e) {
    // extractHeadings 失败时回退正则
  }
  // 最终回退：正则模式
  chapters = splitByTextbookRegex(safeText);
  return applyIdfToChapters(chapters);
}

// 后处理：从所有section计算IDF，重新提取关键词（实现真正的TF-IDF）
function applyIdfToChapters(chapters) {
  const allSectionTexts = [];
  for (const ch of chapters) {
    for (const sec of (ch.sections || [])) {
      allSectionTexts.push(sec.content || '');
    }
  }
  if (allSectionTexts.length > 1) {
    const idfMap = computeIdf(allSectionTexts);
    for (const ch of chapters) {
      for (const sec of (ch.sections || [])) {
        const topN = sec.keywords && sec.keywords.length > 12 ? 15 : 12;
        sec.keywords = extractKeywords(sec.content || '', topN, idfMap);
      }
    }
  }
  return chapters;
}

// 按标题树切分：L1→章，L2→节，L3+→子节（内容合并到上级节）
function splitByHeadings(text, flatHeadings) {
  const chapters = [];
  let currentChapter = null;
  let currentSection = null;

  for (const h of flatHeadings) {
    const raw = h.raw || h.title || '';
    const content = (text.slice(h.start, h.end) || '').replace(raw, '').trim();

    if (h.level <= 1) {
      // 新章
      currentChapter = {
        id: h.id || `ch${chapters.length + 1}`,
        title: h.title,
        sections: []
      };
      chapters.push(currentChapter);
      currentSection = null;
      // 章引导内容（无小节时作为默认 section）
      if (content.length > 20) {
        currentSection = {
          id: `${currentChapter.id}-1`,
          title: h.title,
          content,
          keywords: extractKeywords(content, 15)
        };
        currentChapter.sections.push(currentSection);
      }
    } else if (h.level === 2 && currentChapter) {
      // 新小节
      currentSection = {
        id: `${currentChapter.id}-${currentChapter.sections.length + 1}`,
        title: h.title,
        content: content.length > 20 ? content : '',
        keywords: content.length > 20 ? extractKeywords(content, 12) : []
      };
      currentChapter.sections.push(currentSection);
    } else if (h.level >= 3 && currentSection) {
      // 子小节内容追加到当前 section
      if (content.length > 20) {
        currentSection.content = (currentSection.content || '') + '\n\n' + content;
        currentSection.keywords = extractKeywords(currentSection.content, 12);
      }
    } else if (h.level >= 2 && !currentChapter) {
      // 无 L1 标题时，L2+ 标题作为独立段
      if (content.length > 20) {
        chapters.push({
          id: h.id || `ch${chapters.length + 1}`,
          title: h.title,
          sections: [{
            id: `${chapters.length + 1}-1`,
            title: h.title,
            content,
            keywords: extractKeywords(content, 12)
          }]
        });
      }
    }
  }

  return chapters;
}

// 正则回退：仅识别"第N章"+"X.Y"模式
function splitByTextbookRegex(text) {
  const chapters = [];
  // 尝试匹配章节标题模式
  const chapterPattern = /第\s*(\d+)\s*章[\s\S]*?(?=第\s*\d+\s*章|$)/g;
  let match;

  while ((match = chapterPattern.exec(text)) !== null) {
    const chapterText = match[0];
    const chapterNum = match[1];

    // 提取章节标题
    const titleMatch = chapterText.match(/第\s*\d+\s*章\s*([^\n]+)/);
    const title = titleMatch ? titleMatch[1].trim() : `第${chapterNum}章`;

    // 切分小节
    const sections = [];
    const sectionPattern = /(\d+\.\d+)\s*([^\n]+)[\s\S]*?(?=\d+\.\d+|第\s*\d+\s*章|$)/g;
    let secMatch;
    let secIndex = 0;

    while ((secMatch = sectionPattern.exec(chapterText)) !== null) {
      const secNum = secMatch[1];
      const secTitle = secMatch[2].trim();
      const secContent = secMatch[0].replace(/^\d+\.\d+\s*[^\n]+/, '').trim();

      if (secContent.length > 20) {
        sections.push({
          id: `${chapterNum}-${secIndex + 1}`,
          title: `${secNum} ${secTitle}`,
          content: secContent, // 保留完整内容，不再截断
          keywords: extractKeywords(secContent, 12)
        });
        secIndex++;
      }
    }

    // 如果没匹配到小节，整章作为一个section
    if (sections.length === 0 && chapterText.length > 50) {
      sections.push({
        id: `${chapterNum}-1`,
        title: title,
        content: chapterText,
        keywords: extractKeywords(chapterText, 15)
      });
    }

    chapters.push({
      id: `ch${chapterNum}`,
      title: `第${chapterNum}章 ${title}`,
      sections
    });
  }

  // 如果没匹配到章节结构，按段落切分
  if (chapters.length === 0) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 30);
    paragraphs.slice(0, 50).forEach((p, i) => {
      chapters.push({
        id: `ch${i + 1}`,
        title: `内容段 ${i + 1}`,
        sections: [{
          id: `${i + 1}-1`,
          title: `段落 ${i + 1}`,
          content: p,
          keywords: extractKeywords(p, 10)
        }]
      });
    });
  }

  return chapters;
}

// ============ 7. 考题切分 ============
function splitQuestions(text) {
  const questions = [];

  // 预处理：移除常见的章节大标题（一、简答题 / 二、计算题 等），避免被误识别为题目
  // 这些标题特征：中文数字+顿号/点+很短的文字（<10字符）+换行
  const cleanedText = text.replace(
    /([一二三四五六七八九十])[、．.]\s*([^\n]{1,12})\n/g,
    ''
  );

  // 优先级1：数字题号（1. 2. 3. 或 1、 2、 3、 或 1） 2） 3））
  // 题号后跟题目内容，直到下一个题号或文末
  const numericPattern = /(\d+)[、．.）)]\s*([\s\S]*?)(?=\n\s*\d+[、．.）)]|$)/g;

  // 优先级2：括号数字 (1) (2) (3)
  const parenPattern = /\((\d+)\)\s*([\s\S]*?)(?=\n\s*\(\d+\)|$)/g;

  // 优先级3：中文数字题号（一、 二、 三、）—— 仅当没有数字题号时使用
  // 排除"简答题/计算题/分析题"等大题标题（标题通常<8字且后跟换行）
  const chinesePattern = /([一二三四五六七八九十])[、．.]\s*([\s\S]*?)(?=\n\s*[一二三四五六七八九十][、．.]|$)/g;

  function tryPattern(pattern, minLen) {
    const result = [];
    let match;
    let qIndex = 0;
    while ((match = pattern.exec(cleanedText)) !== null) {
      // match[1] 是题号，match[2] 是题目内容（最后一个捕获组）
      const content = (match[2] || match[0]).trim();
      // 过滤太短的（可能是残留标题）和过长的章节标题
      if (content.length >= minLen) {
        // 排除明显是章节大标题的情况（如"简答题"、"计算题"等）
        if (/^(简答|计算|分析|选择|填空|判断|论述|证明|作图|综合|应用|设计|实验)[题]/.test(content)) {
          continue;
        }
        result.push({
          id: `q${qIndex + 1}`,
          number: match[1],
          rawText: content,
          content: content, // 保留完整题目内容，不截断
          keywords: extractKeywords(content, 12)
        });
        qIndex++;
      }
    }
    return result;
  }

  // 按优先级尝试
  questions.push(...tryPattern(numericPattern, 15));
  if (questions.length === 0) {
    questions.push(...tryPattern(parenPattern, 15));
  }
  if (questions.length === 0) {
    questions.push(...tryPattern(chinesePattern, 15));
  }

  // 如果没匹配到，按换行切分（保留较长行作为题目）
  if (questions.length === 0) {
    const lines = text.split('\n').filter(l => l.trim().length > 20);
    lines.slice(0, 30).forEach((line, i) => {
      questions.push({
        id: `q${i + 1}`,
        number: String(i + 1),
        rawText: line,
        content: line,
        keywords: extractKeywords(line, 10)
      });
    });
  }

  return questions;
}

export { tokenize, extractKeywords, computeIdf, splitTextbook, splitQuestions };
