import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { renderToString } from 'vue/server-renderer'

const source = await readFile(new URL('../src/components/TelemetryHistoryList.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'history-list-test', inlineTemplate: true })
const context = vm.createContext({ console })
const vueModule = new vm.SyntheticModule(Object.keys(vue), function () {
  for (const [key, value] of Object.entries(vue)) this.setExport(key, value)
}, { context })
const componentModule = new vm.SourceTextModule(compiled.content, { context })
await componentModule.link((specifier) => {
  assert.equal(specifier, 'vue')
  return vueModule
})
await componentModule.evaluate()
const component = componentModule.namespace.default
const point = { pointId: 35, name: '负压', unit: 'kPa' }
const render = (samples) => renderToString(vue.createSSRApp(component, { samples, point }))

test('history list shows local timestamp, point identity, raw numeric precision, zero and raw quality', async () => {
  const html = await render([
    { collectedAt: '2026-08-28T10:00:00.123', value: 0, quality: 0 },
    { collectedAt: '2026-08-28T10:00:01.456', value: -0.123456789, quality: 'Good' },
    { collectedAt: '2026-08-28T10:00:02', value: null, quality: null },
  ])
  assert.match(html, /pointId 35/)
  assert.match(html, /数值（kPa）/)
  assert.match(html, /10:00:00.123/)
  assert.match(html, /-0.123456789/)
  assert.match(html, /value-cell[^>]*>0<\/td>/)
  assert.match(html, /<td[^>]*>0<\/td>/)
  assert.match(html, /Good/)
  assert.match(html, /value-cell[^>]*>—<\/td>/)
})

test('list paginates large result sets, defaults to newest first, and does not mutate chart samples', async () => {
  const samples = Array.from({ length: 55 }, (_, index) => ({ collectedAt: new Date(2026, 7, 28, 10, 0, index).toISOString(), value: index, quality: 'Good' }))
  const original = samples.map((sample) => ({ ...sample }))
  const html = await render(samples)
  const body = html.split('<tbody>')[1].split('</tbody>')[0]
  assert.equal((body.match(/<tr\b/g) || []).length, 20)
  assert.match(html, /显示 1–20 \/ 55 条/)
  assert.match(body, /value-cell[^>]*>54<\/td>/)
  assert.doesNotMatch(body, /value-cell[^>]*>0<\/td>/)
  assert.deepEqual(samples, original)
})

test('empty query result has explicit empty state and disabled pagination', async () => {
  const html = await render([])
  assert.match(html, /所选时间区间没有历史数据/)
  assert.match(html, /显示 0–0 \/ 0 条/)
  assert.equal((html.match(/<button disabled/g) || []).length, 2)
})
