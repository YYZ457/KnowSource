/**
 * @module composables/useDialog
 * @description 全局确认/输入对话框管理 composable
 *
 * 替代原生 confirm() 和 prompt()，提供基于 Promise 的异步 API，
 * 配合 ConfirmDialog.vue 组件实现可自定义样式的模态对话框。
 *
 * 用法：
 *   const dialog = useDialog();
 *   // 确认模式：返回 Promise<boolean>
 *   const ok = await dialog.confirm('删除确认', '确定要删除吗？', { danger: true });
 *   if (!ok) return;
 *
 *   // 输入模式：返回 Promise<string|null>（null 表示用户取消）
 *   const name = await dialog.prompt('重命名', '请输入新名称：', '默认值');
 *   if (name === null) return;
 *
 * ConfirmDialog.vue 组件需在 App.vue 中挂载一次，通过共享的响应式状态驱动显示。
 */

import { reactive } from 'vue';

/**
 * 模块级单例状态：所有调用 useDialog() 的组件共享同一份状态，
 * ConfirmDialog 组件读取此状态来渲染对话框。
 */
const dialogState = reactive({
  /** 对话框是否可见 */
  visible: false,
  /** 模式：'confirm'（确认）| 'prompt'（输入） */
  mode: 'confirm',
  /** 标题 */
  title: '',
  /** 消息内容 */
  message: '',
  /** 输入框当前值（prompt 模式） */
  inputValue: '',
  /** 输入框占位符（prompt 模式） */
  inputPlaceholder: '',
  /** 确认按钮文字 */
  confirmText: '确认',
  /** 取消按钮文字 */
  cancelText: '取消',
  /** 是否为危险操作（确认按钮显示为红色） */
  danger: false,
  /** Promise resolve 函数，由 ConfirmDialog 组件调用 */
  resolver: null,
});

/**
 * 显示对话框（内部方法）
 * @param {'confirm'|'prompt'} mode - 对话框模式
 * @param {string} title - 标题
 * @param {string} message - 消息
 * @param {object} options - 选项
 * @param {string} [options.defaultValue=''] - 输入框默认值（prompt 模式）
 * @param {string} [options.placeholder=''] - 输入框占位符（prompt 模式）
 * @param {string} [options.confirmText='确认'] - 确认按钮文字
 * @param {string} [options.cancelText='取消'] - 取消按钮文字
 * @param {boolean} [options.danger=false] - 是否为危险操作
 * @returns {Promise<boolean|string|null>} 确认模式返回 boolean，输入模式返回 string|null
 */
function _show(mode, title, message, options = {}) {
  // 如果已有对话框正在显示，先取消前一个，避免旧 Promise 永远挂起
  if (dialogState.visible && dialogState.resolver) {
    dialogState.resolver(dialogState.mode === 'prompt' ? null : false);
    dialogState.resolver = null;
  }
  return new Promise((resolve) => {
    dialogState.visible = true;
    dialogState.mode = mode;
    dialogState.title = title;
    dialogState.message = message;
    dialogState.inputValue = options.defaultValue ?? '';
    dialogState.inputPlaceholder = options.placeholder ?? '';
    dialogState.confirmText = options.confirmText || '确认';
    dialogState.cancelText = options.cancelText || '取消';
    dialogState.danger = options.danger || false;
    dialogState.resolver = resolve;
  });
}

/**
 * 显示确认对话框（替代原生 confirm()）
 * @param {string} title - 标题
 * @param {string} message - 消息内容
 * @param {object} [options] - 选项（danger, confirmText, cancelText）
 * @returns {Promise<boolean>} 用户点击确认返回 true，取消返回 false
 */
function confirm(title, message, options = {}) {
  return _show('confirm', title, message, options);
}

/**
 * 显示输入对话框（替代原生 prompt()）
 * @param {string} title - 标题
 * @param {string} message - 消息内容
 * @param {string} [defaultValue=''] - 输入框默认值
 * @param {object} [options] - 选项（placeholder, confirmText, cancelText）
 * @returns {Promise<string|null>} 用户点击确认返回输入值，取消返回 null
 */
function prompt(title, message, defaultValue = '', options = {}) {
  const opts = { ...options, defaultValue };
  return _show('prompt', title, message, opts);
}

/**
 * 确认对话框（由 ConfirmDialog 组件调用）
 * @param {boolean|string} result - 确认模式传 true，输入模式传输入值
 */
function _resolve(result) {
  if (dialogState.resolver) {
    dialogState.resolver(result);
    dialogState.resolver = null;
  }
  dialogState.visible = false;
}

/**
 * 取消对话框（由 ConfirmDialog 组件调用）
 * 确认模式 resolve(false)，输入模式 resolve(null)
 */
function _cancel() {
  if (dialogState.resolver) {
    dialogState.resolver(dialogState.mode === 'prompt' ? null : false);
    dialogState.resolver = null;
  }
  dialogState.visible = false;
}

/**
 * 对话框管理 composable
 * @returns {{state: object, confirm: Function, prompt: Function, resolve: Function, cancel: Function}}
 */
export function useDialog() {
  return {
    /** 共享的响应式状态（ConfirmDialog 组件读取此状态渲染） */
    state: dialogState,
    /** 显示确认对话框，返回 Promise<boolean> */
    confirm,
    /** 显示输入对话框，返回 Promise<string|null> */
    prompt,
    /** 确认回调（ConfirmDialog 组件内部调用） */
    resolve: _resolve,
    /** 取消回调（ConfirmDialog 组件内部调用） */
    cancel: _cancel,
  };
}
