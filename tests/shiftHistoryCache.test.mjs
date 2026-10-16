import test from 'node:test'
import assert from 'node:assert/strict'
import { createShiftHistoryCache } from '../src/services/shiftHistoryCache.js'
import { shiftRange } from '../src/charts/shiftRange.js'

const at = value => new Date(`2026-10-16T${value}`).getTime()
const point = (value, pointId = 1) => ({ pointId, value, quality: 'Good', collectedAt: new Date(at('10:00:00') + value * 1000).toISOString() })
const query = { pointId: 1, start: '2026-10-16T10:00:00', end: '2026-10-16T10:10:00', limit: 100000 }
const storage = () => {
  const rows = new Map()
  return { rows, async get(key) { return rows.get(key) }, async put(row) { rows.set(row.key, structuredClone(row)) }, async prune(start) { for (const [key, row] of rows) if (row.shiftStart !== start) rows.delete(key) } }
}

test('raw current-shift samples survive reload; point/account identities and query limits stay isolated', async () => {
  const disk = storage(), calls = []
  const load = async params => { calls.push(params); return { pointId: params.pointId, points: [point(0, params.pointId), point(1, params.pointId), { ...point(2, params.pointId), value: null, quality: 'Bad' }] } }
  const make = scope => createShiftHistoryCache({ load, storage: disk, now: () => at('12:00:00'), scope })
  const cache = make('alice')
  assert.equal((await cache.read(query)).points.length, 3)
  assert.equal((await make('alice').read({ ...query, limit: 1 })).truncated, true)
  assert.equal(calls.length, 1)
  await make('bob').read(query)
  await cache.read({ ...query, pointId: 2 })
  assert.equal(calls.length, 3)
  assert.equal((await cache.read(query)).points[2].value, null)
})

test('full-shift reads split capped responses and cache only complete blocks', async () => {
  const disk = storage(), calls = []
  const samples = Array.from({ length: 8 }, (_, index) => point(index))
  const cache = createShiftHistoryCache({ storage: disk, now: () => at('12:00:00'), blockMs: 10000, maxRows: 3,
    load: async params => { calls.push(params); return { points: samples.filter(row => Date.parse(row.collectedAt) >= Date.parse(params.start) && Date.parse(row.collectedAt) < Date.parse(params.end)).slice(0, 3) } },
  })
  const result = await cache.read({ ...query, end: '2026-10-16T10:00:10' })
  assert.equal(result.points.length, 8)
  assert.ok(calls.length > 1)
  const count = calls.length
  assert.equal((await cache.read({ ...query, end: '2026-10-16T10:00:10' })).points.length, 8)
  assert.equal(calls.length, count)
})

test('concurrent readers share requests; cancelling one consumer does not cancel another', async () => {
  let release, count = 0
  const cache = createShiftHistoryCache({ now: () => at('12:00:00'), load: async () => { count++; await new Promise(resolve => { release = resolve }); return { points: [point(0)] } } })
  const controller = new AbortController()
  const first = cache.read(query, { signal: controller.signal })
  const cancelled = assert.rejects(first, { name: 'AbortError' })
  const second = cache.read(query)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  controller.abort()
  release()
  await cancelled
  assert.equal((await second).points.length, 1)
  assert.equal(count, 1)
})

test('failed/truncated/mismatched responses never mark a range complete; storage failure falls back', async () => {
  let bad = true, calls = 0
  const warnings = []
  const cache = createShiftHistoryCache({ now: () => at('12:00:00'), storage: { async get() { throw new Error('quota') } }, onWarning: warning => warnings.push(warning),
    load: async () => { calls++; if (bad) throw new Error('offline'); return { points: [point(0)] } },
  })
  await assert.rejects(cache.read(query), /offline/)
  bad = false
  await cache.read(query)
  await cache.read(query)
  assert.equal(calls, 2)
  assert.equal(warnings.length, 1)
  const mismatch = createShiftHistoryCache({ now: () => at('12:00:00'), load: async () => ({ pointId: 2, points: [point(0, 2)] }) })
  await assert.rejects(mismatch.read(query), /格式/)
})

test('active blocks fetch only the tail with overlap, including late arrivals and corrections', async () => {
  let now = at('10:10:00')
  const calls = []
  const cache = createShiftHistoryCache({ now: () => now, load: async params => {
    calls.push(params)
    return { points: calls.length === 1 ? [point(0), point(540)] : [{ ...point(540), value: 99 }, point(600)] }
  } })
  const range = shiftRange('current', new Date(now))
  await cache.read({ ...query, start: range.start, end: range.end })
  now += 60000
  const result = await cache.read({ ...query, start: range.start, end: range.end })
  assert.equal(calls.length, 2)
  assert.equal(Date.parse(calls[1].start), at('10:08:00'))
  assert.deepEqual(result.points.map(row => row.value), [0, 99, 600])
  assert.ok(Date.parse(calls[1].end) <= now)
})

test('custom history bypasses current-shift caching and rotating shift prunes stored data', async () => {
  let now = at('12:00:00'), calls = 0
  const disk = storage()
  const cache = createShiftHistoryCache({ storage: disk, now: () => now, load: async () => { calls++; return { points: [] } } })
  await cache.read(query)
  assert.equal(disk.rows.size, 1)
  const old = { ...query, start: '2026-10-15T10:00:00', end: '2026-10-15T11:00:00' }
  await cache.read(old); await cache.read(old)
  assert.equal(calls, 3)
  now = at('18:01:00')
  await cache.prune()
  assert.equal(disk.rows.size, 0)
})

test('session cancellation prevents late responses from persisting or repainting', async () => {
  let release
  const controller = new AbortController(), disk = storage()
  const cache = createShiftHistoryCache({ storage: disk, now: () => at('12:00:00'), signal: controller.signal,
    load: async () => { await new Promise(resolve => { release = resolve }); return { points: [point(0)] } },
  })
  const pending = cache.read(query)
  for (let i = 0; i < 12; i++) await Promise.resolve()
  controller.abort(); release()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(disk.rows.size, 0)
})

test('already cancelled readers perform no I/O; full warmup keeps blocks without assembling a chart array', async () => {
  const disk = storage(), calls = []
  const cache = createShiftHistoryCache({ storage: disk, now: () => at('12:00:00'), load: async params => { calls.push(params); return { points: [point(0)] } } })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(cache.read(query, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls.length, 0)
  const result = await cache.read(query, { background: true, warmOnly: true })
  assert.equal(result.points.length, 0)
  assert.equal((await cache.read(query)).points.length, 1)
  assert.equal(calls.length, 1)
})

test('history network concurrency stays bounded across different points', async () => {
  const releases = []
  let running = 0, peak = 0
  const cache = createShiftHistoryCache({ now: () => at('12:00:00'), load: async () => {
    running++; peak = Math.max(peak, running)
    await new Promise(resolve => releases.push(resolve))
    running--
    return { points: [] }
  } })
  const tasks = [1, 2, 3, 4, 5].map(pointId => cache.read({ ...query, pointId }))
  for (let i = 0; i < 100; i++) {
    for (const resolve of releases.splice(0)) resolve()
    await Promise.resolve()
  }
  await Promise.all(tasks)
  assert.equal(peak, 2)
})

test('settled blocks expire and fully revalidate to pick up older backend corrections', async () => {
  let now = at('12:00:00'), calls = 0
  const cache = createShiftHistoryCache({ now: () => now, load: async () => ({ points: [{ ...point(0), value: ++calls }] }) })
  assert.equal((await cache.read(query)).points[0].value, 1)
  now += 31 * 60000
  assert.equal((await cache.read(query)).points[0].value, 2)
})
