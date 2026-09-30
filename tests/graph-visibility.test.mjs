import test from 'node:test'
import assert from 'node:assert/strict'
import { select } from 'd3-selection'
import 'd3-transition'
import { restoreNodeVisibility } from '../renderer/src/utils/graph-visibility.mjs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
test('redraw restores a retained node after its entering fade is interrupted', async () => {
  const attrs = new Map([['opacity', '0']])
  const element = { getAttribute: key => attrs.get(key) ?? null, setAttribute: (key, value) => attrs.set(key, String(value)), removeAttribute: key => attrs.delete(key) }
  const nodes = select(element)
  nodes.transition().duration(350).attr('opacity', 1)
  nodes.interrupt()
  assert.equal(attrs.get('opacity'), '0')
  restoreNodeVisibility(nodes, 1)
  await wait(50)
  assert.equal(attrs.get('opacity'), '1')
  nodes.transition().duration(350).attr('opacity', 0)
  nodes.interrupt()
  restoreNodeVisibility(nodes, 1)
  await wait(50)
  assert.equal(attrs.get('opacity'), '1')
})
