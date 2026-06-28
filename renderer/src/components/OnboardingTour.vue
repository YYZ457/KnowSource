<script setup>
/** OnboardingTour — 新手引导：首次启动自动播放 + 帮助按钮可重播
 *  增强版：支持通过 CSS 选择器高亮目标元素，覆盖导入/图谱/节点列表/Idea/模型实验室等核心区域
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';

const emit = defineEmits(['finish']);

// 步骤定义：target 为 CSS 选择器，用于高亮目标元素；无 target 时居中显示
const steps = [
  {
    emoji: '📘',
    title: '欢迎来到 知源',
    text: '这是一款面向科研与工程的知识工作台。接下来用 30 秒带你了解核心操作。',
    spotlight: '🚀',
    target: null
  },
  {
    emoji: '📁',
    title: '导入文档',
    text: '在左侧文件列表区域点击「+ 导入文件」，可加载 PDF、Word、PPTX、Markdown 或文本文件，系统会自动解析并构建知识图谱。',
    spotlight: '📂',
    target: '.file-explorer .panel-toolbar, .ide-app .splitpanes__pane:first-child .panel-toolbar'
  },
  {
    emoji: '🕸️',
    title: '查看知识图谱',
    text: '文档导入后会自动构建知识图谱。右侧图谱区域展示概念节点及其关联，可拖拽、缩放、点击节点查看详情。',
    spotlight: '🔍',
    target: '.graph-view, .ide-right .graph-view'
  },
  {
    emoji: '🌳',
    title: '展开节点列表',
    text: '图谱下方有树形节点列表，可按文档/社区浏览所有概念，快速定位感兴趣的节点。',
    spotlight: '📋',
    target: '.tree-node, .ide-right .tree-node'
  },
  {
    emoji: '🖱️',
    title: '双击跳转',
    text: '在图谱或节点列表中双击任意节点，可跳转到对应文档并高亮关键词位置，方便溯源阅读。',
    spotlight: '🎯',
    target: '.graph-svg, .ide-right .graph-svg'
  },
  {
    emoji: '💡',
    title: 'Idea 面板',
    text: '点击右侧「Idea」标签，随时记录灵感。系统会基于图谱智能推荐相关知识节点，激发跨文档思考。',
    spotlight: '💡',
    target: '.right-tabs button:nth-child(2), .ide-right .right-tabs button:nth-child(2)'
  },
  {
    emoji: '🧪',
    title: '模型实验室',
    text: '点击右侧「模型」标签进入模型实验室，可对比不同 LLM 在术语抽取上的效果，调优知识图谱质量。',
    spotlight: '🧪',
    target: '.right-tabs button:nth-child(3), .ide-right .right-tabs button:nth-child(3)'
  },
  {
    emoji: '🔎',
    title: '全域搜索',
    text: '顶部搜索框支持关键词 + 语义 + 图结构三层混合检索，快速找到最相关的知识。',
    spotlight: '🔎',
    target: '.search-panel, .ide-topbar .search-panel'
  },
  {
    emoji: '✨',
    title: '开始探索吧',
    text: '你可以随时点击顶部「?」按钮重新观看引导。祝使用愉快！',
    spotlight: '🎉',
    target: null
  }
];

const current = ref(0);
const step = computed(() => steps[current.value]);
const isLast = computed(() => current.value === steps.length - 1);

// 高亮目标元素的矩形信息
const highlightRect = ref(null);
// 窗口尺寸（模板中不能直接访问 window 对象）
const winW = ref(typeof window !== 'undefined' ? window.innerWidth : 1920);
const winH = ref(typeof window !== 'undefined' ? window.innerHeight : 1080);

async function updateHighlight() {
  await nextTick();
  // 同步窗口尺寸
  winW.value = window.innerWidth;
  winH.value = window.innerHeight;
  const s = step.value;
  if (!s.target) {
    highlightRect.value = null;
    return;
  }
  const selectors = s.target.split(',').map(t => t.trim());
  let el = null;
  for (const sel of selectors) {
    el = document.querySelector(sel);
    if (el) break;
  }
  if (!el) {
    highlightRect.value = null;
    return;
  }
  const rect = el.getBoundingClientRect();
  highlightRect.value = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
  // 滚动目标元素到可视区域
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  } catch {}
}

function next() {
  if (isLast.value) {
    emit('finish');
  } else {
    current.value++;
    updateHighlight();
  }
}

function prev() {
  if (current.value > 0) {
    current.value--;
    updateHighlight();
  }
}

function skip() {
  emit('finish');
}

function onKeydown(e) {
  if (e.key === 'Escape') skip();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
  else if (e.key === 'ArrowLeft') prev();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', updateHighlight);
  updateHighlight();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', updateHighlight);
});
</script>

<template>
  <Transition name="fade" appear>
    <div class="onboarding-overlay" role="dialog" aria-modal="false" aria-labelledby="tour-title" @click.self="skip">
      <!-- 高亮框：在目标元素周围绘制半透明遮罩留白 -->
      <div v-if="highlightRect" class="highlight-box" aria-hidden="true"
           :style="{
             top: (highlightRect.top - 6) + 'px',
             left: (highlightRect.left - 6) + 'px',
             width: (highlightRect.width + 12) + 'px',
             height: (highlightRect.height + 12) + 'px'
           }">
      </div>

      <!-- 引导卡片：定位到高亮元素附近，否则居中 -->
      <div class="onboarding-step" :key="current"
           :class="{anchored: !!highlightRect}"
           :style="highlightRect ? {
             top: Math.min(highlightRect.top + highlightRect.height + 16, winH - 280) + 'px',
             left: Math.max(16, Math.min(highlightRect.left, winW - 440)) + 'px'
           } : {}">
        <div class="spotlight">{{ step.spotlight }}</div>
        <div class="emoji">{{ step.emoji }}</div>
        <h3 id="tour-title">{{ step.title }}</h3>
        <p>{{ step.text }}</p>
        <div class="onboarding-progress">
          <span v-for="(s, i) in steps" :key="i" :class="{active: i === current, done: i < current}"></span>
        </div>
        <div class="onboarding-actions">
          <button class="secondary" @click="skip">跳过</button>
          <button v-if="current > 0" class="secondary" @click="prev">上一步</button>
          <button class="primary" @click="next">{{ isLast ? '开始使用' : '下一步' }}</button>
        </div>
        <div class="onboarding-hint">提示：← → 切换步骤，Esc 跳过</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.onboarding-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
}

/* 高亮框：通过 box-shadow 制造四周遮罩留白效果 */
.highlight-box {
  position: fixed;
  border-radius: 8px;
  background: transparent;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  border: 2px solid var(--accent);
  pointer-events: none;
  z-index: calc(var(--z-modal) + 1);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  animation: highlightPulse 2s infinite;
}
@keyframes highlightPulse {
  0%, 100% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 0 0 rgba(37, 99, 235, 0.5); }
  50% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 0 8px rgba(37, 99, 235, 0); }
}

.onboarding-step {
  position: relative;
  background: var(--bg-primary);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  width: 420px;
  max-width: 90vw;
  padding: 24px;
  text-align: center;
  animation: popIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: calc(var(--z-modal) + 2);
}
.onboarding-step.anchored {
  position: fixed;
  margin: 0;
}
@keyframes popIn {
  from { opacity: 0; transform: scale(0.92) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.onboarding-step .emoji {
  font-size: 48px; margin-bottom: 12px;
  display: inline-block;
  animation: bounce 1.2s infinite ease-in-out;
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.onboarding-step h3 {
  font-size: 18px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;
}
.onboarding-step p {
  font-size: 14px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 20px;
}
.onboarding-step .spotlight {
  margin: 16px auto;
  width: 80px; height: 80px;
  border-radius: 50%;
  background: var(--accent-bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4); }
  70% { box-shadow: 0 0 0 20px rgba(37, 99, 235, 0); }
  100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
.onboarding-progress {
  display: flex; justify-content: center; gap: 6px; margin-bottom: 20px; flex-wrap: wrap;
}
.onboarding-progress span {
  width: 8px; height: 8px; border-radius: 50%; background: var(--border);
  transition: background 0.2s, transform 0.2s;
}
.onboarding-progress span.active { background: var(--accent); transform: scale(1.3); }
.onboarding-progress span.done { background: var(--accent-light); }
.onboarding-actions {
  display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;
}
.onboarding-actions button {
  padding: 8px 18px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.15s;
}
.onboarding-actions .primary { background: var(--accent); color: #fff; border: none; }
.onboarding-actions .secondary { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border); }
.onboarding-actions .primary:hover { background: var(--accent-light); }
.onboarding-actions .secondary:hover { background: var(--bg-hover); color: var(--text-primary); }
.onboarding-hint {
  margin-top: 14px; font-size: 11px; color: var(--text-tertiary);
}
</style>
