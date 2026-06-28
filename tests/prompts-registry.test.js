/**
 * core/prompts/registry 单元测试
 *
 * 覆盖：任务元数据、用户覆盖 CRUD、任务禁用、模板渲染、提示词解析（内置模板 + 覆盖优先 + 变量渲染）
 * 该模块为 core 层纯内存逻辑，无磁盘 / 网络依赖。
 *
 * 新 API 要点：
 * - 内置模板定义在 templates.js 中，启动时即可展示（getDefaultPrompts 返回全部 16 个）
 * - resolvePrompt(taskId, { vars }) 不再接收 defaultSystem/defaultUser，模板来自内置定义
 * - 内置模板与覆盖模板均经过 renderTemplate 渲染（旧 API 中默认值不渲染）
 * - getEffectiveTemplate 返回用户覆盖（undefined 字段回退到内置）或内置模板
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TASKS,
  getTask,
  getTaskList,
  setUserOverrides,
  getUserOverrides,
  setUserOverride,
  hasUserOverride,
  resetUserOverride,
  resetAllOverrides,
  setDisabledTasks,
  getDisabledTaskIds,
  isDisabled,
  renderTemplate,
  resolvePrompt,
  getDefaultPrompts,
  getEffectiveTemplate
} from '../core/prompts/registry.js';

beforeEach(() => {
  // 每个用例前清空全部模块级状态，避免相互污染
  resetAllOverrides();
  setDisabledTasks([]);
});

describe('任务元数据', () => {
  test('TASKS 包含关键任务 id', () => {
    const ids = TASKS.map(t => t.id);
    assert.ok(ids.includes('doc-type-detect'), '应包含 doc-type-detect');
    assert.ok(ids.includes('cloud-term-extract'), '应包含 cloud-term-extract');
    assert.ok(ids.includes('full-graph-extract'), '应包含 full-graph-extract');
    assert.ok(ids.includes('crosslink-llm'), '应包含 crosslink-llm');
    assert.ok(ids.includes('exam-concept-extract'), '应包含 exam-concept-extract');
    assert.ok(ids.includes('chunk-term-extract-strong'), '应包含新增任务 chunk-term-extract-strong');
  });

  test('TASKS 包含 16 个任务', () => {
    assert.equal(TASKS.length, 16, '应有 16 个内置任务');
  });

  test('每个任务具备必要字段', () => {
    for (const t of TASKS) {
      assert.ok(t.id, '任务必须有 id');
      assert.ok(t.name, `${t.id} 必须有 name`);
      assert.ok(t.category, `${t.id} 必须有 category`);
      assert.ok(t.file, `${t.id} 必须有 file`);
      assert.ok(Array.isArray(t.variables), `${t.id} variables 必须是数组`);
    }
  });

  test('getTask 已知 id 返回元数据，未知 id 返回 null', () => {
    const t = getTask('doc-type-detect');
    assert.ok(t);
    assert.equal(t.id, 'doc-type-detect');
    assert.equal(getTask('not-exist'), null);
  });

  test('getTaskList 返回副本，修改不影响原始', () => {
    const list = getTaskList();
    assert.equal(list.length, TASKS.length);
    list[0].id = 'mutated';
    // 原始 TASKS 不受影响
    assert.notEqual(TASKS[0].id, 'mutated');
  });
});

describe('用户覆盖 CRUD', () => {
  test('setUserOverrides 整体替换', () => {
    setUserOverrides({
      'doc-type-detect': { system: '自定义系统', user: '自定义用户' }
    });
    const overrides = getUserOverrides();
    assert.equal(Object.keys(overrides).length, 1);
    assert.equal(overrides['doc-type-detect'].system, '自定义系统');
    assert.equal(overrides['doc-type-detect'].user, '自定义用户');
    assert.ok(hasUserOverride('doc-type-detect'));
  });

  test('setUserOverrides 处理 null / 非对象输入', () => {
    setUserOverrides({ 'doc-type-detect': { user: 'x' } });
    setUserOverrides(null);
    assert.equal(Object.keys(getUserOverrides()).length, 0, 'null 应清空覆盖');

    setUserOverrides({ 'doc-type-detect': { user: 'x' } });
    setUserOverrides('invalid');
    assert.equal(Object.keys(getUserOverrides()).length, 0, '非对象应清空覆盖');
  });

  test('setUserOverrides 跳过非对象值', () => {
    setUserOverrides({
      'doc-type-detect': { user: 'ok' },
      'cloud-term-extract': 'not-an-object',
      'term-refine': null
    });
    const overrides = getUserOverrides();
    assert.equal(Object.keys(overrides).length, 1, '只有合法对象应被保留');
    assert.ok(overrides['doc-type-detect']);
  });

  test('setUserOverride 设置单个覆盖，缺失字段为 undefined', () => {
    setUserOverride('term-refine', { user: '只覆盖 user' });
    const overrides = getUserOverrides();
    assert.equal(overrides['term-refine'].user, '只覆盖 user');
    assert.equal(overrides['term-refine'].system, undefined);
  });

  test('setUserOverride 处理 null/undefined override', () => {
    setUserOverride('term-refine', null);
    // null 仍会写入，system/user 均为 undefined
    const overrides = getUserOverrides();
    assert.equal(overrides['term-refine'].system, undefined);
    assert.equal(overrides['term-refine'].user, undefined);
  });

  test('resetUserOverride 移除单个覆盖', () => {
    setUserOverride('term-refine', { user: 'x' });
    assert.ok(hasUserOverride('term-refine'));
    resetUserOverride('term-refine');
    assert.ok(!hasUserOverride('term-refine'));
  });

  test('resetAllOverrides 清空全部覆盖', () => {
    setUserOverride('term-refine', { user: 'x' });
    setUserOverride('doc-type-detect', { system: 'y' });
    resetAllOverrides();
    assert.equal(Object.keys(getUserOverrides()).length, 0);
    assert.ok(!hasUserOverride('term-refine'));
  });
});

describe('任务禁用', () => {
  test('setDisabledTasks 整体替换', () => {
    setDisabledTasks(['doc-type-detect', 'cloud-term-extract']);
    assert.ok(isDisabled('doc-type-detect'));
    assert.ok(isDisabled('cloud-term-extract'));
    assert.deepEqual(getDisabledTaskIds().sort(), ['cloud-term-extract', 'doc-type-detect']);
  });

  test('setDisabledTasks 非数组输入清空禁用列表', () => {
    setDisabledTasks(['doc-type-detect']);
    setDisabledTasks('not-array');
    assert.equal(getDisabledTaskIds().length, 0);
    assert.ok(!isDisabled('doc-type-detect'));
  });

  test('setDisabledTasks null 清空', () => {
    setDisabledTasks(['a', 'b']);
    setDisabledTasks(null);
    assert.equal(getDisabledTaskIds().length, 0);
  });

  test('isDisabled 未禁用返回 false', () => {
    setDisabledTasks(['doc-type-detect']);
    assert.ok(!isDisabled('cloud-term-extract'));
    assert.ok(!isDisabled('unknown-task'));
  });
});

describe('renderTemplate 模板渲染', () => {
  test('替换 {{var}} 占位符', () => {
    assert.equal(
      renderTemplate('文档类型：{{docType}}', { docType: '教材' }),
      '文档类型：教材'
    );
  });

  test('支持 {{ var }} 带空格写法', () => {
    assert.equal(
      renderTemplate('类型：{{ docType }} 学科：{{ domain }}', { docType: '试卷', domain: '物理' }),
      '类型：试卷 学科：物理'
    );
  });

  test('变量缺失时保留原始占位符', () => {
    assert.equal(
      renderTemplate('缺失：{{missing}}', {}),
      '缺失：{{missing}}'
    );
  });

  test('变量为 null/undefined 时保留原始占位符', () => {
    assert.equal(
      renderTemplate('值：{{x}}', { x: null }),
      '值：{{x}}'
    );
    assert.equal(
      renderTemplate('值：{{x}}', { x: undefined }),
      '值：{{x}}'
    );
  });

  test('变量值被 String() 转换（数字、布尔、对象）', () => {
    assert.equal(renderTemplate('{{n}}', { n: 42 }), '42');
    assert.equal(renderTemplate('{{b}}', { b: true }), 'true');
    assert.equal(renderTemplate('{{o}}', { o: { a: 1 } }), '[object Object]');
  });

  test('同一变量可多次出现并全部替换', () => {
    assert.equal(
      renderTemplate('{{x}}-{{x}}-{{x}}', { x: 'A' }),
      'A-A-A'
    );
  });

  test('非字符串模板原样返回', () => {
    assert.equal(renderTemplate(123, {}), 123);
    assert.equal(renderTemplate(null, {}), null);
    assert.equal(renderTemplate(undefined, {}), undefined);
    assert.deepEqual(renderTemplate({ a: 1 }, {}), { a: 1 });
  });

  test('无占位符的字符串原样返回', () => {
    assert.equal(renderTemplate('普通文本无占位符', { x: 1 }), '普通文本无占位符');
  });

  test('空字符串模板返回空字符串', () => {
    assert.equal(renderTemplate('', { x: 1 }), '');
  });

  test('只含花括号但不是合法占位符的不替换', () => {
    assert.equal(renderTemplate('{{ }}', {}), '{{ }}');
    assert.equal(renderTemplate('{notvar}', { notvar: 1 }), '{notvar}');
  });
});

describe('resolvePrompt 提示词解析', () => {
  test('无覆盖时返回内置模板（doc-type-detect）', () => {
    const r = resolvePrompt('doc-type-detect', {});
    assert.equal(r.system, '', 'doc-type-detect 内置 system 为空');
    // 未提供 vars，占位符应原样保留
    assert.ok(r.user.includes('{{sample}}'), '内置 user 模板应包含 {{sample}} 占位符');
  });

  test('内置模板用 vars 渲染变量', () => {
    const r = resolvePrompt('doc-type-detect', { vars: { sample: 'test text' } });
    assert.equal(r.system, '');
    assert.ok(r.user.includes('test text'), '渲染后应包含 sample 实际值');
    assert.ok(!r.user.includes('{{sample}}'), '渲染后不应再包含 {{sample}} 占位符');
  });

  test('内置模板支持多变量渲染', () => {
    const r = resolvePrompt('cloud-term-extract', {
      vars: { batchText: '某段文本内容', domainHint: '物理' }
    });
    assert.ok(r.user.includes('物理'), '应渲染 domainHint');
    assert.ok(r.user.includes('某段文本内容'), '应渲染 batchText');
    assert.ok(!r.user.includes('{{domainHint}}'), '不应再包含 {{domainHint}} 占位符');
    assert.ok(!r.user.includes('{{batchText}}'), '不应再包含 {{batchText}} 占位符');
  });

  test('内置模板变量缺失时保留占位符', () => {
    const r = resolvePrompt('doc-type-detect', { vars: {} });
    assert.ok(r.user.includes('{{sample}}'), '变量缺失时应保留占位符');
  });

  test('完整覆盖（system + user）替换内置模板', () => {
    setUserOverride('doc-type-detect', {
      system: '覆盖系统',
      user: '覆盖用户'
    });
    const r = resolvePrompt('doc-type-detect', {});
    assert.equal(r.system, '覆盖系统');
    assert.equal(r.user, '覆盖用户');
  });

  test('部分覆盖：仅覆盖 system，user 回退到内置模板', () => {
    setUserOverride('doc-type-detect', { system: '新系统' });
    const r = resolvePrompt('doc-type-detect', {});
    assert.equal(r.system, '新系统');
    // user 未覆盖，回退到内置模板（含 {{sample}} 占位符）
    assert.ok(r.user.includes('{{sample}}'), '未覆盖的 user 应回退到内置模板');
  });

  test('部分覆盖：仅覆盖 user，system 回退到内置模板', () => {
    setUserOverride('doc-type-detect', { user: '新用户' });
    const r = resolvePrompt('doc-type-detect', {});
    // doc-type-detect 内置 system 为空字符串
    assert.equal(r.system, '', '未覆盖的 system 应回退到内置模板（空字符串）');
    assert.equal(r.user, '新用户');
  });

  test('覆盖模板用 vars 渲染变量', () => {
    setUserOverride('cloud-term-extract', {
      user: '文档类型={{docType}} 提示={{domainHint}}'
    });
    const r = resolvePrompt('cloud-term-extract', {
      vars: { docType: '教材', domainHint: '物理' }
    });
    assert.equal(r.user, '文档类型=教材 提示=物理');
  });

  test('覆盖中变量缺失时保留占位符', () => {
    setUserOverride('cloud-term-extract', { user: '类型={{docType}}' });
    const r = resolvePrompt('cloud-term-extract', { vars: {} });
    assert.equal(r.user, '类型={{docType}}');
  });

  test('内置模板与覆盖模板均经过 vars 渲染', () => {
    // 仅覆盖 system（含占位符），user 使用内置模板（含 {{sample}}）
    setUserOverride('doc-type-detect', { system: '自定义系统 {{sample}}' });
    const r = resolvePrompt('doc-type-detect', { vars: { sample: '测试文本' } });
    assert.equal(r.system, '自定义系统 测试文本', '覆盖的 system 应被渲染');
    assert.ok(r.user.includes('测试文本'), '内置的 user 也应被渲染');
    assert.ok(!r.user.includes('{{sample}}'), '内置 user 占位符应被替换');
  });

  test('不传 opts 时返回内置模板（不抛错）', () => {
    const r = resolvePrompt('doc-type-detect');
    assert.equal(r.system, '');
    assert.ok(typeof r.user === 'string', 'user 应为字符串');
  });

  test('未知任务 id 返回空模板', () => {
    const r = resolvePrompt('not-exist', {});
    assert.equal(r.system, '');
    assert.equal(r.user, '');
  });
});

describe('getEffectiveTemplate 有效模板', () => {
  test('无覆盖时返回内置模板', () => {
    const t = getEffectiveTemplate('doc-type-detect');
    assert.equal(t.system, '');
    assert.ok(t.user.includes('{{sample}}'));
  });

  test('有完整覆盖时返回覆盖模板', () => {
    setUserOverride('doc-type-detect', { system: 'S', user: 'U' });
    const t = getEffectiveTemplate('doc-type-detect');
    assert.equal(t.system, 'S');
    assert.equal(t.user, 'U');
  });

  test('部分覆盖时 undefined 字段回退到内置模板', () => {
    setUserOverride('doc-type-detect', { user: '只覆盖 user' });
    const t = getEffectiveTemplate('doc-type-detect');
    assert.equal(t.system, '', 'system 应回退到内置（空字符串）');
    assert.equal(t.user, '只覆盖 user');
  });

  test('部分覆盖时仅覆盖 system，user 回退内置', () => {
    setUserOverride('doc-type-detect', { system: '只覆盖 system' });
    const t = getEffectiveTemplate('doc-type-detect');
    assert.equal(t.system, '只覆盖 system');
    assert.ok(t.user.includes('{{sample}}'), 'user 应回退到内置模板');
  });

  test('getEffectiveTemplate 返回未渲染的原始模板（含占位符）', () => {
    const t = getEffectiveTemplate('doc-type-detect');
    // getEffectiveTemplate 不做变量渲染，占位符应保留
    assert.ok(t.user.includes('{{sample}}'), 'getEffectiveTemplate 不应渲染变量');
  });

  test('未知任务返回空模板', () => {
    const t = getEffectiveTemplate('not-exist');
    assert.equal(t.system, '');
    assert.equal(t.user, '');
  });
});

describe('getDefaultPrompts 内置模板集合', () => {
  test('启动时即可返回全部 16 个内置模板', () => {
    // 无需先调用 resolvePrompt，getDefaultPrompts 立即返回全部内置模板
    const defaults = getDefaultPrompts();
    assert.equal(Object.keys(defaults).length, 16, '应返回全部 16 个内置模板');
  });

  test('包含所有 TASKS 中的任务 id', () => {
    const defaults = getDefaultPrompts();
    for (const t of TASKS) {
      assert.ok(defaults[t.id], `应包含任务 ${t.id} 的内置模板`);
    }
  });

  test('返回的内置模板与 templates.js 定义一致', () => {
    const defaults = getDefaultPrompts();
    assert.equal(defaults['doc-type-detect'].system, '', 'doc-type-detect 内置 system 应为空');
    assert.ok(
      defaults['doc-type-detect'].user.includes('{{sample}}'),
      'doc-type-detect 内置 user 应含 {{sample}} 占位符'
    );
  });

  test('用户覆盖不影响 getDefaultPrompts 返回的内置模板', () => {
    setUserOverride('doc-type-detect', { system: '覆盖系统', user: '覆盖用户' });
    const defaults = getDefaultPrompts();
    // getDefaultPrompts 始终返回内置模板，不受用户覆盖影响
    assert.equal(defaults['doc-type-detect'].system, '', '内置模板不应受用户覆盖影响');
    assert.ok(
      defaults['doc-type-detect'].user.includes('{{sample}}'),
      '内置模板不应受用户覆盖影响'
    );
  });

  test('多次调用返回相同内容（稳定）', () => {
    const a = getDefaultPrompts();
    const b = getDefaultPrompts();
    assert.equal(Object.keys(a).length, Object.keys(b).length);
    assert.equal(a['doc-type-detect'].system, b['doc-type-detect'].system);
    assert.equal(a['doc-type-detect'].user, b['doc-type-detect'].user);
  });

  test('返回的每个模板均为独立副本', () => {
    const defaults = getDefaultPrompts();
    const originalUser = defaults['doc-type-detect'].user;
    defaults['doc-type-detect'].user = 'mutated';
    // 再次获取，不应受上次修改影响
    const again = getDefaultPrompts();
    assert.equal(again['doc-type-detect'].user, originalUser, '应返回独立副本');
  });
});
