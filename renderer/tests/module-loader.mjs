import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = new URL('../../', import.meta.url);

const MOCK_MAP = {
  'pinia': 'renderer/tests/mocks/pinia.mjs',
  'vue': 'renderer/tests/mocks/vue.mjs',
  '@/api/client.js': 'renderer/tests/mocks/client.mjs',
  '@/stores/toast': 'renderer/tests/mocks/toast.mjs',
  '@/utils/validation.js': 'renderer/tests/mocks/validation.mjs',
  '@/utils/kg-options': 'renderer/tests/mocks/kg-options.mjs'
};

export async function resolve(specifier, context, nextResolve) {
  // 优先使用精确 mock 映射
  if (Object.prototype.hasOwnProperty.call(MOCK_MAP, specifier)) {
    return {
      url: new URL(MOCK_MAP[specifier], PROJECT_ROOT).href,
      shortCircuit: true
    };
  }

  // 处理 @/ 别名，映射到 renderer/src
  if (specifier.startsWith('@/')) {
    const relativePath = specifier.slice(2);
    return {
      url: new URL(`renderer/src/${relativePath}`, PROJECT_ROOT).href,
      shortCircuit: true
    };
  }

  // 为 renderer 源码中的无扩展名相对导入补 .js
  //（项目根目录未声明 type: module，Node 不会自动补全）
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !specifier.split('/').pop().includes('.')
  ) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // 回退到原始 specifier
    }
  }

  return nextResolve(specifier, context);
}
