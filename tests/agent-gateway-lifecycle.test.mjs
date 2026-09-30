import assert from 'node:assert/strict';
import test from 'node:test';
import { rememberAgentRun, hasLiveAgentRun } from '../services/agent/gateway-lifecycle.js';

const minute = 60 * 1000;
const startedAt = 1000000;

// These checks use an explicit clock; no 30-minute sleep or external model is needed.
test('a pending confirmation survives the trial gateway five-minute idle timeout', () => {
  const entry = {};
  rememberAgentRun(entry, { runId: 'first' }, startedAt);
  rememberAgentRun(entry, {
    runId: 'first', status: 'awaiting_confirmation', expiresAt: startedAt + 30 * minute
  }, startedAt + minute);
  assert.equal(hasLiveAgentRun(entry, startedAt + 6 * minute), true);
  assert.equal(hasLiveAgentRun(entry, startedAt + 29 * minute), true);
  assert.equal(hasLiveAgentRun(entry, startedAt + 30 * minute), false);
});

test('confirm acknowledgments do not extend the original Agent expiration', () => {
  const entry = {};
  rememberAgentRun(entry, { runId: 'first' }, startedAt);
  rememberAgentRun(entry, { runId: 'first', status: 'running' }, startedAt + 29 * minute);
  assert.equal(hasLiveAgentRun(entry, startedAt + 30 * minute), false);
});

test('completion, failure and cancellation release worker protection immediately', () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    const entry = {};
    rememberAgentRun(entry, { runId: 'first' }, startedAt);
    rememberAgentRun(entry, { runId: 'first', status, success: true }, startedAt + minute);
    assert.equal(hasLiveAgentRun(entry, startedAt + minute), false, status);
  }
});

test('finishing another project run does not lose an earlier pending confirmation', () => {
  const entry = {};
  rememberAgentRun(entry, { runId: 'first', status: 'awaiting_confirmation' }, startedAt);
  rememberAgentRun(entry, { runId: 'second', status: 'running' }, startedAt);
  rememberAgentRun(entry, { runId: 'second', status: 'completed' }, startedAt + minute);
  assert.equal(hasLiveAgentRun(entry, startedAt + 6 * minute), true);
  rememberAgentRun(entry, { runId: 'first', status: 'cancelled' }, startedAt + 7 * minute);
  assert.equal(hasLiveAgentRun(entry, startedAt + 7 * minute), false);
});

test('invalid or rejected responses do not protect an idle worker', () => {
  const entry = {};
  for (const value of [null, {}, { runId: '' }, { runId: 42 },
    { runId: 'bad', success: false }, { runId: 'bad', status: 'unknown' }]) {
    rememberAgentRun(entry, value, startedAt);
  }
  assert.equal(hasLiveAgentRun(entry, startedAt), false);
});

test('workers without an Agent run retain their normal idle lifecycle', () => {
  assert.equal(hasLiveAgentRun({}, startedAt), false);
});
