/**
 * 最小化 Vue mock，仅用于消除 renderer 单元测试中的 Vue 依赖。
 */
export function reactive(obj) {
  return obj;
}

export function ref(value) {
  return { value };
}

export function computed(fn) {
  return { value: fn() };
}

export function nextTick() {
  return Promise.resolve();
}
