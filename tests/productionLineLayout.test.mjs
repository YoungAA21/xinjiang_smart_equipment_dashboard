import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { productionLineLayout, productionLineViewBox } from '../src/charts/productionLineLayout.js'
import { productionLineTarget } from '../src/charts/productionLineTargets.js'

test('PDF generator reproduces all three shipped plans and retains approved navigation', async () => {
  const names = ['01-real-dark', '02-real-light', '03-real-flat']
  const before = await Promise.all(names.map(name => readFile(new URL(`../public/production-line/${name}.svg`, import.meta.url), 'utf8')))
  execFileSync(process.execPath, [fileURLToPath(new URL('../artifacts/production-line-real-layout/draw-pdf-layout.mjs', import.meta.url))])
  const source = JSON.parse(await readFile(new URL('../artifacts/production-line-real-layout/pdf-layout-paths.json', import.meta.url), 'utf8'))
  for (const [index, name] of names.entries()) {
    const svg = await readFile(new URL(`../public/production-line/${name}.svg`, import.meta.url), 'utf8')
    assert.equal(svg, before[index], 'generation is deterministic')
    assert.equal(svg, await readFile(new URL(`../artifacts/production-line-real-layout/${name}.svg`, import.meta.url), 'utf8'))
    assert.ok(svg.includes(`viewBox="${productionLineViewBox}"`))
    for (const item of source.paths) assert.ok(svg.includes(`d="${item.d}"`), 'every original vector path survives')
    assert.equal((svg.match(/class="machine-link"/g) || []).length, 5)
    for (const machine of productionLineLayout) {
      assert.ok(svg.includes(`id="machine-${machine.id}"`))
      const target = productionLineTarget(machine.id)
      if (target) assert.ok(svg.includes(`href="/#/monitor?${new URLSearchParams(target.query).toString().replaceAll('&', '&amp;')}"`))
    }
    assert.ok(!svg.includes('\\n<svg'), 'XML contains real newlines')
  }
})

test('annotated machine regions place the full YB25 beside the cabinet and YB95/YB65/YB55 below', () => {
  const layout = Object.fromEntries(productionLineLayout.map(machine => [machine.id, machine]))
  const contains = (id, x, y) => {
    const machine = layout[id]
    return x >= machine.x && x <= machine.x + machine.w && y >= machine.y && y <= machine.y + machine.h
  }
  for (const [id, x, y] of [['YB25', 330, 385], ['YB25', 550, 385], ['YB95', 200, 650], ['YB65', 330, 650], ['YB55', 285, 800]]) {
    assert.ok(contains(id, x, y), `${id} includes its annotated equipment`)
    for (const other of productionLineLayout) {
      if (other.id !== id) assert.ok(!contains(other.id, x, y), `${other.id} does not capture ${id}`)
    }
  }
  assert.ok(layout.YB25.x > layout['MAIN-CABINET'].x + layout['MAIN-CABINET'].w)
  assert.ok(layout.YB95.y > layout.YB25.y + layout.YB25.h)
  assert.ok(layout.YB65.x >= layout.YB95.x + layout.YB95.w)
  assert.ok(layout.YB55.y >= layout.YB65.y + layout.YB65.h)
})
