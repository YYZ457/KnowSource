const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Capture network requests and browser console errors
  const apiCalls = [];
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ type: 'pageerror', text: err.message });
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/graph/build') || url.includes('/api/extract/model-test')) {
      apiCalls.push({ url, method: req.method(), postData: req.postData() });
    }
  });

  // Avoid onboarding overlay by marking as already onboarded
  await page.addInitScript(() => {
    localStorage.setItem('knowledge-ide-onboarded', 'true');
  });

  await page.goto('http://localhost:5175/');
  await page.waitForTimeout(3000);

  // Screenshot of initial state
  await page.screenshot({ path: path.join(__dirname, 'verify-ui-initial.png') });

  // Import a dummy document via API
  const dummyText = '## 第一章 概率模型\n\n概率模型是统计学的基础。\n\n## 第二章 随机变量\n\n随机变量描述随机现象。';
  const parseRes = await page.evaluate(async (text) => {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'dummy.md', content: text, type: 'markdown' })
    });
    return res.json();
  }, dummyText);
  console.log('Imported doc:', parseRes?.meta?.docId);

  // Reload so docStore picks up the new document
  await page.goto('http://localhost:5175/');
  await page.waitForTimeout(2000);

  // Click the imported document in FileExplorer
  const docItem = await page.locator('.tree-item:has-text("dummy.md")').first();
  if (await docItem.isVisible().catch(() => false)) {
    await docItem.click();
    await page.waitForTimeout(500);
  }

  // Click the "模型" tab in the right panel
  const modelTab = await page.locator('.right-tabs button:has-text("模型")').first();
  if (await modelTab.isVisible().catch(() => false)) {
    await modelTab.click();
    await page.waitForTimeout(800);
  }

  // Screenshot of ModelLab panel
  await page.screenshot({ path: path.join(__dirname, 'verify-ui-modellab.png') });

  // Check for splitMode dropdown
  const splitSelect = await page.locator('select').filter({ hasText: /标题感知|段落滑动|LLM 自动划分/ }).first();
  const splitVisible = await splitSelect.isVisible().catch(() => false);
  console.log('Split mode dropdown visible:', splitVisible);

  let splitValue = '';
  if (splitVisible) {
    splitValue = await splitSelect.inputValue();
    console.log('Split mode value:', splitValue);
  }

  // Click "测试模型" button (now enabled because a doc is selected)
  const testBtn = await page.locator('button:has-text("测试模型")').first();
  const testBtnEnabled = await testBtn.isEnabled().catch(() => false);
  console.log('Test model button enabled:', testBtnEnabled);
  if (testBtnEnabled) {
    await testBtn.click();
    await page.waitForTimeout(2500);
  }

  // Click "应用并构建图谱" button
  const buildBtn = await page.locator('button:has-text("应用并构建图谱")').first();
  const buildBtnEnabled = await buildBtn.isEnabled().catch(() => false);
  console.log('Build graph button enabled:', buildBtnEnabled);
  if (buildBtnEnabled) {
    await buildBtn.click();
    await page.waitForTimeout(2500);
  }

  await page.screenshot({ path: path.join(__dirname, 'verify-ui-after-click.png') });

  console.log('\nAPI calls captured:');
  for (const call of apiCalls) {
    console.log(call.method, call.url);
    console.log('postData:', call.postData);
  }

  console.log('\nBrowser console errors:');
  if (consoleErrors.length === 0) {
    console.log('(none)');
  } else {
    for (const err of consoleErrors) {
      console.log(err.type, err.text);
    }
  }

  await browser.close();
})();
