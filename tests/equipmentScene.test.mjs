import test from 'node:test'
import assert from 'node:assert/strict'
import { equipmentSceneLayout } from '../src/charts/equipmentScene.js'

test('equipment stays readable as the world grows, with every device accessible without overlap', () => {
  for (const count of [0, 1, 6, 12, 16, 17, 24]) {
    for (const [width, height] of [[350, 460], [780, 540], [1200, 600]]) {
      const layout = equipmentSceneLayout(count, width, height)
      assert.equal(layout.positions.length, count)
      assert.equal(layout.scale, 1)
      assert.equal(layout.width, width)
      assert.equal(layout.columns, 3)
      for (const [index, position] of layout.positions.entries()) {
        assert.ok(position.left >= 0 && position.left + layout.nodeWidth <= layout.width)
        assert.ok(position.top >= 0 && position.top + layout.nodeHeight <= layout.height + .001)
        if (index < 9) assert.ok(position.top + layout.nodeHeight <= height + .001)
        for (const other of layout.positions.slice(index + 1)) {
          assert.ok(Math.abs(position.left - other.left) >= layout.nodeWidth + 20 || Math.abs(position.top - other.top) >= layout.nodeHeight + 11)
        }
      }
    }
  }
})

test('zoom preserves three columns within the displayed width', () => {
  for (const width of [350, 780, 1200, 1600]) {
    for (const zoom of [1, 1.15, 1.3, 1.6]) {
      const layout = equipmentSceneLayout(17, width / zoom, 600)
      assert.equal(layout.columns, 3)
      assert.ok(layout.width * zoom <= width + 0.001)
      for (const position of layout.positions) {
        assert.ok(position.left >= 0)
        assert.ok((position.left + layout.nodeWidth) * zoom <= width + 0.001)
      }
    }
  }
})
