/** @module core/extractor/headings
 *  职责：从纯文本中识别层级标题，构建文档大纲
 *  支持：
 *    - Markdown 标题：# / ## / ###
 *    - 章节编号：第 X 章、X.Y.Z 节
 *    - 独立短行（可能加粗或被特殊缩进）
 *    - 字号提示：PDF 解析时可在文本中保留 fontSize 标记
 *  输出：树形 headings，每个节点含 level、title、page、range（起止字符位置）
 */

const HEADING_PATTERNS = {
  // PDF 原生书签标记（由 parse.js 在文本流中插入，优先级最高）
  bookmark: /^\[bookmark:L(\d+)\]\s*(.+)$/,
  // Markdown 标题
  markdown: /^(#{1,6})\s+(.+)$/,
  // 第 X 章 / 第X章 / 第一章 / 第一章：标题
  chapter: /^第\s*[一二三四五六七八九十百千万\d]+\s*章\s*[：:.\s]*(.+)$/,
  // 第 X 节 / 第X节
  sectionZh: /^第\s*[一二三四五六七八九十百千万\d]+\s*节\s*[：:.\s]*(.+)$/,
  // X.Y / X.Y.Z 节（支持顿号、点、空格分隔）
  section: /^\s*(\d+(?:\.\d+)+)\s*[、．.\s]+(.+)$/,
  // 单独数字章节：1 引言 / 1. 引言（严格过滤带页码的目录项）
  numericChapter: /^\s*(\d{1,2})\s*[\.．、\s]\s*(.{2,80})$/,
  // 中文数字 + 顿号 + 短标题
  chineseSection: /^\s*([一二三四五六七八九十]+)[、．.\s]+(.{2,40})$/,
  // 加粗标记 **标题**
  bold: /^\*\*\s*(.+?)\s*\*\*$/,
  // 字体大小标记（PDF 解析时可在行首插入）
  fontSize: /^\[fs(\d+(?:\.\d+)?)\]\s*(.+)$/,
  // 括号编号：(1) / (一)；注意：排除 (A)/(B)/(a)/(b) 等选择题选项
  bracketNumber: /^\s*[(（]([一二三四五六七八九十百千万\d]+)[)）]\s*[\.．:：\s]*(.{2,80})$/,
  // 字母/罗马数字编号：A. / B. / I. / II.；注意：排除 A)/B) 等选择题选项
  alphaRoman: /^\s*([A-Z]|[IVXivx]{1,5})[\.．\s]\s*(.{2,80})$/,
  // 考试题型：例题 1 / 习题 2 / Question 3 / Problem 1
  examQuestion: /^\s*(?:例题|例|习题|练习|问题|题目|Question|Problem|Exercise)\s*[\d一二三四五六七八九十]+[\.．:：\s]*(.{2,80})$/i,
  // 步骤型编号：Step 1 / 阶段一 / Phase 1
  stepNumber: /^\s*(?:Step|阶段|Phase|Part)\s*[\d一二三四五六七八九十]+[\.．:：\s]*(.{2,80})$/i
};

const MAX_HEADING_LEN = 120;
const MIN_HEADING_LEN = 4; // 提高最小长度，过滤 "i", "ii", "x" 等

// 页码模式：PDF/Word 中常见的页眉页脚或页码标记
const PAGE_NUMBER_PATTERNS = [
  /^\s*第\s*\d+\s*页\s*$/,
  /^\s*第\s*[一二三四五六七八九十百千万]+\s*页\s*$/,
  /^\s*[-\—–\-\s]*\s*\d+\s*[-\—–\-\s]*\s*$/,
  /^\s*Page\s+\d+\s*$/i,
  /^\s*-\s*\d+\s*-\s*$/,
  /^\s*—\s*\d+\s*—\s*$/,
  /^\s*\d+\s*\/\s*\d+\s*$/
];
// 更宽松的页码/页眉页脚标记：只要行中包含"第 X 页 / 共 Y 页"即视为页码
const PAGE_MARKER_PATTERN = /第\s*\d+\s*页\s*[\/／]?\s*共\s*\d+\s*页|第\s*\d+\s*页\s*共\s*\d+\s*页|第\s*[一二三四五六七八九十]+\s*页/i;

// 目录标记（不区分大小写）
const TABLE_OF_CONTENTS_MARKERS = /^\s*(?:目录|contents|目次|table of contents|目\s*录)\s*$/i;

// 目录行模式：标题后接点号填充和页码
const TOC_DOTS_PATTERN = /\.\s*\.\s*\.\s*\d+\s*$/;
const TOC_LEADER_PATTERN = /[\.·\-\s]{3,}\d+\s*$/;
// 目录页码后缀：行尾是数字页码，且数字前有大量空格或引导符
const TOC_PAGE_SUFFIX = /[\.·\-\s]{2,}\d+\s*$|\s+\d{1,4}\s*$/;

// 数学符号/公式残留
const MATH_SYMBOLS = /[∫∬∭∮∯∰∑∏∂∇√∞∈∉∪∩⊂⊃⊆⊇≈≠≡≤≥×÷±∞αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ¯ˆ˜¨˙\^\_]/;
const MATH_OPERATORS = /[\+\-\*\/\=\<\>\|\&\%\$\#\@\!\?\{\}\[\]\(\)]/;

// 英文连接词：行尾出现这些词说明英文标题被拆行
const ENGLISH_CONNECTORS = new Set([
  'and', 'or', 'but', 'of', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'from', 'into', 'through', 'during', 'this', 'that', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'there', 'here', 'where', 'when', 'what', 'which', 'who', 'whom', 'whose', 'why', 'how'
]);

// 常见英文停用词/短词，单独一行不可能是标题
const ENGLISH_TINY_WORDS = new Set([
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
]);

// 常见非标题短语（正文中的复习、过渡、列表标记等）
const NON_HEADING_PHRASES = new Set([
  'review：回顾', 'review', 'last week', 'this week', 'today', 'last talk', 'today:',
  'review:', 'last talk:', 'sampling', 'sampling:', 'contents', 'table of contents',
  '目录', '前言', 'preface', '摘要', 'abstract'
]);

// 学术标记行：Example 1., Definition 2., Theorem 3. 等，不是章节标题
// 注意：带编号的例题/习题/问题（如"例题 1"、"Question 2"）作为考试题型标题，在 examQuestion 模式中单独处理，此处不匹配
const ACADEMIC_LABEL_PATTERN = /^(Example|Definition|Theorem|Proposition|Corollary|Remark|Proof|Lemma|Figure|Table)\s*\d*\.?/i;
// 列表项模式："1. 问...", "2. 如果...", "2. "Quote..."
const LIST_ITEM_PATTERN = /^\s*\d+\s*[\.．]\s*[""''`‘’“”\u4e00-\u9fa5a-zA-Z].+$/;
// 明确的标题词：只有包含这些词的短行才可能是独立小标题
const HEADING_KEYWORDS = /(?:总结|结论|引言|前言|背景|方法|实验|结果|讨论|致谢|小结|要点|概览|概述|简介|复习|回顾|展望|附录|说明|介绍|定义|性质|定理|引理|推论|命题|例题|习题|练习|问题|解答|证明|推导|分析|应用|例子|实例|注意事项|重要结论|核心思想|基本思想|主要结论)/i;

function isPageNumber(line) {
  const trimmed = line.trim();
  if (PAGE_NUMBER_PATTERNS.some(p => p.test(trimmed))) return true;
  return PAGE_MARKER_PATTERN.test(trimmed);
}

// 判断一行是否是目录项（标题 + 页码）
function isTableOfContentsLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 书签标记行不是目录项
  if (/^\[bookmark:L\d+\]/.test(trimmed)) return false;

  // 模式1: "标题 ............ 7" / "标题 ······ 7"
  if (TOC_DOTS_PATTERN.test(trimmed)) return true;
  if (TOC_LEADER_PATTERN.test(trimmed)) return true;

  // 模式1.5: 无页码但带连续点号/空格引导的目录行（如 "第一章 引言 ......"）
  if (/^.{2,30}[·．.]{3,}\s*$/.test(trimmed)) return true;

  // 模式2: "1 概率模型 5" / "1. 概率模型 5" / "第1章 概率模型 5"
  // 要求行尾是单独数字页码，且前面有标题内容
  // 放宽：核心字符 ≥1 即可（原要求 ≥2）
  const m = trimmed.match(/^\s*(?:(?:第\s*[一二三四五六七八九十百千万\d]+\s*[章节节]?)|(?:\d+(?:\.\d+)*))\s*[、．.\s]*(.+?)\s+(\d{1,4})\s*$/);
  if (m) {
    const core = m[1].trim();
    const meaningful = (core.match(/[\u4e00-\u9fa5a-zA-Z]/g) || []).length;
    if (meaningful >= 1 && !looksLikeMathFormula(core) && !core.includes('…')) return true;
  }

  // 模式3: "概率模型 ..... 5"（无编号，但有引导符和页码）
  const m2 = trimmed.match(/^\s*([\u4e00-\u9fa5a-zA-Z].+?)\s*[\.·\-\s]{2,}\s*(\d{1,4})\s*$/);
  if (m2) {
    const core = m2[1].trim();
    const meaningful = (core.match(/[\u4e00-\u9fa5a-zA-Z]/g) || []).length;
    if (meaningful >= 2 && !looksLikeMathFormula(core)) return true;
  }

  return false;
}

// 判断是否是数学公式残留
function looksLikeMathFormula(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // 包含明显数学符号
  if (MATH_SYMBOLS.test(trimmed)) return true;

  // 包含大量数学运算符（相对文字占比高）
  const mathChars = (trimmed.match(MATH_OPERATORS) || []).length;
  const textChars = (trimmed.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length;
  if (textChars > 0 && mathChars / (mathChars + textChars) > 0.35) return true;

  // 看起来像变量序列：多个单字母或短字母组合，如 "x y", "a b c", "Y X", "i i"
  const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length >= 2) {
    const varLikeTokens = tokens.filter(t => /^[a-zA-Z]$/.test(t) || /^[a-zA-Z]{1,2}\d*$/i.test(t));
    if (varLikeTokens.length / tokens.length >= 0.7) return true;
  }

  // 公式常见模式：f(x)、g(x,y)、括号配对且内部含运算符
  if (/\([^)]*[+\-*/=^][^)]*\)/.test(trimmed)) return true;

  // 纯数字、数字+符号组合
  if (/^[\d\s+\-*/=^().]+$/.test(trimmed)) return true;

  return false;
}

// 判断是否是英文片段/不完整行（需要与下一行合并）
function isFragmentedEnglish(line) {
  const trimmed = line.trim();
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const last = tokens[tokens.length - 1].toLowerCase().replace(/[^a-z]/g, '');
  // 行尾是连接词，说明被截断
  if (ENGLISH_CONNECTORS.has(last)) return true;
  // 整行都是小写虚词
  if (tokens.length <= 2 && tokens.every(t => ENGLISH_CONNECTORS.has(t.toLowerCase().replace(/[^a-z]/g, '')))) return true;
  return false;
}

// 去掉 PDF 字号标记 [fsXX]，便于判断标题本质
function stripFontMarkers(line) {
  return line.replace(/^\[fs\d+(?:\.\d+)?\]\s*/, '').trim();
}

// 判断标题核心是否有价值：含中文，或是完整英文标题，而不是变量/公式片段
function isPlausibleTitle(title) {
  const core = stripFontMarkers(title).trim();
  if (!core || core.length < 2) return false;

  // 包含中文 => 基本可接受
  if (/[\u4e00-\u9fa5]/.test(core)) return true;

  // 英文标题：至少包含 2 个非连接词实词
  const words = core.split(/\s+/).filter(Boolean);
  const contentWords = words.filter(w => {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    return clean.length >= 2 && !ENGLISH_CONNECTORS.has(clean);
  });
  if (contentWords.length >= 2) return true;

  // 单个大写缩写（如 "MLE", "CLT"）可以保留，但 "as", "Y X" 等过滤
  if (words.length === 1 && /^[A-Z]{2,}$/.test(words[0])) return true;

  return false;
}

// 判断是否是常见非标题短语（复习、过渡、列表标记等）
function isNonHeadingPhrase(line) {
  const core = stripFontMarkers(line).trim().toLowerCase().replace(/[：:]/g, '');
  if (NON_HEADING_PHRASES.has(core)) return true;
  // 纯英文连接词/虚词组合
  const words = core.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.every(w => ENGLISH_CONNECTORS.has(w))) return true;
  return false;
}

// 判断是否是答案/解析页眉或参考答案章节标记
function isSolutionSectionMarker(line) {
  const core = stripFontMarkers(line).trim();
  // 典型答案页标记："参考答案"、"答案解析"、"试题解答"、"解答题参考答案"等
  if (/参考答案|答案解析|试题解答|解答与评分|评分标准|标准答案/.test(core)) return true;
  // 形如 "24 概率统计试题解答-解答题" 的页眉：含 "试题解答" 且含 "解答" 重复
  const solutionWords = (core.match(/解答/g) || []).length;
  const hasAnswerWord = /答案|参考|解析|评分/.test(core);
  if (solutionWords >= 2 && hasAnswerWord) return true;
  // 形如 "2024 概率统计试题解答" 的课程+年份+解答页眉
  if (/^\d{2,4}\s*[^\s]{2,20}\s*试题解答/.test(core)) return true;
  return false;
}

// 垃圾标题过滤：避免目录项、乱码、纯数字、重复字符、公式、不完整英文等被识别为标题
function isGarbageHeading(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.length < MIN_HEADING_LEN) return true;

  // 0. 目录项
  if (isTableOfContentsLine(trimmed)) return true;

  // 0. 非标题短语（复习、过渡、列表标记等）
  if (isNonHeadingPhrase(trimmed)) return true;

  // 0.5b 答案/解析页眉或参考答案章节标记，不是题目正文中的章节标题
  if (isSolutionSectionMarker(trimmed)) return true;

  // 0.6 学术标记行（Example/Definition/Theorem 等）不是章节标题
  if (ACADEMIC_LABEL_PATTERN.test(stripFontMarkers(trimmed))) return true;

  // 0.7 列表项（"1. 问...", "2. 如果..."）
  if (LIST_ITEM_PATTERN.test(stripFontMarkers(trimmed))) return true;

  // 1. 纯数字或主要由数字、符号组成
  const alphaChineseCount = (trimmed.match(/[\u4e00-\u9fa5a-zA-Z]/g) || []).length;
  if (alphaChineseCount === 0) return true;
  const printableCount = (trimmed.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length;
  if (printableCount > 0 && alphaChineseCount / printableCount < 0.25) return true;

  // 2. 目录项特征：包含 "..." 或大量连续点号
  if (/\.\s*\.\s*\.\s*\d+\s*$/.test(trimmed)) return true;
  if (/^\s*(?:\d+\.?)+\s*[\.·\-\s]+\s*\d+\s*$/.test(trimmed)) return true;

  // 3. 重复字符过多（如“不不不”、“随随随”），通常是解析错误
  const charRuns = trimmed.match(/(.)\1{2,}/g);
  if (charRuns) {
    const repeatedChars = charRuns.reduce((sum, s) => sum + s.length, 0);
    if (repeatedChars / trimmed.length > 0.4) return true;
  }

  // 4. 乱码特征：非中日韩/英文/数字字符占比过高
  const meaningfulChars = (trimmed.match(/[\u4e00-\u9fa5a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/g) || []).length;
  if (meaningfulChars / trimmed.length < 0.5) return true;

  // 5. 公式残留或符号行
  if (looksLikeMathFormula(trimmed)) return true;
  if (/^[\=+\-\*\/\|\$\^\&\%\@\#\!\?\[\]\{\}\(\)\s]+$/.test(trimmed)) return true;

  // 6. 英文单个字母/罗马数字/虚词（仅当整行只剩该标记时才过滤，
  //    例如 "A"、"II"；但 "A. 研究方法"、"I. 引言" 应保留为标题）
  const pureEn = trimmed.replace(/[^a-zA-Z\s]/g, '').trim().toLowerCase();
  if (pureEn && pureEn.split(/\s+/).length === 1 && ENGLISH_TINY_WORDS.has(pureEn)) {
    const rest = trimmed
      .replace(new RegExp(pureEn, 'i'), '')
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '')
      .trim();
    if (!rest) return true;
  }

  // 7. 不完整英文标题片段（如 "Lecture notes on Probability Theory and"）
  // 但如果是完整标题，行尾不是连接词，则允许
  if (isFragmentedEnglish(trimmed)) return true;

  // 8. 标题长度内有效文字过少（过滤 "Y X", "a a a" 等）
  if (alphaChineseCount < 2 && trimmed.length < 6) return true;

  // 9. 标题核心必须像真正的标题（含中文或完整英文），而不是变量组合
  if (!isPlausibleTitle(trimmed)) return true;

  // 10. 过滤数学变量开头的解析性短语，如 "Z 的数学期望的另一解法"、"X 的分布律"
  //     这些通常是答案/解析段落中的说明，不是章节标题
  if (/^[A-Za-z]\s+[^A-Za-z].*(?:解法|答案|解析|分布|密度|期望|方差|概率)/.test(trimmed)) return true;

  return false;
}

function isHeadingLike(line, neighbors = null) {
  const trimmed = line.trim();
  // 书签标记行优先级最高，直接返回 true
  if (/^\[bookmark:L\d+\]/.test(trimmed)) return { type: 'bookmark' };
  if (trimmed.length < MIN_HEADING_LEN || trimmed.length > MAX_HEADING_LEN) return false;
  if (isPageNumber(trimmed)) return false; // 过滤页码
  if (looksLikeMathFormula(trimmed)) return false;
  if (isTableOfContentsLine(trimmed)) return false;

  // 先尝试匹配标题模式
  let matchedType = null;
  for (const [type, regex] of Object.entries(HEADING_PATTERNS)) {
    if (regex.test(trimmed)) {
      matchedType = type;
      break;
    }
  }

  // 对容易误判的编号模式（numericChapter / chineseSection / section / bracketNumber / alphaRoman）
  // 增加上下文验证：只有同时满足以下条件才认定为标题
  //   1. 行尾不是句号/分号等正文标点（已在下面检查）
  //   2. 上下文证据：前后行明显更长（标题通常比正文短），或字号显著大
  //   3. 不含明显的正文动词/句式特征
  if (matchedType && NEEDS_CONTEXT_VERIFICATION.has(matchedType)) {
    if (!hasHeadingContextEvidence(trimmed, neighbors)) {
      matchedType = null;
    }
  }

  if (matchedType) return { type: matchedType };

  // 标题通常不含完整句中标点；但允许已匹配标题模式的行保留（如考试卷中的"一 选择题 (每小题 3 分，共 27 分)"）
  if (/[。！？]/.test(trimmed)) return false;

  // 独立短行策略：在强上下文证据下视为候选标题
  const fontSizeStats = neighbors?.fontSizeStats || null;
  const fsMatch = trimmed.match(/^\[fs(\d+(?:\.\d+)?)\]/);
  const hasLargeFont = fsMatch && fontSizeStats
    ? parseFloat(fsMatch[1]) >= fontSizeStats.median * 1.3
    : false;

  if (trimmed.length >= 6 && trimmed.length <= 40 && neighbors) {
    const before = stripFontMarkers((neighbors.before || '').trim());
    const after = stripFontMarkers((neighbors.after || '').trim());
    // 过滤邻居是公式/列表项/非标题短语的情况
    if (looksLikeMathFormula(before) || looksLikeMathFormula(after)) return false;
    if (ACADEMIC_LABEL_PATTERN.test(before) || ACADEMIC_LABEL_PATTERN.test(after)) return false;
    const avgNeighborLen = (before.length + after.length) / 2;
    // 条件1：字号显著大于正文（≥中位×1.3）时，不要求命中标题关键词，仅要求上下文证据
    // 条件2：无字号优势时，要求命中明确标题词 + 上下文显著短
    const isSignificantlyShorter = avgNeighborLen > trimmed.length * 3;
    const hasHeadingKeyword = HEADING_KEYWORDS.test(stripFontMarkers(trimmed));
    const isNonHeading = isNonHeadingPhrase(trimmed);
    const isListItem = LIST_ITEM_PATTERN.test(stripFontMarkers(trimmed));
    const isTocLike = /^(?:目录|contents|摘要|abstract|前言|preface|附录|appendix|参考文献|references)$/i.test(trimmed);

    if (isSignificantlyShorter && !isNonHeading && !isListItem && !isTocLike &&
        (hasLargeFont || hasHeadingKeyword)) {
      return { type: 'shortLine' };
    }
  }

  return false;
}

// 需要上下文验证的标题模式：这些模式容易把正文中的编号误判为标题
const NEEDS_CONTEXT_VERIFICATION = new Set([
  'numericChapter', 'section', 'chineseSection', 'bracketNumber', 'alphaRoman', 'examQuestion', 'stepNumber'
]);

// 正文句式特征：含这些完整句式的行更可能是正文而非标题
// 注意：不用单个常见字（如"在""和"等），因为它们在标题中也频繁出现
const BODY_TEXT_SIGNALS = /(?:进行|通过|对于|关于|根据|按照|由于|因为|所以|因此|如果|虽然|但是|然而|不过|即使|除非|一旦|当.*时|随着|使得|导致|引起|产生|形成|发生|出现|存在|包含|包括|组成|构成|分为|属于|具有|需要|要求|必须|应该|可以|能够|主要|通常|一般|往往|常常|经常|比如|例如|也就是|或者说|换句话说|不仅.*而且|既.*又|不是.*而是)/;

/**
 * 判断编号类标题是否有足够的上下文证据
 * 标题通常：比相邻正文行短、不含句号/分号、不含正文连接词
 */
function hasHeadingContextEvidence(trimmed, neighbors) {
  // 去掉字号标记后判断
  const core = stripFontMarkers(trimmed);

  // 1. 含句号/分号/问号/叹号的行不是标题（正文特征）
  if (/[。；！？]/.test(core)) return false;

  // 2. 含明显正文连接词/动词且较长时，不是标题
  if (core.length > 20 && BODY_TEXT_SIGNALS.test(core)) {
    // 但如果行很短且以编号开头，仍可能是标题
    // 进一步检查：正文连接词是否出现在行首1/3以后（说明是完整句子）
    const match = core.match(BODY_TEXT_SIGNALS);
    if (match && match.index > 3) return false;
  }

  // 3. 无上下文时保守起见通过（可能是在批量处理中无法获取上下文）
  if (!neighbors) return true;

  const before = stripFontMarkers((neighbors.before || '').trim());
  const after = stripFontMarkers((neighbors.after || '').trim());

  // 4. 如果前后行也是短行（<30字符），可能是列表项而非标题
  //    但如果前后行是空行，则更可能是标题（标题前后通常有空行）
  if (before && before.length < 15 && after && after.length < 15) {
    // 前后都是短行：可能是编号列表，需要额外证据
    const fontSizeStats = neighbors.fontSizeStats || null;
    const fsMatch = trimmed.match(/^\[fs(\d+(?:\.\d+)?)\]/);
    const hasLargeFont = fsMatch && fontSizeStats
      ? parseFloat(fsMatch[1]) >= fontSizeStats.median * 1.3
      : false;
    if (!hasLargeFont && !HEADING_KEYWORDS.test(core)) return false;
  }

  // 5. 上下文行明显更长（标题通常比正文短），通过
  const avgNeighborLen = (before.length + after.length) / 2;
  if (avgNeighborLen > core.length * 2) return true;

  // 6. 有字号标记且字号较大，通过
  const fontSizeStats = neighbors.fontSizeStats || null;
  const fsMatch2 = trimmed.match(/^\[fs(\d+(?:\.\d+)?)\]/);
  if (fsMatch2 && fontSizeStats && parseFloat(fsMatch2[1]) >= fontSizeStats.median * 1.15) return true;

  // 7. 有标题关键词，通过
  if (HEADING_KEYWORDS.test(core)) return true;

  // 8. 前或后是空行（标题前后通常有空行），通过
  //    但如果前后行也匹配标题模式（如连续的 A. xxx / B. xxx），更可能是列表而非标题
  if (!before || !after) {
    // 科学名称特征：单字母 + 分隔符 + 拉丁词 + 中文名（如 "S. aureus金黄色葡萄球菌"、"E.coli 大肠埃希菌"）
    // 这是生物学/医学文档中常见的词汇表格式，不是章节标题
    if (/^[A-Z][\.．\s]\s*[a-z]{2,}\s*[\u4e00-\u9fa5]/.test(core)) return false;
    // "C reactive protein, CRP C反应蛋白" 等格式：单字母 + 空格 + 英文短语 + 中文
    if (/^[A-Z]\s+[a-z]{2,}\s+\w+,?\s*[\u4e00-\u9fa5]/.test(core)) return false;
    return true;
  }

  // 9. 默认不通过（保守策略，减少误判）
  return false;
}

function parseHeading(line, type, options = {}) {
  const trimmed = line.trim();
  const fontSizeStats = options.fontSizeStats || null;

  if (type === 'bookmark') {
    const m = trimmed.match(HEADING_PATTERNS.bookmark);
    const level = parseInt(m[1], 10);
    const title = cleanTitle(m[2]);
    return { level, title, raw: trimmed };
  }

  if (type === 'markdown') {
    const m = trimmed.match(HEADING_PATTERNS.markdown);
    const level = m[1].length;
    const title = cleanTitle(m[2]);
    return { level, title, raw: trimmed };
  }

  if (type === 'chapter') {
    const title = cleanTitle(trimmed);
    return { level: 1, title, raw: trimmed };
  }

  if (type === 'sectionZh') {
    const title = cleanTitle(trimmed);
    return { level: 2, title, raw: trimmed };
  }

  if (type === 'section') {
    const m = trimmed.match(HEADING_PATTERNS.section);
    const nums = m[1].split('.');
    // 1 -> level 1, 1.2 -> level 2, 1.2.3 -> level 3
    const level = Math.min(4, Math.max(1, nums.length));
    const title = cleanTitle(trimmed);
    return { level, title, number: m[1], raw: trimmed };
  }

  if (type === 'numericChapter') {
    const title = cleanTitle(trimmed);
    return { level: 1, title, raw: trimmed };
  }

  if (type === 'chineseSection') {
    const title = cleanTitle(trimmed);
    return { level: 3, title, raw: trimmed };
  }

  if (type === 'bold') {
    const m = trimmed.match(HEADING_PATTERNS.bold);
    const title = cleanTitle(m[1]);
    return { level: 3, title, raw: trimmed };
  }

  if (type === 'fontSize') {
    const m = trimmed.match(HEADING_PATTERNS.fontSize);
    const fontSize = parseFloat(m[1]);
    let inner = m[2].trim();
    // 优先尝试用标题文本匹配章节/节编号，获得更准确的层级
    const innerKind = isHeadingLike(inner);
    if (innerKind) {
      const parsed = parseHeading(inner, innerKind.type);
      if (parsed && parsed.title && !isGarbageHeading(parsed.title)) {
        return { ...parsed, fontSize, raw: trimmed };
      }
    }
    const title = cleanTitle(inner);
    // 字号层级映射：优先用文档字号统计自适应，否则用固定阈值
    let level;
    if (fontSizeStats && fontSizeStats.median > 0) {
      // 自适应：相对中位字号的比例映射层级
      const ratio = fontSize / fontSizeStats.median;
      if (ratio >= 1.4) level = 1;
      else if (ratio >= 1.15) level = 2;
      else if (ratio >= 1.0) level = 3;
      else level = 4;
    } else {
      // 固定阈值兜底（无字号统计时）
      if (fontSize >= 15) level = 1;
      else if (fontSize >= 12) level = 2;
      else if (fontSize >= 10) level = 3;
      else level = 4;
    }
    return { level, title, fontSize, raw: trimmed };
  }

  if (type === 'shortLine') {
    return { level: 3, title: cleanTitle(trimmed), raw: trimmed };
  }

  if (type === 'bracketNumber') {
    return { level: 4, title: cleanTitle(trimmed), raw: trimmed };
  }

  if (type === 'alphaRoman') {
    const m = trimmed.match(HEADING_PATTERNS.alphaRoman);
    const prefix = m[1];
    // 罗马数字 I/II/III 通常级别更高
    const isRoman = /^[IVXivx]+$/.test(prefix);
    return { level: isRoman ? 2 : 3, title: cleanTitle(trimmed), raw: trimmed };
  }

  if (type === 'examQuestion') {
    return { level: 4, title: cleanTitle(trimmed), raw: trimmed };
  }

  if (type === 'stepNumber') {
    return { level: 4, title: cleanTitle(trimmed), raw: trimmed };
  }

  return null;
}

function cleanTitle(title) {
  return title
    .replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 标准化标题文本用于去重。
 * 忽略空格、编号前缀、大小写、常见连接符差异。
 */
function normalizeTitle(title) {
  return title
    .toLowerCase()
    // 去掉章节编号前缀（如 "一、", "1. ", "第一章"）
    .replace(/^\s*(?:第\s*[一二三四五六七八九十百千万\d]+\s*[章节节]|\d+(?:\.\d+)*)\s*[、．.\s]*/, '')
    // 去掉括号及其内部内容（常见分值/时间说明，如 "(每小题3分，共27分)"、"（本题满分12分）"）
    .replace(/[(（][^）)]*[)）]/g, '')
    // 去掉无括号的分值后缀（如 "每小题3分，共27分"、"本题满分12分"）
    .replace(/(?:每[大小]?题|本题|本大题)[^，,；;。!！?？]*分[^，,；;。!！?？]*(?:[，,]\s*共[^，,；;。!！?？]*分)?/g, '')
    .replace(/[\s\-_（）()\[\]【】]/g, '')
    .replace(/[：:]/g, '')
    .trim();
}

function findPageAtIndex(text, index) {
  const prefix = text.slice(0, index);
  const matches = [...prefix.matchAll(/---\s*第(\d+)页\s*---/g)];
  if (matches.length === 0) return 0;
  const last = matches[matches.length - 1];
  return parseInt(last[1], 10);
}

/**
 * 预处理：合并被 PDF 拆散的连续英文短行
 * 例如：
 *   "Lecture notes on Probability Theory and"
 *   "Statistics Inference"
 * 合并为：
 *   "Lecture notes on Probability Theory and Statistics Inference"
 */
function mergeBrokenEnglishLines(lines) {
  const merged = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = stripFontMarkers(line).trim();
    // 检查当前行是否是以连接词结尾的英文片段
    if (isFragmentedEnglish(trimmed)) {
      let j = i + 1;
      const collected = [trimmed];
      while (j < lines.length) {
        const nextTrimmed = stripFontMarkers(lines[j]).trim();
        if (!nextTrimmed) { j++; continue; }
        // 下一行还是英文片段，继续合并（跳过字号标记）
        if (/[a-zA-Z]/.test(nextTrimmed) && !looksLikeMathFormula(nextTrimmed)) {
          collected.push(nextTrimmed);
          i = j;
          j++;
          // 如果下一行不是以连接词结尾，说明已经完整
          if (!isFragmentedEnglish(nextTrimmed)) break;
        } else {
          break;
        }
      }
      if (collected.length > 1) {
        merged.push(collected.join(' '));
      } else {
        merged.push(stripFontMarkers(line));
      }
    } else {
      merged.push(stripFontMarkers(line));
    }
    i++;
  }
  return merged;
}

/**
 * 合并编号标题的断行。
 * 例如："1.2" + "随机变量" 合并为 "1.2 随机变量"
 * "第1章" + "概率论基础" 合并为 "第1章 概率论基础"
 * 只合并当前行是纯粹编号前缀、下一行是实质标题的情况。
 */
function mergeNumberedHeadingLines(lines) {
  const merged = [];
  let i = 0;
  const PURE_NUMBER_PREFIX = /^\s*(?:第\s*[一二三四五六七八九十百千万\d]+\s*[章节]|\d+(?:\.\d+)+|\d+[\.．、])\s*$/;
  while (i < lines.length) {
    const line = stripFontMarkers(lines[i]).trim();
    if (PURE_NUMBER_PREFIX.test(line)) {
      // 向前看一行
      let j = i + 1;
      while (j < lines.length && !stripFontMarkers(lines[j]).trim()) j++;
      if (j < lines.length) {
        const next = stripFontMarkers(lines[j]).trim();
        // 下一行不是页码、不是空行、不是公式、不是目录行
        if (next && !isPageNumber(next) && !looksLikeMathFormula(next) && !isTableOfContentsLine(next)) {
          merged.push(`${line.replace(/\s+$/, '')} ${next}`);
          i = j + 1;
          continue;
        }
      }
    }
    merged.push(line);
    i++;
  }
  return merged;
}

/**
 * 预检测目录区域。
 * 策略：
 * 1. 遇到“目录/contents”显式标记后，持续跳过 TOC 行直到遇到正文；
 * 2. 即使没有显式标记，若连续出现 ≥2 行 TOC 行，也视为目录区；
 * 3. 目录区结束：连续非 TOC 行 ≥3 行，或远离开始处 >120 行；
 * 4. 目录区域结束后增加 5 行缓冲区，缓冲区内的标题也跳过。
 * @returns {Array<[number, number]>} 目录区域的起止行索引（含头不含尾）
 */
function detectTocRegions(lines) {
  const TOC_BUFFER_LINES = 5; // 目录区域结束后的缓冲行数
  const regions = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // 显式目录标记
    if (TABLE_OF_CONTENTS_MARKERS.test(trimmed)) {
      const start = i;
      i++;
      let nonTocStreak = 0;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) { i++; continue; }
        if (isTableOfContentsLine(t) || TABLE_OF_CONTENTS_MARKERS.test(t)) {
          nonTocStreak = 0;
        } else {
          nonTocStreak++;
          // 遇到带字号标记的真正标题，提前结束
          if (nonTocStreak >= 3 || (nonTocStreak >= 1 && /^\[fs\d/.test(t))) break;
        }
        if (i - start > 120) break;
        i++;
      }
      // 增加缓冲区
      const endWithBuffer = Math.min(lines.length, i + TOC_BUFFER_LINES);
      regions.push([start, endWithBuffer]);
      i = endWithBuffer;
      continue;
    }

    // 隐式目录：连续 TOC 行（阈值降低为 ≥2）
    let consecutiveToc = 0;
    let j = i;
    while (j < lines.length && isTableOfContentsLine(lines[j].trim())) {
      consecutiveToc++;
      j++;
    }
    if (consecutiveToc >= 2) {
      const start = i;
      i = j;
      let nonTocStreak = 0;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t) { i++; continue; }
        if (isTableOfContentsLine(t)) {
          nonTocStreak = 0;
        } else {
          nonTocStreak++;
          if (nonTocStreak >= 3 || (nonTocStreak >= 1 && /^\[fs\d/.test(t))) break;
        }
        if (i - start > 120) break;
        i++;
      }
      // 增加缓冲区
      const endWithBuffer = Math.min(lines.length, i + TOC_BUFFER_LINES);
      regions.push([start, endWithBuffer]);
      i = endWithBuffer;
      continue;
    }

    i++;
  }
  return regions;
}

/**
 * 从文本中提取层级标题
 * @param {string} text - 文档全文
 * @param {object} [options] - 可选参数
 * @param {{median:number, max:number}} [options.fontSizeStats] - 文档字号统计（中位字号/最大字号），用于自适应层级映射
 * @returns {Array<{id:string, level:number, title:string, start:number, end:number, page:number, children:array}>}
 */
export function extractHeadings(text, options = {}) {
  if (!text) return [];
  const fontSizeStats = options.fontSizeStats || null;
  let lines = text.split(/\r?\n/);
  // 合并 PDF 中可能拆散的英文标题
  lines = mergeBrokenEnglishLines(lines);
  // 合并编号标题的断行：如 "1.2" + "随机变量" 合并为 "1.2 随机变量"
  lines = mergeNumberedHeadingLines(lines);
  const flat = [];
  // 单独收集书签标题，便于后续优先级判断
  const bookmarkHeadings = [];

  const tocRegions = detectTocRegions(lines);
  let tocRegionIdx = 0;

  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    // 跳过目录区域
    if (tocRegionIdx < tocRegions.length && i >= tocRegions[tocRegionIdx][0] && i < tocRegions[tocRegionIdx][1]) {
      charOffset += lines[i].length + 1;
      if (i === tocRegions[tocRegionIdx][1] - 1) tocRegionIdx++;
      continue;
    }

    const line = lines[i];
    const trimmed = line.trim();

    const nextLine = lines[i + 1] || '';
    const prevLine = lines[i - 1] || '';

    const kind = isHeadingLike(line, { before: prevLine, after: nextLine, fontSizeStats });
    if (kind) {
      const parsed = parseHeading(line, kind.type, { fontSizeStats });
      if (parsed && parsed.title && !isGarbageHeading(parsed.title)) {
        const heading = {
          id: `h_${flat.length}`,
          level: parsed.level,
          title: parsed.title,
          raw: parsed.raw,
          start: charOffset,
          page: findPageAtIndex(text, charOffset),
          type: kind.type
        };
        flat.push(heading);
        if (kind.type === 'bookmark') {
          bookmarkHeadings.push(heading);
        }
      }
    }
    charOffset += line.length + 1;
  }

  // 如果检测到 bookmark 类型标题数量 ≥3，则优先使用书签标题，
  // 跳过文本模式识别的其他标题（仅保留书签标题 + 去重）
  let candidates;
  if (bookmarkHeadings.length >= 3) {
    candidates = bookmarkHeadings;
  } else {
    candidates = flat;
  }

  // 根据标题位置推导每个标题的内容范围（到下一个同级或更高级标题之前）
  for (let i = 0; i < candidates.length; i++) {
    const cur = candidates[i];
    const next = candidates[i + 1];
    cur.end = next ? next.start : text.length;
  }

  // 后处理：全局去重，避免目录/页眉/页脚与正文重复识别同一章节。
  // 策略：
  //   1. 标准化后相同的标题视为同一章节，保留层级更低或位置更靠后的正文标题；
  //   2. 丢弃无法提取有效核心词的标题；
  //   3. 去重后必须按 start 重新排序，再构建层级树，避免替换破坏顺序。
  const bestByNorm = new Map(); // normalized -> heading
  for (const h of candidates) {
    const norm = normalizeTitle(h.title);
    if (!norm || norm.length < 2) continue;

    const existing = bestByNorm.get(norm);
    if (!existing) {
      bestByNorm.set(norm, h);
      continue;
    }

    // 标题重复时的保留策略：
    // - 层级更低（更具体）优先；
    // - 同层级时优先保留第一次出现的位置。对于附带参考答案/解析的试卷，
    //   第一次出现通常是题目正文中的章节标题，后面重复出现的是答案页标题，
    //   保留第一次可避免答案页产生重复标题节点。
    const shouldReplace = h.level > existing.level;
    if (shouldReplace) {
      bestByNorm.set(norm, h);
    }
  }

  // 按位置排序后构建树形结构
  let deduped = [...bestByNorm.values()].sort((a, b) => a.start - b.start);

  // 标准化试卷大题号的层级：一/二/三 + 选择题/填空题/解答题等统一为 level 2
  deduped = normalizeExamSectionLevels(deduped);

  return buildHeadingTree(deduped);
}

// 检测标题是否为试卷大题号（如 "一 选择题"、"二 填空题"、"三 解答题"）
export const EXAM_SECTION_PATTERN = /^[一二三四五六七八九十]+\s*[、．.\s]+(?:选择|填空|解答|判断|计算|证明|问答|综合|分析|应用|实验|论述|名词解释|简答|多选|单选)(?:题|部分|大题)/;

export function normalizeExamSectionLevels(flat) {
  for (const h of flat) {
    if (EXAM_SECTION_PATTERN.test(stripFontMarkers(h.title))) {
      h.level = 2;
    }
  }
  return flat;
}

function propagateHeadingEnd(nodes) {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      propagateHeadingEnd(node.children);
      const maxChildEnd = Math.max(...node.children.map(c => c.end || 0));
      node.end = Math.max(node.end || 0, maxChildEnd);
    }
  }
}

function buildHeadingTree(flat) {
  const root = { id: 'root', level: 0, title: '文档根', children: [], start: 0, end: 0 };
  const stack = [root];

  for (const item of flat) {
    const node = { ...item, children: [] };
    // 找到父节点：上一个 level 更小的节点
    while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  // 让父标题的 end 覆盖到所有后代标题，避免 findBestHeadingForOffset
  // 因父标题 end 等于子标题 start 而跳过子标题。
  propagateHeadingEnd(root.children);

  return root.children;
}

/**
 * 将标题树扁平化为带父级引用的列表，便于后续处理
 * @param {Array} tree - extractHeadings 返回的树
 * @returns {Array<{id, level, title, parentId, start, end, page}>}
 */
export function flattenHeadings(tree) {
  const result = [];
  function walk(nodes, parentId = null) {
    for (const node of nodes) {
      const { children, ...rest } = node;
      result.push({ ...rest, parentId });
      if (children && children.length) walk(children, node.id);
    }
  }
  walk(tree);
  return result;
}
