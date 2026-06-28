import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  withRetry,
  OllamaLLMProvider,
  HuggingFaceLLMProvider,
  OpenAICompatibleLLMProvider
} from '../services/llm-provider.js';

// 构造一个模拟 fetch 响应的对象
function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

// 抛出带 status 的错误（模拟 provider 内部抛错方式）
function httpError(status, message) {
  const err = new Error(message || `http ${status}`);
  err.status = status;
  return err;
}

describe('withRetry 重试策略', () => {
  test('首次成功时不重试', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    }, { maxRetries: 2, baseDelay: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('429 限流后重试成功', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw httpError(429, 'rate limited');
      return 'recovered';
    }, { maxRetries: 2, baseDelay: 1 });
    assert.equal(result, 'recovered');
    assert.equal(calls, 2);
  });

  test('503 服务端错误后多次重试成功', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw httpError(503, 'server error');
      return 'ok';
    }, { maxRetries: 3, baseDelay: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  test('400 错误不重试，立即抛出', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw httpError(400, 'bad request');
      }, { maxRetries: 3, baseDelay: 1 }),
      /bad request/
    );
    assert.equal(calls, 1, '4xx（非429）错误应只调用一次');
  });

  test('401 鉴权失败不重试', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw httpError(401, 'unauthorized');
      }, { maxRetries: 3, baseDelay: 1 }),
      /unauthorized/
    );
    assert.equal(calls, 1);
  });

  test('持续失败耗尽重试次数后抛出最后一个错误', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw httpError(503, 'persistent 503');
      }, { maxRetries: 2, baseDelay: 1 }),
      /persistent 503/
    );
    // maxRetries=2 → attempt 0,1,2 → 共 3 次调用
    assert.equal(calls, 3);
  });

  test('无 status 的网络错误（如超时 abort）会重试', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('network error'); // 无 status
      return 'ok';
    }, { maxRetries: 2, baseDelay: 1 });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('默认 maxRetries=2、baseDelay=1000', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        throw httpError(500, 'fail');
      }), // 不传 options，使用默认值
      /fail/
    );
    assert.equal(calls, 3, '默认 maxRetries=2 应共调用 3 次');
  });
});

describe('LLM provider 重试集成', () => {
  const originalFetch = globalThis.fetch;

  function installMockFetch(handler) {
    globalThis.fetch = async (url, init) => handler(url, init);
  }

  test('OpenAI-compatible: 首次成功直接返回', async () => {
    const provider = new OpenAICompatibleLLMProvider({
      apiKey: 'k', model: 'gpt-4o-mini', baseUrl: 'http://x'
    });
    let calls = 0;
    installMockFetch(() => {
      calls++;
      return mockResponse(200, { choices: [{ message: { content: 'hello' } }] });
    });
    try {
      const result = await provider.complete('hi');
      assert.equal(result, 'hello');
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAI-compatible: 401 错误不重试，fetch 只调用一次', async () => {
    const provider = new OpenAICompatibleLLMProvider({
      apiKey: 'k', model: 'gpt-4o-mini', baseUrl: 'http://x'
    });
    let calls = 0;
    installMockFetch(() => {
      calls++;
      return mockResponse(401, { error: 'unauthorized' });
    });
    try {
      await assert.rejects(provider.complete('hi'), /401/);
      assert.equal(calls, 1, '401 不可恢复，不应重试');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAI-compatible: 503 后重试成功', async () => {
    const provider = new OpenAICompatibleLLMProvider({
      apiKey: 'k', model: 'gpt-4o-mini', baseUrl: 'http://x'
    });
    let calls = 0;
    const responses = [
      mockResponse(503, { error: 'server' }),
      mockResponse(200, { choices: [{ message: { content: 'ok' } }] })
    ];
    installMockFetch(() => responses[calls++]);
    try {
      const result = await provider.complete('hi', { maxRetries: 1 });
      assert.equal(result, 'ok');
      assert.equal(calls, 2, '应在第二次调用成功');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Ollama: 首次成功直接返回', async () => {
    const provider = new OllamaLLMProvider({ baseUrl: 'http://x', model: 'llama3' });
    let calls = 0;
    installMockFetch(() => {
      calls++;
      return mockResponse(200, { response: 'ollama-ok' });
    });
    try {
      const result = await provider.complete('hi');
      assert.equal(result, 'ollama-ok');
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Ollama: 429 后重试成功', async () => {
    const provider = new OllamaLLMProvider({ baseUrl: 'http://x', model: 'llama3' });
    let calls = 0;
    const responses = [
      mockResponse(429, { error: 'rate' }),
      mockResponse(200, { response: 'ollama-ok' })
    ];
    installMockFetch(() => responses[calls++]);
    try {
      const result = await provider.complete('hi', { maxRetries: 1 });
      assert.equal(result, 'ollama-ok');
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('HuggingFace: 首次成功直接返回', async () => {
    const provider = new HuggingFaceLLMProvider({ apiKey: 'k', model: 'm' });
    let calls = 0;
    installMockFetch(() => {
      calls++;
      return mockResponse(200, [{ generated_text: 'hf-ok' }]);
    });
    try {
      const result = await provider.complete('hi');
      assert.equal(result, 'hf-ok');
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('HuggingFace: 404 不重试，立即抛出', async () => {
    const provider = new HuggingFaceLLMProvider({ apiKey: 'k', model: 'm' });
    let calls = 0;
    installMockFetch(() => {
      calls++;
      return mockResponse(404, { error: 'not found' });
    });
    try {
      await assert.rejects(provider.complete('hi'), /404/);
      assert.equal(calls, 1, '404 不可恢复，不应重试');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
