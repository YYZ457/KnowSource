<script setup>
/** LogPanel — 底栏：管线日志（自动滚动到底部） */
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';
import { useDialog } from '@/composables/useDialog';

const uiStore = useUiStore();
const toast = useToastStore();
const dialog = useDialog();
const logs = ref([]);
const logContentRef = ref(null);
const MAX_LOGS = 1000;

function addLog(msg) {
  logs.value.push({ ts: Date.now(), time: new Date().toLocaleTimeString(), msg });
  // 超过上限时移除最旧的日志，避免内存无限增长
  if (logs.value.length > MAX_LOGS) {
    logs.value.splice(0, logs.value.length - MAX_LOGS);
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = logContentRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 清空日志前弹出确认对话框，避免误操作丢失日志 */
async function clearLogs() {
  if (logs.value.length === 0) return;
  const ok = await dialog.confirm('清空确认', '确定要清空所有日志吗？此操作不可撤销。', { danger: true });
  if (!ok) return;
  logs.value = [];
  toast.success('日志已清空');
}

// 仅监听日志条数变化触发滚动，避免 deep watch 整个数组带来的性能开销
watch(() => logs.value.length, () => scrollToBottom());

// 保存回调引用，便于组件卸载时注销监听器
let _pythonLogCallback = null;

onMounted(() => {
  // 监听 Electron 日志事件（浏览器环境下静默跳过）
  if (window.KSElectron?.onPythonLog) {
    _pythonLogCallback = (msg) => addLog(msg);
    window.KSElectron.onPythonLog(_pythonLogCallback);
  }
});

onUnmounted(() => {
  // 清理 onPythonLog 回调，避免组件卸载后回调仍被触发导致内存泄漏
  if (_pythonLogCallback && window.KSElectron?.offPythonLog) {
    window.KSElectron.offPythonLog(_pythonLogCallback);
  }
  _pythonLogCallback = null;
});
</script>

<template>
  <Transition name="log-panel-slide">
    <div class="log-panel" v-if="uiStore.bottomPanelVisible">
      <div class="log-header">
        <span>日志</span>
        <button aria-label="清空日志" @click="clearLogs">清空</button>
      </div>
      <div ref="logContentRef" class="log-content" role="log">
        <div v-if="logs.length === 0" class="log-empty" style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px;">暂无日志信息</div>
        <div v-for="(log, i) in logs" :key="log.ts + '-' + i" class="log-line" role="listitem">
          <span class="log-time">{{ log.time }}</span>
          <span>{{ log.msg }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 底部日志面板展开/收起过渡动画 */
.log-panel-slide-enter-active,
.log-panel-slide-leave-active {
  transition: max-height 0.25s ease, opacity 0.25s ease;
  overflow: hidden;
}
.log-panel-slide-enter-from,
.log-panel-slide-leave-to {
  max-height: 0;
  opacity: 0;
}
.log-panel-slide-enter-to,
.log-panel-slide-leave-from {
  max-height: 50vh;
  opacity: 1;
}
</style>
