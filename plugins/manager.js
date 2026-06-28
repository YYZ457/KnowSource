/** @module plugins/manager
 *  职责：插件管理器，扫描 plugins 子目录的 index.js 并注册 hooks
 */

// 支持的 hook 类型
const VALID_HOOKS = ['parser', 'extractor', 'uiPanel', 'graphOperator'];

class PluginManager {
  constructor() {
    /** @type {Map<string, Object>} plugin name -> plugin module */
    this.plugins = new Map();
    /** @type {Map<string, Function[]>} hook type -> handlers */
    this.hooks = new Map();
    for (const h of VALID_HOOKS) this.hooks.set(h, []);
  }

  /**
   * 注册插件
   * @param {{name:string, hooks?:Object}} plugin
   */
  register(plugin) {
    if (!plugin || !plugin.name) {
      console.warn('[plugins] 插件缺少 name，跳过');
      return;
    }
    if (this.plugins.has(plugin.name)) {
      console.warn(`[plugins] 插件 ${plugin.name} 已注册，覆盖`);
    }
    this.plugins.set(plugin.name, plugin);

    // 注册 hooks
    if (plugin.hooks) {
      for (const [hookType, handler] of Object.entries(plugin.hooks)) {
        if (VALID_HOOKS.includes(hookType)) {
          if (typeof handler === 'function') {
            this.hooks.get(hookType).push(handler);
          } else if (handler && typeof handler === 'object') {
            // 支持 {init, process} 形式
            if (handler.process) this.hooks.get(hookType).push(handler.process);
          }
        } else {
          console.warn(`[plugins] 未知 hook 类型: ${hookType}`);
        }
      }
    }

    console.log(`[plugins] 已注册: ${plugin.name}`);
  }

  /**
   * 执行某类 hook
   * @param {string} hookType
   * @param {*} data — 传入 hook 的数据
   * @returns {*} 处理后的数据（链式处理）
   */
  async runHook(hookType, data) {
    const handlers = this.hooks.get(hookType) || [];
    let result = data;
    for (const handler of handlers) {
      try {
        result = await handler(result);
      } catch (e) {
        console.error(`[plugins] hook ${hookType} 执行失败:`, e.message);
      }
    }
    return result;
  }

  /** 获取已注册插件列表 */
  list() {
    return Array.from(this.plugins.keys());
  }

  /** 获取某类 hook 的处理器数量 */
  hookCount(hookType) {
    return (this.hooks.get(hookType) || []).length;
  }

  /** 清除所有插件与 hooks */
  clear() {
    this.plugins.clear();
    for (const h of VALID_HOOKS) this.hooks.set(h, []);
  }
}

// 单例
export const pluginManager = new PluginManager();
export { PluginManager, VALID_HOOKS };
