/**
 * 最小化 Pinia mock，仅用于 renderer 单元测试。
 * 不依赖 Vue 响应式系统，store 实例为普通对象，actions 已绑定 this。
 */

const storeDefinitions = new Map();
const storeInstances = new Map();

function createStoreInstance(id, definition) {
  const state = typeof definition.state === 'function' ? definition.state() : {};
  const instance = { $id: id, ...state };

  if (definition.getters) {
    for (const [name, fn] of Object.entries(definition.getters)) {
      Object.defineProperty(instance, name, {
        get: () => fn(instance),
        enumerable: true,
        configurable: true
      });
    }
  }

  if (definition.actions) {
    for (const [name, fn] of Object.entries(definition.actions)) {
      instance[name] = fn.bind(instance);
    }
  }

  return instance;
}

export function defineStore(id, definition) {
  storeDefinitions.set(id, definition);

  function useStore() {
    if (!storeInstances.has(id)) {
      storeInstances.set(id, createStoreInstance(id, definition));
    }
    return storeInstances.get(id);
  }

  useStore.$id = id;
  return useStore;
}

export function setActivePinia() {
  // 无需实现：store 为单例，直接通过 useStore 访问
}

export function createPinia() {
  return {};
}

/**
 * 重置所有 store 实例，便于每个测试用例独立
 */
export function resetPiniaStores() {
  storeInstances.clear();
}
