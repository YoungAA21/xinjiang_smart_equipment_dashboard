import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { reportAggregateQueries, summarizeReportBuckets } from '../src/charts/reportAggregates.js'
import { reportRanges } from '../src/charts/reportAnalysis.js'
import { telemetryApi, configureHistoryReader } from '../src/services/telemetry.js'
import { generateEquipmentReport } from '../src/services/reports.js'
import { reportHtml } from '../src/charts/reportDocument.js'

const point = { pointId: 27, moduleId: 'A', pointCode: 'TEMP', metricType: 'Temperature', minimumValue: -20, maximumValue: 50 }
const range = { start: '2026-09-01T09:30:00', end: '2026-09-01T09:45:00', hours: .25 }
const bucket = (bucketStart = range.start, values = {}) => ({ bucketStart, quality: 1, minValue: -10, maxValue: 0, averageValue: -5, lastValue: 0, sampleCount: 2, ...values })
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; configureHistoryReader(null) })

test('shift bucket counts preserve 09:30 day start and cross-midnight night ownership', () => {
  for (const [shift, expected] of [['day', 102], ['night', 96]]) {
    const ranges = reportRanges({ date: '2026-09-01', shift })
    const summary = summarizeReportBuckets([{ buckets: [] }], point, ranges.current)
    assert.equal(summary.expectedBuckets, expected)
    const queries = reportAggregateQueries(27, ranges.current)
    assert.equal(queries.length, 1)
    assert.equal(queries[0].limit, 200)
    assert.equal(queries[0].bucketMinutes, 5)
  }
})

test('daily queries split without overlap and never exceed 200 five-minute buckets', async () => {
  const ranges = reportRanges({ mode: 'daily', date: '2026-09-01' })
  const queries = reportAggregateQueries(27, ranges.current)
  assert.equal(queries.length, 2)
  assert.equal(queries[0].end, queries[1].start)
  assert.equal(queries[0].start, ranges.current.start)
  assert.equal(queries[1].end, ranges.current.end)
  const calls = []
  const report = await generateEquipmentReport({ points: [point], ranges,
    telemetry: { getStoredAggregate: async query => { calls.push(query); return { query, buckets: [] } } },
    alarms: { getAlarms: async () => ({ events: [] }) }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
  })
  assert.equal(calls.length, 4)
  assert.equal(report.rows[0].current.missingBuckets, 288)
  assert.equal(report.rows[0].current.mean, null)
  assert.equal(report.rows[0].change.percent, null)
})

test('aggregate statistics weight means by samples, preserve zero/negative and expose gaps', () => {
  const summary = summarizeReportBuckets([{ buckets: [bucket(), bucket('2026-09-01T09:40:00', { minValue: 10, maxValue: 60, averageValue: 20, lastValue: 15, sampleCount: 6 })] }], point, range)
  assert.equal(summary.mean, 13.75)
  assert.equal(summary.count, 8)
  assert.equal(summary.min, -10)
  assert.equal(summary.max, 60)
  assert.equal(summary.last, 15)
  assert.equal(summary.overBuckets, 1)
  assert.equal(summary.missingBuckets, 1)
  assert.equal(summary.coverage, 2 / 3)
  assert.equal(summary.buckets[0].lastValue, 0)
  assert.equal(summary.deviation, undefined)
})

test('bad, off-grid and boundary buckets cannot become zeros or inflate completeness', () => {
  const summary = summarizeReportBuckets([{ buckets: [bucket(), bucket(range.end), bucket('2026-09-01T09:31:00'), bucket('2026-09-01T09:35:00', { quality: 2 }), bucket('2026-09-01T09:40:00', { averageValue: null })] }], point, range)
  assert.equal(summary.bucketCount, 1)
  assert.equal(summary.invalid, 4)
  assert.equal(summary.missingBuckets, 2)
  assert.throws(() => summarizeReportBuckets([{ query: { pointId: 28 }, buckets: [] }], point, range), /pointId/)
  assert.throws(() => summarizeReportBuckets([{ buckets: [bucket(range.start, { moduleId: 'B' })] }], point, range), /身份/)
  assert.equal(summarizeReportBuckets([{ buckets: [bucket(), bucket()] }], point, range).count, 2)
  assert.throws(() => summarizeReportBuckets([{ buckets: [bucket(), bucket(range.start, { sampleCount: 3 })] }], point, range), /重复/)
})

test('aggregate transport bypasses raw cache, validates params and omits credentials', async () => {
  configureHistoryReader(() => () => { throw new Error('raw history must not run') })
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url, 'http://test')
    assert.equal(parsed.pathname, '/_telemetry-api/api/telemetry/history/aggregate-stored')
    assert.equal(parsed.searchParams.get('bucketMinutes'), '5')
    assert.equal(parsed.searchParams.get('limit'), '200')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, undefined)
    return Response.json({ buckets: [] })
  }
  await telemetryApi.getStoredAggregate({ pointId: 27, ...range, bucketMinutes: 5, limit: 200 })
  assert.throws(() => telemetryApi.getStoredAggregate({ pointId: 27, ...range, bucketMinutes: 7 }), /聚合分钟数/)
  globalThis.fetch = async () => new Response('', { status: 500 })
  await assert.rejects(telemetryApi.getStoredAggregate({ pointId: 27, ...range }), /HTTP 500/)
})

test('export uses weighted bucket statistics with disconnected gap paths and accurate method text', async () => {
  const report = await generateEquipmentReport({ points: [point], ranges: { current: range, baseline: range },
    telemetry: { getStoredAggregate: async () => ({ buckets: [bucket(), bucket('2026-09-01T09:40:00')] }) },
    alarms: { getAlarms: async () => ({ events: [] }) }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
  })
  const html = reportHtml(report, { title: '聚合报告', scope: '全部' })
  assert.match(html, /加权均值/)
  assert.match(html, /sampleCount/)
  assert.match(html, /<td>2\/3<\/td>/)
  assert.match(html, /缺失 1 个时间桶/)
  assert.doesNotMatch(html, /均值和极值取自原始有效采样/)
  const path = html.match(/<path d="([^"]+)"/)[1]
  assert.equal((path.match(/M/g) || []).length, 2)
  assert.doesNotMatch(path, /L/)
})
