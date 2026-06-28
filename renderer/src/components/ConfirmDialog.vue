<script setup>
/**
 * ConfirmDialog — 全局确认/输入对话框组件
 *
 * 替代原生 confirm() 和 prompt()，提供可自定义样式的模态对话框。
 * 通过 useDialog() composable 的共享状态驱动显示，在 App.vue 中挂载一次即可。
 *
 * 支持两种模式：
 * - confirm 模式：标题 + 消息 + 确认/取消按钮 → Promise<boolean>
 * - prompt 模式：标题 + 消息 + 输入框 + 确认/取消按钮 → Promise<string|null>
 *
 * 键盘交互：
 * - Enter：确认（prompt 模式提交输入值，confirm 模式返回 true）
 * - Esc：取消（confirm 模式返回 false，prompt 模式返回 null）
 * - 点击遮罩层：取消
 */
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useDialog } from '@/composables/useDialog';

const { state, resolve, cancel } = useDialog();
const inputRef = ref(null);
const confirmBtnRef = ref(null);
const dialogCardRef = ref(null);
// 记录打开对话框前的焦点元素，关闭后恢复
let previousFocus = null;

// 对话框显示时自动聚焦：prompt 模式聚焦并选中输入框，confirm 模式聚焦确认按钮
// 关闭后恢复焦点到触发元素
watch(() => state.visible, async (visible) => {
  if (visible) {
    previousFocus = document.activeElement;
    await nextTick();
    if (state.mode === 'prompt') {
      inputRef.value?.focus();
      inputRef.value?.select();
    } else {
      confirmBtnRef.value?.focus();
    }
  } else {
    // 关闭后恢复焦点到触发元素
    nextTick(() => {
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
        previousFocus = null;
      }
    });
  }
});

/** 确认：prompt 模式返回输入值，confirm 模式返回 true */
function onConfirm() {
  if (state.mode === 'prompt') {
    resolve(state.inputValue);
  } else {
    resolve(true);
  }
}

/** 取消：confirm 模式返回 false，prompt 模式返回 null */
function onCancel() {
  cancel();
}

/**
 * 全局键盘事件处理：Enter 确认、Esc 取消
 * 使用 capture 阶段监听，确保在其他组件的 keydown 之前拦截
 */
function onKeydown(e) {
  if (!state.visible) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  } else if (e.key === 'Enter') {
    // 跳过输入法组合状态，避免中文输入时误触发
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    e.stopPropagation();
    onConfirm();
  } else if (e.key === 'Tab') {
    // 焦点陷阱：Tab 键在对话框内循环
    const card = dialogCardRef.value;
    if (!card) return;
    const focusables = card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div
        v-if="state.visible"
        class="confirm-dialog-overlay"
        @click.self="onCancel"
      >
        <Transition name="dialog-scale" appear>
          <div
            v-if="state.visible"
            ref="dialogCardRef"
            class="confirm-dialog-card"
            :class="{ 'is-danger': state.danger }"
            role="dialog"
            aria-modal="true"
            :aria-label="state.title"
          >
            <!-- 标题 -->
            <div class="confirm-dialog-header">
              <span v-if="state.danger" class="confirm-dialog-icon" aria-hidden="true">⚠</span>
              <h3>{{ state.title }}</h3>
            </div>

            <!-- 消息内容 -->
            <div class="confirm-dialog-body">
              <p v-if="state.message" class="confirm-dialog-message">{{ state.message }}</p>
              <input
                v-if="state.mode === 'prompt'"
                ref="inputRef"
                v-model="state.inputValue"
                type="text"
                class="confirm-dialog-input"
                :placeholder="state.inputPlaceholder"
                :aria-label="state.title || state.inputPlaceholder || '请输入'"
                autocomplete="off"
                spellcheck="false"
              />
            </div>

            <!-- 操作按钮 -->
            <div class="confirm-dialog-actions">
              <button class="confirm-dialog-btn cancel-btn" @click="onCancel">
                {{ state.cancelText }}
              </button>
              <button
                ref="confirmBtnRef"
                class="confirm-dialog-btn confirm-btn"
                :class="{ danger: state.danger }"
                @click="onConfirm"
              >
                {{ state.confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ============ 遮罩层 ============ */
.confirm-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal, 2000);
  padding: 16px;
}

/* ============ 对话框卡片 ============ */
.confirm-dialog-card {
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-md, 8px);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.1));
  width: 100%;
  max-width: 420px;
  overflow: hidden;
}

/* 危险操作：顶部边框高亮 */
.confirm-dialog-card.is-danger {
  border-top: 3px solid var(--danger, #ef4444);
}

/* ============ 标题区 ============ */
.confirm-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 8px;
}
.confirm-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  line-height: 1.4;
}
.confirm-dialog-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--danger-bg, #fef2f2);
  color: var(--danger, #ef4444);
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

/* ============ 内容区 ============ */
.confirm-dialog-body {
  padding: 4px 20px 16px;
}
.confirm-dialog-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, #6b7280);
  white-space: pre-line;
  word-break: break-word;
}
.confirm-dialog-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-input, #ffffff);
  color: var(--text-primary, #1f2937);
  font-size: 14px;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.confirm-dialog-input:focus {
  outline: none;
  border-color: var(--accent, #3b82f6);
  box-shadow: 0 0 0 3px var(--accent-bg, #eff6ff);
}

/* ============ 操作按钮区 ============ */
.confirm-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
}
.confirm-dialog-btn {
  padding: 7px 18px;
  border-radius: var(--radius-sm, 4px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.05s;
  border: 1px solid transparent;
}
.confirm-dialog-btn:active {
  transform: scale(0.97);
  opacity: 0.85;
}

/* 取消按钮：次要样式 */
.cancel-btn {
  background: var(--bg-tertiary, #f0f1f3);
  border-color: var(--border-color, #e5e7eb);
  color: var(--text-secondary, #6b7280);
}
.cancel-btn:hover {
  background: var(--bg-hover, #eef2f7);
  color: var(--text-primary, #1f2937);
}

/* 确认按钮：主要样式 */
.confirm-btn {
  background: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
  color: #ffffff;
}
.confirm-btn:hover {
  background: var(--accent-light, #60a5fa);
  border-color: var(--accent-light, #60a5fa);
}

/* 危险确认按钮：红色 */
.confirm-btn.danger {
  background: var(--danger, #ef4444);
  border-color: var(--danger, #ef4444);
}
.confirm-btn.danger:hover {
  background: #dc2626;
  border-color: #dc2626;
}

/* ============ 过渡动画 ============ */
/* 遮罩层淡入淡出 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

/* 卡片缩放 + 上移 */
.dialog-scale-enter-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}
.dialog-scale-leave-active {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.dialog-scale-enter-from {
  opacity: 0;
  transform: scale(0.92) translateY(10px);
}
.dialog-scale-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(4px);
}

/* ============ 响应式 ============ */
@media (max-width: 480px) {
  .confirm-dialog-card {
    max-width: 92vw;
  }
  .confirm-dialog-header {
    padding: 14px 16px 6px;
  }
  .confirm-dialog-header h3 {
    font-size: 15px;
  }
  .confirm-dialog-body {
    padding: 4px 16px 14px;
  }
  .confirm-dialog-message {
    font-size: 13px;
  }
  .confirm-dialog-actions {
    padding: 10px 16px 14px;
  }
  .confirm-dialog-btn {
    flex: 1;
    padding: 8px 12px;
    font-size: 13px;
  }
}
</style>
