/** @module state/stores/toast
 *  职责：全局 Toast 通知列表管理
 *  支持 success / error / warning / info 四种类型
 *  通知默认 3 秒后自动移除，支持手动关闭
 *
 *  增强：
 *  - 去重：相同消息在 DEDUP_WINDOW 内不重复弹出，避免 toast 刷屏
 *  - 数量上限：最多同时显示 MAX_TOASTS 条，超出时自动移除最早的
 *  - error 类型默认时长延长至 5 秒，确保用户有足够时间阅读错误信息
 */
import { defineStore } from 'pinia';

// 同时显示的最大 Toast 数量，超出时自动移除最早的通知
const MAX_TOASTS = 5;
// 去重时间窗口（毫秒）：相同消息在此窗口内不重复弹出
const DEDUP_WINDOW = 2000;
// 各类型默认显示时长（毫秒）
const DEFAULT_DURATION = {
  success: 3000,
  info: 3000,
  warning: 4000,
  // error 延长至 5 秒，错误信息通常需要更多时间阅读
  error: 5000
};

// 模块级定时器映射：toast id -> setTimeout ID
// 不放入 Pinia state，避免无谓的响应式开销（与 document.js 的 parseTimer 同理）
const toastTimers = new Map();

/**
 * 生成全局唯一 Toast ID
 * 使用 crypto.randomUUID()（若可用），避免 Vite HMR 热更新时
 * 模块重新加载导致模块级计数器重置为 0，与仍存在的 Toast 通知 ID 冲突。
 * @returns {string} 唯一 ID
 */
function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 回退方案：时间戳 + 随机数，保证跨 HMR 重载的唯一性
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useToastStore = defineStore('toast', {
  state: () => ({
    /** @type {Array<{id:string,message:string,type:string}>} */
    toasts: []
  }),
  actions: {
    /**
     * 显示一条 Toast 通知
     * @param {string} message - 通知内容
     * @param {'success'|'error'|'warning'|'info'} type - 通知类型
     * @param {number} [duration] - 自动关闭时长（毫秒），传 0 表示不自动关闭。
     *   未传时按类型使用默认时长（error 5s，warning 4s，其余 3s）
     * @returns {string|null} 通知 id（可用于手动关闭），去重命中时返回 null
     */
    show(message, type = 'info', duration) {
      if (!message) return null;

      // 去重检查：在 DEDUP_WINDOW 内已有相同消息则不重复弹出
      const now = Date.now();
      const existing = this.toasts.find(
        t => t.message === message && t.type === type && (now - (t._createdAt || 0)) < DEDUP_WINDOW
      );
      if (existing) {
        // 刷新创建时间，延长去重窗口
        existing._createdAt = now;
        return null;
      }

      // 数量上限：超出时移除最早的通知（非 error 类型优先被移除）
      if (this.toasts.length >= MAX_TOASTS) {
        // 优先移除最早的非 error 通知；若全部是 error 则移除最早的
        // 使用 remove() 以同步清理其定时器，避免定时器泄漏
        const removeIdx = this.toasts.findIndex(t => t.type !== 'error');
        const evictIdx = removeIdx !== -1 ? removeIdx : 0;
        this.remove(this.toasts[evictIdx].id);
      }

      const id = genId();
      const actualDuration = duration !== undefined ? duration : (DEFAULT_DURATION[type] || 3000);
      this.toasts.push({ id, message, type, _createdAt: now });
      if (actualDuration > 0) {
        const timer = setTimeout(() => {
          toastTimers.delete(id);
          this.remove(id);
        }, actualDuration);
        toastTimers.set(id, timer);
      }
      return id;
    },
    /** 成功提示 */
    success(message, duration) {
      return this.show(message, 'success', duration);
    },
    /** 错误提示 */
    error(message, duration) {
      return this.show(message, 'error', duration);
    },
    /** 警告提示 */
    warning(message, duration) {
      return this.show(message, 'warning', duration);
    },
    /** 信息提示 */
    info(message, duration) {
      return this.show(message, 'info', duration);
    },
    /** 手动移除指定通知 */
    remove(id) {
      // 清理对应的自动关闭定时器，避免定时器到期后再次调用 remove（虽然 no-op，但属于资源泄漏）
      const timer = toastTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        toastTimers.delete(id);
      }
      const idx = this.toasts.findIndex(t => t.id === id);
      if (idx !== -1) this.toasts.splice(idx, 1);
    },
    /** 清空所有通知 */
    clear() {
      // 清理所有待执行的自动关闭定时器
      for (const timer of toastTimers.values()) {
        clearTimeout(timer);
      }
      toastTimers.clear();
      this.toasts = [];
    }
  }
});
