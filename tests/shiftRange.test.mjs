import test from 'node:test'
import assert from 'node:assert/strict'
import { shiftRange } from '../src/charts/shiftRange.js'

test('current and previous shifts preserve the production schedule across midnight and idle hours', () => {
 for (const [now, current, previous] of [
  ['2026-10-14T12:00:00', ['2026-10-14T09:30:00','2026-10-14T18:00:00'], ['2026-10-13T18:00:00','2026-10-14T02:00:00']],
  ['2026-10-14T18:00:00', ['2026-10-14T18:00:00','2026-10-15T02:00:00'], ['2026-10-14T09:30:00','2026-10-14T18:00:00']],
  ['2026-10-15T01:00:00', ['2026-10-14T18:00:00','2026-10-15T02:00:00'], ['2026-10-14T09:30:00','2026-10-14T18:00:00']],
  ['2026-11-01T08:00:00', ['2026-10-31T18:00:00','2026-11-01T02:00:00'], ['2026-10-31T09:30:00','2026-10-31T18:00:00']],
  ['2026-10-14T09:30:00', ['2026-10-14T09:30:00','2026-10-14T18:00:00'], ['2026-10-13T18:00:00','2026-10-14T02:00:00']],
 ]) {
  assert.deepEqual(shiftRange('current',new Date(now)),{start:current[0],end:current[1]})
  assert.deepEqual(shiftRange('previous',new Date(now)),{start:previous[0],end:previous[1]})
 }
})
