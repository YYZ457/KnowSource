<script setup>
/** ToastNotification — 全局 Toast 通知容器
 *  从右上角滑入，支持 success/error/warning/info 四种类型
 *  多条通知堆叠排列，支持手动关闭
 */
import { useToastStore } from '@/stores/toast';

const toastStore = useToastStore();

// 各类型对应的图标
const ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ'
};
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" role="region" aria-label="通知" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="t in toastStore.toasts"
          :key="t.id"
          class="toast-item"
          :class="`toast-${t.type}`"
          role="alert"
        >
          <span class="toast-icon" aria-hidden="true">{{ ICONS[t.type] || ICONS.info }}</span>
          <span class="toast-message">{{ t.message }}</span>
          <button
            class="toast-close"
            title="关闭"
            aria-label="关闭通知"
            @click="toastStore.remove(t.id)"
          >×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: var(--z-tooltip, 3000);
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  max-width: 380px;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 280px;
  max-width: 380px;
  padding: 12px 14px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-left-width: 4px;
  border-radius: var(--radius, 8px);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.1));
  color: var(--text-primary, #1f2937);
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
}

/* 各类型左侧色条 */
.toast-success { border-left-color: var(--success, #059669); }
.toast-error   { border-left-color: var(--danger, #ef4444); }
.toast-warning { border-left-color: var(--warning, #f59e0b); }
.toast-info    { border-left-color: var(--accent, #3b82f6); }

.toast-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}

.toast-success .toast-icon { background: var(--success, #059669); }
.toast-error   .toast-icon { background: var(--danger, #ef4444); }
.toast-warning .toast-icon { background: var(--warning, #f59e0b); }
.toast-info    .toast-icon { background: var(--accent, #3b82f6); }

.toast-message {
  flex: 1;
  word-break: break-word;
  white-space: pre-line;
}

.toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary, #9ca3af);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
  margin-top: -2px;
}

.toast-close:hover {
  color: var(--text-primary, #1f2937);
}

/* 进入/离开动画：从右侧滑入 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(120%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(120%);
}

/* 列表项移动时的过渡 */
.toast-move {
  transition: transform 0.3s ease;
}
</style>
