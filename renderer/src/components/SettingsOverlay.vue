<!--
  SettingsOverlay.vue — 设置覆盖层
  通过齿轮图标打开，包含模型配置、提示词模板、关于三个标签页
-->
<template>
  <transition name="settings-fade">
    <div v-if="uiStore.settingsOpen" class="settings-overlay" @click.self="close">
      <div class="settings-modal">
        <!-- ===== Header ===== -->
        <header class="settings-header">
          <div class="settings-header__title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span>设置</span>
          </div>
          <button class="icon-btn settings-close" @click="close" title="关闭设置">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
          </button>
        </header>

        <!-- ===== Body ===== -->
        <div class="settings-body">
          <!-- Sidebar Tabs -->
          <nav class="settings-nav">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="settings-nav__item"
              :class="{ 'settings-nav__item--active': uiStore.settingsTab === tab.key }"
              @click="uiStore.settingsTab = tab.key"
            >
              <span class="settings-nav__icon" v-html="tab.icon"></span>
              <span class="settings-nav__label">{{ tab.label }}</span>
              <span v-if="tab.badge" class="settings-nav__badge">{{ tab.badge }}</span>
            </button>
          </nav>

          <!-- Content Area -->
          <div class="settings-content">
            <ModelLab v-show="uiStore.settingsTab === 'model'" :embedded="true" />
            <PromptLab v-show="uiStore.settingsTab === 'prompts'" :embedded="true" />
            <div v-if="uiStore.settingsTab === 'about'" class="settings-about">
              <div class="about-card">
                <div class="about-logo">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="url(#aboutGrad)" stroke-width="2" stroke-linejoin="round"/>
                    <circle cx="12" cy="12" r="3" fill="url(#aboutGrad)"/>
                    <defs><linearGradient id="aboutGrad" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#06b6d4"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
                  </svg>
                </div>
                <h2>知源 KnowSource</h2>
                <p class="about-version">v2.2.0</p>
                <p class="about-desc">科研知识工作台 — 多文献阅读、知识网络构建与灵感记录</p>
                <div class="about-features">
                  <div class="about-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
                    <span>多格式文献导入与阅读</span>
                  </div>
                  <div class="about-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v4M12 11l-5 6M12 11l5 6"/></svg>
                    <span>AI 驱动知识图谱构建</span>
                  </div>
                  <div class="about-feature">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>
                    <span>灵感记录与知识关联</span>
                  </div>
                </div>
                <p class="about-license">MIT License</p>
                <button class="btn btn--sm about-replay-btn" @click="replayOnboarding">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9M3 12l3-3M3 12l3 3"/></svg>
                  重新查看新手引导
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useUiStore, usePromptStore } from '../stores'
import ModelLab from './ModelLab.vue'
import PromptLab from './PromptLab.vue'

const uiStore = useUiStore()
const promptStore = usePromptStore()

// 重新查看新手引导
function replayOnboarding() {
  uiStore.closeSettings()
  // 通过全局事件触发 OnboardingTour 显示
  window.dispatchEvent(new CustomEvent('ks-show-onboarding'))
}

const tabs = computed(() => [
  {
    key: 'model',
    label: '模型配置',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>',
    badge: '',
  },
  {
    key: 'prompts',
    label: '提示词模板',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
    badge: promptStore.tasks.length || '',
  },
  {
    key: 'about',
    label: '关于',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    badge: '',
  },
])

function close() {
  uiStore.closeSettings()
}

// Escape 键关闭设置 + body 滚动锁定
function onKeyDown(e) {
  if (e.key === 'Escape' && uiStore.settingsOpen) {
    close()
  }
}

watch(() => uiStore.settingsOpen, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
  } else {
    document.body.style.overflow = ''
    window.removeEventListener('keydown', onKeyDown)
  }
})

onBeforeUnmount(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.settings-modal {
  width: 100%;
  max-width: 1000px;
  height: 100%;
  max-height: 680px;
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
}

/* ===== Header ===== */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
}
.settings-header__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.settings-header__title svg {
  color: var(--accent);
}
.settings-close {
  flex-shrink: 0;
}

/* ===== Body ===== */
.settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* ===== Nav Sidebar ===== */
.settings-nav {
  width: 200px;
  flex-shrink: 0;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.settings-nav__item:hover {
  color: var(--text);
  background: var(--bg-hover);
}
.settings-nav__item--active {
  color: var(--accent);
  background: var(--accent-dim);
}
.settings-nav__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.settings-nav__label {
  flex: 1;
}
.settings-nav__badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 7px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
}
.settings-nav__item--active .settings-nav__badge {
  color: var(--accent);
  background: var(--accent-dim);
}

/* ===== Content Area ===== */
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--bg-void);
}

/* ===== About Tab ===== */
.settings-about {
  max-width: 520px;
  margin: 40px auto;
  text-align: center;
}
.about-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 40px 32px;
}
.about-logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
}
.about-logo svg {
  width: 100%;
  height: 100%;
}
.about-card h2 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}
.about-version {
  font-size: 13px;
  color: var(--text-3);
  font-family: var(--font-mono);
  margin-bottom: 16px;
}
.about-desc {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
  margin-bottom: 24px;
}
.about-features {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  margin-bottom: 24px;
}
.about-feature {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-2);
  padding: 8px 12px;
  background: var(--bg-input);
  border-radius: var(--radius-sm);
}
.about-feature svg {
  color: var(--accent);
  flex-shrink: 0;
}
.about-license {
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

.about-replay-btn {
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: 12.5px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
  border: 1px solid rgba(6, 182, 212, 0.25);
  cursor: pointer;
  transition: all 0.2s;
}

.about-replay-btn:hover {
  background: rgba(6, 182, 212, 0.2);
  border-color: rgba(6, 182, 212, 0.4);
  transform: translateY(-1px);
}

/* ===== Transition ===== */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.2s ease;
}
.settings-fade-enter-active .settings-modal,
.settings-fade-leave-active .settings-modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}
.settings-fade-enter-from .settings-modal,
.settings-fade-leave-to .settings-modal {
  transform: scale(0.97) translateY(8px);
  opacity: 0;
}
</style>
