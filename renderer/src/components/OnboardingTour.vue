<template>
  <!-- Onboarding Tour — 大厂式交互引导 -->
  <transition name="tour-fade">
    <div v-if="visible" class="tour-root" @keydown="onKeydown" tabindex="-1" ref="rootEl">
      <!-- 遮罩 + 高亮窗口 -->
      <div class="tour-mask" @click.self="onMaskClick">
        <svg class="tour-mask-svg" :style="maskStyle">
          <defs>
            <mask id="tour-cutout">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                v-if="spotlightRect"
                :x="spotlightRect.x - 10"
                :y="spotlightRect.y - 10"
                :width="spotlightRect.w + 20"
                :height="spotlightRect.h + 20"
                :rx="borderRadius + 4"
                fill="black"
                class="tour-cutout-rect"
              />
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="var(--tour-mask-color)" mask="url(#tour-cutout)" />
        </svg>

        <!-- 高亮发光边框 -->
        <div v-if="spotlightRect" class="tour-highlight-border" :style="highlightStyle">
          <div class="tour-highlight-glow"></div>
        </div>

        <!-- 脉冲信标 — 引导注意 -->
        <div
          v-if="spotlightRect && beaconStyle"
          class="tour-beacon"
          :style="beaconStyle"
        >
          <span class="tour-beacon__ring"></span>
          <span class="tour-beacon__ring tour-beacon__ring--2"></span>
          <span class="tour-beacon__dot"></span>
        </div>

        <!-- 手势指引光标 -->
        <div
          v-if="spotlightRect && cursorStyle && currentStepData.showCursor"
          class="tour-cursor"
          :style="cursorStyle"
        >
          <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
            <path d="M4 2L4 18L8 14L11 21L14 19L11 12L17 12L4 2Z" fill="var(--tour-accent)" stroke="var(--tour-card-bg)" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
          <span class="tour-cursor__label">点击这里</span>
        </div>

        <!-- 交互式点击层 — 点击高亮元素自动前进 -->
        <div
          v-if="spotlightRect && currentStepData.interactive"
          class="tour-clickable"
          :style="highlightStyle"
          @click="onTargetClick"
        ></div>
      </div>

      <!-- 提示气泡 -->
      <transition name="tour-bubble-pop" mode="out-in">
        <div
          v-if="bubbleStyle"
          class="tour-bubble"
          :class="bubbleClass"
          :style="bubbleStyle"
          :key="currentStep"
          role="dialog"
          aria-modal="false"
          :aria-label="currentStepData.title"
        >
          <!-- 顶部：进度条 + 步骤号 -->
          <div class="tour-bubble__header">
            <div class="tour-bubble__progress-track">
              <div class="tour-bubble__progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <span class="tour-bubble__step-label">{{ currentStep + 1 }}/{{ steps.length }}</span>
          </div>

          <!-- 图标 + 标题 -->
          <div class="tour-bubble__body">
            <div class="tour-bubble__icon-wrap" :class="'tour-bubble__icon-wrap--' + currentStepData.color">
              <span v-html="currentStepData.iconSvg" class="tour-bubble__icon"></span>
            </div>
            <div class="tour-bubble__text">
              <h3 class="tour-bubble__title">{{ currentStepData.title }}</h3>
              <p class="tour-bubble__desc">{{ currentStepData.desc }}</p>
            </div>
          </div>

          <!-- 快捷键提示 -->
          <div v-if="currentStepData.shortcut" class="tour-bubble__shortcut">
            <kbd class="tour-kbd">{{ currentStepData.shortcut }}</kbd>
            <span class="tour-bubble__shortcut-text">{{ currentStepData.shortcutLabel }}</span>
          </div>

          <!-- 导航 -->
          <div class="tour-bubble__nav">
            <button v-if="currentStep > 0" class="tour-btn tour-btn--ghost" @click="prev">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div class="tour-nav-dots">
              <button
                v-for="(s, i) in steps"
                :key="i"
                class="tour-nav-dot"
                :class="{ 'tour-nav-dot--active': i === currentStep, 'tour-nav-dot--done': i < currentStep }"
                @click="goToStep(i)"
              >
                <svg v-if="i < currentStep" class="tour-nav-dot__check" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M20 6L9 17l-5-5"/></svg>
              </button>
            </div>
            <button class="tour-btn tour-btn--ghost tour-btn--skip-sm" @click="skip">
              跳过 <kbd class="tour-kbd tour-kbd--xs">Esc</kbd>
            </button>
            <button v-if="currentStep < steps.length - 1" class="tour-btn tour-btn--next" @click="next">
              {{ currentStep === 0 ? '开始探索' : '下一步' }}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <button v-else class="tour-btn tour-btn--finish" @click="finish">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              完成
            </button>
            <span v-if="currentStepData.interactive && currentStep < steps.length - 1" class="tour-hint-click">
              或点击高亮处
            </span>
          </div>

          <!-- 气泡箭头 -->
          <div class="tour-bubble__arrow" :class="'tour-bubble__arrow--' + arrowSide"></div>
        </div>
      </transition>

      <!-- 完成庆祝动画 -->
      <transition name="tour-celebrate">
        <div v-if="showCelebration" class="tour-celebration">
          <svg viewBox="0 0 200 160" class="tour-celebration__svg">
            <defs>
              <linearGradient id="celebGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--tour-accent)"/>
                <stop offset="100%" stop-color="var(--tour-violet)"/>
              </linearGradient>
            </defs>
            <circle cx="100" cy="70" r="32" fill="none" stroke="url(#celebGrad)" stroke-width="3" stroke-dasharray="201" stroke-dashoffset="201" stroke-linecap="round" transform="rotate(-90 100 70)" class="tour-celeb-ring"/>
            <path d="M 85 70 L 95 80 L 115 60" fill="none" stroke="url(#celebGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="tour-celeb-check"/>
            <g class="tour-celeb-confetti">
              <rect x="55" y="20" width="4" height="4" rx="1" fill="var(--tour-accent)" class="tour-confetti-piece tour-confetti-piece--1"/>
              <rect x="145" y="25" width="4" height="4" rx="1" fill="var(--tour-violet)" class="tour-confetti-piece tour-confetti-piece--2"/>
              <rect x="45" y="45" width="3" height="3" rx="1" fill="var(--tour-warm)" class="tour-confetti-piece tour-confetti-piece--3"/>
              <rect x="155" y="55" width="3" height="3" rx="1" fill="var(--tour-emerald)" class="tour-confetti-piece tour-confetti-piece--4"/>
              <rect x="75" y="15" width="3" height="3" rx="1" fill="var(--tour-rose)" class="tour-confetti-piece tour-confetti-piece--5"/>
              <rect x="125" y="18" width="3" height="3" rx="1" fill="var(--tour-accent)" class="tour-confetti-piece tour-confetti-piece--6"/>
              <rect x="100" y="10" width="3" height="3" rx="1" fill="var(--tour-violet)" class="tour-confetti-piece tour-confetti-piece--7"/>
              <rect x="40" y="80" width="3" height="3" rx="1" fill="var(--tour-warm)" class="tour-confetti-piece tour-confetti-piece--8"/>
              <rect x="160" y="90" width="3" height="3" rx="1" fill="var(--tour-emerald)" class="tour-confetti-piece tour-confetti-piece--9"/>
            </g>
          </svg>
        </div>
      </transition>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

const visible = ref(false)
const currentStep = ref(0)
const spotlightRect = ref(null)
const showCelebration = ref(false)
const borderRadius = ref(8)
const rootEl = ref(null)
let sampleImported = false

const STORAGE_KEY = 'ks-onboarding-completed'

// SVG 图标库 — 每步用不同颜色和图标
const ICONS = {
  docs: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  graph: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-5 6M12 11l5 6"/></svg>',
  build: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  idea: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  done: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>'
}

const steps = [
  {
    selector: '.nav-btn', textMatch: '文献',
    title: '文献管理',
    desc: '已为你导入示例论文。左侧列表查看文档，右侧阅读器查看内容。',
    color: 'cyan', iconSvg: ICONS.docs,
    showCursor: false, interactive: false
  },
  {
    selector: '.file-explorer__header .btn--primary',
    title: '导入文档',
    desc: '上传 PDF、Markdown 或文本文件，自动解析章节结构。',
    color: 'cyan', iconSvg: ICONS.upload,
    shortcut: 'Ctrl+O', shortcutLabel: '快速导入',
    showCursor: true, interactive: true
  },
  {
    selector: '.nav-btn', textMatch: '图谱',
    title: '知识图谱',
    desc: '切换到图谱视图，构建可视化知识网络。',
    color: 'violet', iconSvg: ICONS.graph,
    showCursor: false, interactive: false
  },
  {
    selector: '.btn--build',
    title: '构建图谱',
    desc: 'AI 自动提取实体和关系，生成知识网络。',
    color: 'violet', iconSvg: ICONS.build,
    showCursor: true, interactive: true
  },
  {
    selector: '.topbar__search-wrap',
    title: '搜索知识',
    desc: '输入关键词搜索，或使用语义匹配跨文档查找。',
    color: 'amber', iconSvg: ICONS.search,
    shortcut: 'Ctrl+K', shortcutLabel: '快速搜索',
    showCursor: false, interactive: false
  },
  {
    selector: '.nav-btn', textMatch: '灵感',
    title: '灵感笔记',
    desc: '用 Markdown 记录思路，支持标签和层级结构。',
    color: 'rose', iconSvg: ICONS.idea,
    showCursor: false, interactive: false
  },
  {
    selector: '.icon-btn--settings, .topbar__actions .icon-btn',
    title: '设置与模型',
    desc: '配置 LLM 模型（如 Ollama），开启 AI 功能。',
    color: 'amber', iconSvg: ICONS.settings,
    showCursor: true, interactive: true
  },
  {
    selector: null,
    title: '全部就绪！',
    desc: '你已掌握所有核心功能。开始构建你的知识图谱吧。',
    color: 'emerald', iconSvg: ICONS.done,
    showCursor: false, interactive: false
  }
]

const currentStepData = computed(() => steps[currentStep.value])
const progressPercent = computed(() => ((currentStep.value + 1) / steps.length) * 100)

const maskStyle = computed(() => ({
  position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
  pointerEvents: 'none', zIndex: 9998
}))

const highlightStyle = computed(() => {
  if (!spotlightRect.value) return {}
  const r = spotlightRect.value
  return {
    position: 'fixed',
    left: (r.x - 10) + 'px', top: (r.y - 10) + 'px',
    width: (r.w + 20) + 'px', height: (r.h + 20) + 'px',
    borderRadius: (borderRadius.value + 4) + 'px'
  }
})

// 脉冲信标位置 — 放在高亮元素右上角
const beaconStyle = computed(() => {
  if (!spotlightRect.value) return null
  const r = spotlightRect.value
  return {
    position: 'fixed',
    left: (r.x + r.w - 4) + 'px',
    top: (r.y - 4) + 'px'
  }
})

// 手势光标位置 — 指向高亮元素中心
const cursorStyle = computed(() => {
  if (!spotlightRect.value) return null
  const r = spotlightRect.value
  return {
    position: 'fixed',
    left: (r.x + r.w / 2 - 10) + 'px',
    top: (r.y + r.h / 2 - 12) + 'px'
  }
})

const bubbleStyle = ref(null)
const bubbleClass = ref('')
const arrowSide = ref('bottom')

function computeBubblePosition(rect) {
  if (!rect) {
    bubbleClass.value = 'tour-bubble--center'
    arrowSide.value = 'none'
    bubbleStyle.value = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    return
  }

  const rw = rect.width ?? rect.w
  const rh = rect.height ?? rect.h
  const rx = rect.x ?? rect.left
  const ry = rect.y ?? rect.top

  const bubbleW = 300
  const bubbleH = 200
  const margin = 16
  const gap = 40

  function inBounds(t, l) {
    return t >= margin && l >= margin &&
      t + bubbleH <= window.innerHeight - margin &&
      l + bubbleW <= window.innerWidth - margin
  }
  function overlapsRect(t, l) {
    return !(l + bubbleW <= rx - gap || l >= rx + rw + gap ||
             t + bubbleH <= ry - gap || t >= ry + rh + gap)
  }

  const maxLeft = window.innerWidth - bubbleW - margin
  const maxTop = window.innerHeight - bubbleH - margin

  const candidates = [
    { side: 'top',    top: ry + rh + gap,              left: Math.max(margin, Math.min(rx + rw / 2 - bubbleW / 2, maxLeft)) },
    { side: 'left',   top: Math.max(margin, Math.min(ry + rh / 2 - bubbleH / 2, maxTop)),  left: rx + rw + gap },
    { side: 'bottom', top: ry - gap - bubbleH,         left: Math.max(margin, Math.min(rx + rw / 2 - bubbleW / 2, maxLeft)) },
    { side: 'right',  top: Math.max(margin, Math.min(ry + rh / 2 - bubbleH / 2, maxTop)),  left: rx - gap - bubbleW },
  ]

  let chosen = null
  for (const c of candidates) {
    if (inBounds(c.top, c.left) && !overlapsRect(c.top, c.left)) { chosen = c; break }
  }
  if (!chosen) {
    for (const c of candidates) { if (inBounds(c.top, c.left)) { chosen = c; break } }
  }
  if (!chosen) {
    const scx = window.innerWidth / 2, scy = window.innerHeight / 2
    let bestDist = Infinity
    for (const c of candidates) {
      const dist = Math.hypot(c.left + bubbleW / 2 - scx, c.top + bubbleH / 2 - scy)
      if (!isNaN(dist) && dist < bestDist) { bestDist = dist; chosen = c }
    }
  }
  if (!chosen) { chosen = candidates[0] }

  const top = Math.max(margin, Math.min(chosen.top, window.innerHeight - bubbleH - margin))
  const left = Math.max(margin, Math.min(chosen.left, window.innerWidth - bubbleW - margin))
  arrowSide.value = chosen.side
  bubbleClass.value = 'tour-bubble--' + chosen.side
  bubbleStyle.value = { position: 'fixed', top: top + 'px', left: left + 'px', width: bubbleW + 'px' }
}

function findTargetElement(step) {
  if (!step.selector) return null
  let el = null
  if (step.textMatch) {
    const candidates = document.querySelectorAll(step.selector)
    for (const c of candidates) {
      if (c.textContent.includes(step.textMatch)) { el = c; break }
    }
  } else {
    el = document.querySelector(step.selector)
  }
  if (!el || el.offsetWidth === 0) return null
  return el
}

async function updateSpotlight() {
  try {
    const step = steps[currentStep.value]
    if (!step.selector) {
      spotlightRect.value = null
      computeBubblePosition(null)
      if (currentStep.value === steps.length - 1) {
        showCelebration.value = true
        setTimeout(() => { showCelebration.value = false }, 3000)
      }
      return
    }

    await nextTick()
    await new Promise(r => setTimeout(r, 200))

    let el = findTargetElement(step)
    if (!el) {
      await new Promise(r => setTimeout(r, 300))
      el = findTargetElement(step)
    }
    if (!el) {
      await new Promise(r => setTimeout(r, 500))
      el = findTargetElement(step)
    }
    if (!el) {
      await new Promise(r => setTimeout(r, 600))
      el = findTargetElement(step)
    }

    if (!el) {
      spotlightRect.value = null
      computeBubblePosition(null)
      return
    }

    const rect = el.getBoundingClientRect()
    if (!rect || rect.width === 0) {
      spotlightRect.value = null
      computeBubblePosition(null)
      return
    }
    let computed = window.getComputedStyle(el)
    borderRadius.value = parseInt(computed.borderRadius) || 8
    spotlightRect.value = { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    computeBubblePosition(rect)

    if (rect.y < 0 || rect.y + rect.height > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      await new Promise(r => setTimeout(r, 350))
      const newRect = el.getBoundingClientRect()
      if (newRect && newRect.width > 0) {
        spotlightRect.value = { x: newRect.x, y: newRect.y, w: newRect.width, h: newRect.height }
        computeBubblePosition(newRect)
      }
    }
  } catch (e) {
    console.warn('[OnboardingTour] updateSpotlight error:', e)
    spotlightRect.value = null
    computeBubblePosition(null)
  }
}

async function handleStepTransition(stepIdx) {
  try {
    const step = steps[stepIdx]
    showCelebration.value = false

    if ((stepIdx === 2 || stepIdx === 3) && window.__ksUiStore) {
      if (window.__ksUiStore.activeView !== 'graph') {
        window.__ksUiStore.setView('graph')
        await new Promise(r => setTimeout(r, 700))
      }
    } else if (stepIdx === 5 && window.__ksUiStore) {
      if (window.__ksUiStore.activeView !== 'idea') {
        window.__ksUiStore.setView('idea')
        await new Promise(r => setTimeout(r, 700))
      }
    } else if ((stepIdx === 0 || stepIdx === 1) && window.__ksUiStore) {
      if (window.__ksUiStore.activeView !== 'documents') {
        window.__ksUiStore.setView('documents')
        await new Promise(r => setTimeout(r, 700))
      }
    }

    await updateSpotlight()
  } catch (e) {
    console.warn('[OnboardingTour] handleStepTransition error:', e)
    computeBubblePosition(null)
  }
}

function show() {
  visible.value = true
  currentStep.value = 0
  nextTick(() => handleStepTransition(0))
  // 自动导入示例文档，供新手教学展示
  importSampleDoc()
}

async function importSampleDoc() {
  if (sampleImported) return
  sampleImported = true
  try {
    const res = await fetch('/api/documents/import-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    const data = await res.json()
    if (data.success && !data.skipped) {
      // 文档导入成功后通知 store 刷新文档列表
      window.__ksDocStore?.load?.()
    }
  } catch (e) {
    console.warn('[OnboardingTour] 示例文档导入失败:', e)
    sampleImported = false
  }
}
function next() {
  if (currentStep.value < steps.length - 1) { currentStep.value++; handleStepTransition(currentStep.value) }
  else finish()
}
function prev() {
  if (currentStep.value > 0) { currentStep.value--; handleStepTransition(currentStep.value) }
}
function goToStep(i) { currentStep.value = i; handleStepTransition(i) }
function skip() { visible.value = false; localStorage.setItem(STORAGE_KEY, 'skipped') }
function finish() { visible.value = false; localStorage.setItem(STORAGE_KEY, 'completed') }

function onKeydown(e) {
  switch (e.key) {
    case 'Escape': e.preventDefault(); skip(); break
    case 'ArrowRight': e.preventDefault(); next(); break
    case 'ArrowLeft': e.preventDefault(); prev(); break
    case 'Enter': e.preventDefault(); next(); break
  }
}

function onMaskClick() {
  // 大厂模式：点击遮罩不跳下一步，防止误触
}

function onTargetClick() {
  // 交互式引导：点击高亮元素自动前进到下一步
  next()
}

function onResize() { if (visible.value) updateSpotlight() }

defineExpose({ show, visible })

onMounted(() => {
  const completed = localStorage.getItem(STORAGE_KEY)
  if (!completed) { setTimeout(() => show(), 1500) }
  // 支持 URL hash #onboarding 强制触发引导（测试用）
  if (window.location.hash === '#onboarding') {
    localStorage.removeItem(STORAGE_KEY)
    setTimeout(() => show(), 500)
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('ks-show-onboarding', show)
  // 全局键盘监听 — 即使焦点不在 root 上也能响应
  window.addEventListener('keydown', onKeydownGlobal)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('ks-show-onboarding', show)
  window.removeEventListener('keydown', onKeydownGlobal)
})

function onKeydownGlobal(e) {
  if (!visible.value) return
  onKeydown(e)
}
</script>

<style scoped>
.tour-root {
  position: fixed; inset: 0; z-index: 9999; pointer-events: none;
  --tour-accent: var(--accent, #0d9488);
  --tour-violet: var(--violet, #7c3aed);
  --tour-warm: var(--warm, #ea580c);
  --tour-emerald: var(--emerald, #059669);
  --tour-rose: var(--rose, #e11d48);
  --tour-card-bg: var(--bg-card, #ffffff);
  --tour-text: var(--text, #1c1917);
  --tour-text-2: var(--text-2, #57534e);
  --tour-text-3: var(--text-3, #a8a29e);
  --tour-border: var(--border, rgba(100,70,40,0.10));
  --tour-mask-color: rgba(30, 25, 20, 0.72);
}
:global([data-theme="dark"]) .tour-root {
  --tour-mask-color: rgba(5, 8, 18, 0.82);
}

.tour-mask { position: fixed; inset: 0; pointer-events: auto; }
.tour-mask-svg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
.tour-cutout-rect { transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1); }

/* 高亮边框 */
.tour-highlight-border {
  position: fixed; pointer-events: none; z-index: 9997;
  border: 2px solid transparent;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--tour-accent), var(--tour-violet)) border-box;
  -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: tour-border-pulse 2s ease-in-out infinite;
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 交互式点击层 — 在高亮边框上方，但不遮挡信标 */
.tour-clickable {
  position: fixed; z-index: 9998;
  cursor: pointer;
  border-radius: 12px;
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.tour-clickable:hover {
  background: rgba(13, 148, 136, 0.06);
}
@keyframes tour-border-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(13,148,136,0.12), 0 0 24px rgba(13,148,136,0.2); }
  50% { box-shadow: 0 0 0 6px rgba(13,148,136,0.2), 0 0 40px rgba(13,148,136,0.35); }
}
:global([data-theme="dark"]) .tour-highlight-border {
  box-shadow: 0 0 0 4px rgba(6,182,212,0.15), 0 0 24px rgba(6,182,212,0.2);
}
.tour-highlight-glow {
  position: absolute; inset: -4px; border-radius: 14px;
  background: radial-gradient(circle, rgba(13,148,136,0.08), transparent 70%);
  pointer-events: none;
}

/* 脉冲信标 */
.tour-beacon {
  position: fixed; z-index: 9999;
  width: 14px; height: 14px;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.tour-beacon__dot {
  position: absolute; inset: 4px;
  border-radius: 50%;
  background: var(--tour-warm);
  box-shadow: 0 0 8px var(--tour-warm);
  animation: tour-beacon-dot 1.5s ease-in-out infinite;
}
.tour-beacon__ring {
  position: absolute; inset: 0;
  border-radius: 50%;
  border: 2px solid var(--tour-warm);
  animation: tour-beacon-ring 1.5s ease-out infinite;
}
.tour-beacon__ring--2 { animation-delay: 0.5s; }
@keyframes tour-beacon-dot { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.3); } }
@keyframes tour-beacon-ring {
  0% { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* 手势光标 */
.tour-cursor {
  position: fixed; z-index: 9999;
  pointer-events: none;
  animation: tour-cursor-bounce 1.2s ease-in-out infinite;
}
@keyframes tour-cursor-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(6px); }
}
.tour-cursor__label {
  display: block;
  font-size: 10px; font-weight: 600;
  color: var(--tour-accent);
  background: var(--tour-card-bg);
  padding: 2px 6px; border-radius: 4px;
  white-space: nowrap;
  margin-top: 2px;
  border: 1px solid var(--tour-border);
}

/* 气泡 */
.tour-bubble {
  position: fixed; z-index: 10000; pointer-events: auto;
  background: var(--tour-card-bg);
  border: 1px solid var(--tour-border);
  border-radius: 12px;
  padding: 14px 16px 12px;
  box-shadow: 0 8px 32px rgba(60,50,40,0.12), 0 0 24px rgba(13,148,136,0.06);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
:global([data-theme="dark"]) .tour-bubble {
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 24px rgba(6,182,212,0.08);
}
.tour-bubble::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--tour-accent), var(--tour-violet));
  border-radius: 12px 12px 0 0;
}

.tour-bubble--center {
  transform: translate(-50%, -50%) !important;
}

/* 进度条 */
.tour-bubble__header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.tour-bubble__progress-track {
  flex: 1; height: 3px;
  background: var(--tour-border);
  border-radius: 2px; overflow: hidden;
}
.tour-bubble__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--tour-accent), var(--tour-violet));
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.tour-bubble__step-label {
  font-size: 10px; font-weight: 700; color: var(--tour-text-3);
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
}

/* 图标 + 文本 */
.tour-bubble__body {
  display: flex; gap: 12px; align-items: flex-start;
  margin-bottom: 10px;
}
.tour-bubble__icon-wrap {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tour-bubble__icon-wrap--cyan { background: rgba(13,148,136,0.12); color: var(--tour-accent); }
.tour-bubble__icon-wrap--violet { background: rgba(124,58,237,0.12); color: var(--tour-violet); }
.tour-bubble__icon-wrap--amber { background: rgba(234,88,12,0.12); color: var(--tour-warm); }
.tour-bubble__icon-wrap--rose { background: rgba(225,29,72,0.12); color: var(--tour-rose); }
.tour-bubble__icon-wrap--emerald { background: rgba(5,150,105,0.12); color: var(--tour-emerald); }

.tour-bubble__icon { display: flex; }
.tour-bubble__icon svg { animation: tour-icon-in 0.4s ease-out; }
@keyframes tour-icon-in {
  from { transform: scale(0.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.tour-bubble__text { flex: 1; min-width: 0; }
.tour-bubble__title {
  font-size: 14px; font-weight: 600; color: var(--tour-text);
  margin-bottom: 3px; letter-spacing: -0.01em;
}
.tour-bubble__desc {
  font-size: 12px; color: var(--tour-text-2); line-height: 1.5;
}

/* 快捷键 */
.tour-bubble__shortcut {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 10px; padding: 5px 8px;
  background: var(--tour-border);
  border-radius: 6px;
}
.tour-kbd {
  font-size: 10px; font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  padding: 2px 6px; border-radius: 3px;
  background: var(--tour-card-bg);
  border: 1px solid var(--tour-border);
  color: var(--tour-text);
}
.tour-kbd--xs { font-size: 9px; padding: 1px 4px; }
.tour-hint-click {
  font-size: 10px; color: var(--tour-text-3);
  margin-left: 4px; white-space: nowrap;
  font-style: italic;
}
.tour-bubble__shortcut-text {
  font-size: 11px; color: var(--tour-text-2);
}

/* 导航 */
.tour-bubble__nav {
  display: flex; align-items: center; gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--tour-border);
  flex-wrap: wrap;
}
.tour-nav-dots {
  display: flex; gap: 3px; flex: 1; justify-content: center;
  min-width: 0;
}
.tour-nav-dot {
  width: 16px; height: 16px; border-radius: 50%;
  border: none; padding: 0; cursor: pointer;
  background: var(--tour-border);
  display: flex; align-items: center; justify-content: center;
  color: var(--tour-emerald);
  transition: all 0.25s;
  flex-shrink: 0;
}
.tour-nav-dot--active {
  width: 22px; border-radius: 4px;
  background: linear-gradient(135deg, var(--tour-accent), var(--tour-violet));
}
.tour-nav-dot--done { background: rgba(5,150,105,0.2); }
.tour-nav-dot__check { display: block; }
.tour-nav-dot:hover { transform: scale(1.15); }

.tour-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; font-size: 12px; font-weight: 500;
  border-radius: 6px; cursor: pointer;
  transition: all 0.2s; font-family: inherit;
  border: 1px solid var(--tour-border);
  background: transparent; color: var(--tour-text-2);
}
.tour-btn:hover { background: var(--tour-border); color: var(--tour-text); }
.tour-btn--ghost { padding: 6px 8px; }
.tour-btn--skip-sm { font-size: 11px; color: var(--tour-text-3); }
.tour-btn--next, .tour-btn--finish {
  background: linear-gradient(135deg, var(--tour-accent), var(--tour-violet));
  border-color: transparent; color: #fff; font-weight: 600;
  box-shadow: 0 3px 12px rgba(13,148,136,0.2);
}
.tour-btn--next:hover, .tour-btn--finish:hover {
  box-shadow: 0 4px 20px rgba(13,148,136,0.3); transform: translateY(-1px);
}

/* 箭头 */
.tour-bubble__arrow { position: absolute; width: 0; height: 0; border-style: solid; }
.tour-bubble__arrow--top { top: -7px; left: 50%; transform: translateX(-50%); border-width: 0 7px 7px 7px; border-color: transparent transparent var(--tour-card-bg) transparent; }
.tour-bubble__arrow--bottom { bottom: -7px; left: 50%; transform: translateX(-50%); border-width: 7px 7px 0 7px; border-color: var(--tour-card-bg) transparent transparent transparent; }
.tour-bubble__arrow--left { left: -7px; top: 50%; transform: translateY(-50%); border-width: 7px 7px 7px 0; border-color: transparent var(--tour-card-bg) transparent transparent; }
.tour-bubble__arrow--right { right: -7px; top: 50%; transform: translateY(-50%); border-width: 7px 0 7px 7px; border-color: transparent transparent transparent var(--tour-card-bg); }
.tour-bubble__arrow--none { display: none; }

/* 完成庆祝 */
.tour-celebration {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10001;
  pointer-events: none;
}
.tour-celebration__svg { width: 160px; height: 130px; }
.tour-celeb-ring { animation: tour-ring-draw 0.8s ease-out forwards; }
@keyframes tour-ring-draw { to { stroke-dashoffset: 0; } }
.tour-celeb-check {
  stroke-dasharray: 50; stroke-dashoffset: 50;
  animation: tour-check-draw 0.4s ease-out 0.6s forwards;
}
@keyframes tour-check-draw { to { stroke-dashoffset: 0; } }
.tour-confetti-piece { opacity: 0; animation: tour-confetti 1.2s ease-out 1s forwards; }
.tour-confetti-piece--2 { animation-delay: 1.1s; }
.tour-confetti-piece--3 { animation-delay: 1.05s; }
.tour-confetti-piece--4 { animation-delay: 1.15s; }
.tour-confetti-piece--5 { animation-delay: 1.2s; }
.tour-confetti-piece--6 { animation-delay: 1.25s; }
.tour-confetti-piece--7 { animation-delay: 1.3s; }
.tour-confetti-piece--8 { animation-delay: 1.35s; }
.tour-confetti-piece--9 { animation-delay: 1.4s; }
@keyframes tour-confetti {
  0% { opacity: 0; transform: translateY(-10px) rotate(0); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: translateY(40px) rotate(180deg); }
}

/* Transitions */
.tour-fade-enter-active, .tour-fade-leave-active { transition: opacity 0.3s ease; }
.tour-fade-enter-from, .tour-fade-leave-to { opacity: 0; }
.tour-bubble-pop-enter-active { animation: tour-pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.tour-bubble-pop-leave-active { animation: tour-pop-out 0.2s ease-in; }
@keyframes tour-pop-in { from { opacity: 0; transform: scale(0.88) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
@keyframes tour-pop-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.92); } }
.tour-celebrate-enter-active { animation: tour-celeb-in 0.4s ease-out; }
.tour-celebrate-leave-active { animation: tour-celeb-out 0.3s ease-in 2.7s forwards; }
@keyframes tour-celeb-in { from { opacity: 0; transform: translate(-50%, -50%) scale(0.5); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes tour-celeb-out { to { opacity: 0; } }

@media (max-width: 600px) {
  .tour-bubble { width: 280px !important; }
}
</style>
