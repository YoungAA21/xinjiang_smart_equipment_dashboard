import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanReportSamples, defaultReportSelection, eligibleReportPoint, minuteReportSeries, reportChange, reportEvidenceOption, reportRanges, reportEvents, summarizeDigitalReport, summarizeReportSamples } from '../src/charts/reportAnalysis.js'
import { generateEquipmentReport, loadReportCatalog, reportPool } from '../src/services/reports.js'
import { reportHtml } from '../src/charts/reportDocument.js'

const point = { pointId: 35, moduleId: 'TEMP01', channelId: 'AI01', pointCode: 'TEMP', metricType: 'Temperature', name: '轴承温度', unit: '℃', minimumValue: 0, maximumValue: 40 }
const range = { start: '2026-10-16T00:00:00', end: '2026-10-16T01:00:00', hours: 1 }
const start = Date.parse(range.start)
const sample = (minute, value, extra = {}) => ({ collectedAt: new Date(start + minute * 60000).toISOString(), value, quality: 'Good', ...extra })
const aggregate = (samples, extra = {}) => ({ buckets: samples.map(row => ({ bucketStart: row.collectedAt, minValue: row.value, maxValue: row.value, averageValue: row.value, lastValue: row.value, sampleCount: 1, quality: row.quality })), ...extra })
const now = new Date('2026-10-18T12:00:00')

test('report defaults always select the most recent completed shift, including the idle period', () => {
  for (const [clock, date, shift] of [
    ['2026-10-18T01:00:00', '2026-10-17', 'day'],
    ['2026-10-18T02:00:00', '2026-10-17', 'night'],
    ['2026-10-18T08:00:00', '2026-10-17', 'night'],
    ['2026-10-18T12:00:00', '2026-10-17', 'night'],
    ['2026-10-18T18:00:00', '2026-10-18', 'day'],
  ]) {
    const result = defaultReportSelection(new Date(clock))
    assert.equal(result.date, date); assert.equal(result.shift, shift)
  }
})

test('report ranges use calendar shifts, adjacent or same shifts, and completed natural days', () => {
  const daily = reportRanges({ mode: 'daily', date: '2026-10-17' }, now)
  assert.equal(daily.current.end, '2026-10-18T00:00:00')
  assert.equal(daily.baseline.start, '2026-10-16T00:00:00')
  assert.equal(daily.baseline.end, daily.current.start)
  const day = reportRanges({ date: '2026-10-17' }, now)
  assert.equal(day.current.hours, 8.5)
  assert.deepEqual(day.baseline, { start: '2026-10-16T18:00:00', end: '2026-10-17T02:00:00', hours: 8 })
  const night = reportRanges({ date: '2026-10-17', shift: 'night' }, now)
  assert.equal(night.current.end, '2026-10-18T02:00:00')
  assert.equal(night.baseline.start, '2026-10-17T09:30:00')
  const same = reportRanges({ date: '2026-10-17', shift: 'night', comparison: 'same' }, now)
  assert.equal(same.baseline.start, '2026-10-16T18:00:00')
  assert.equal(same.baseline.end, '2026-10-17T02:00:00')
  assert.throws(() => reportRanges({ date: '2026-10-18' }, now), /已结束/)
  assert.throws(() => reportRanges({ date: '2026-02-30' }, now), /无效/)
})

test('cleaning preserves zero/negative readings, rejects unknown quality, isolates point identity and deduplicates boundaries', () => {
  const clean = cleanReportSamples([sample(0, -1), sample(1, 0), sample(1, 2), sample(2, 99, { quality: 'Bad' }), sample(3, 4, { quality: undefined }), sample(4, null), sample(60, 100)], point, range)
  assert.deepEqual(clean.valid.map(row => row.value), [-1, 2])
  assert.equal(clean.duplicates, 1); assert.equal(clean.invalid, 3); assert.equal(clean.outside, 1)
  assert.throws(() => cleanReportSamples([sample(0, 1, { pointId: 36 })], point, range), /pointId/)
  assert.throws(() => cleanReportSamples([sample(0, 1, { channelId: 'AI02' })], point, range), /身份/)
})

test('report generation accepts numeric Good quality from collection history without admitting bad or missing readings', async () => {
  const readings = Array.from({ length: 12 }, (_, i) => sample(i * 5, i - 1, { quality: 1 }))
  const rejected = [0, 2, 3, null, undefined, '1', 'Bad'].map((quality, i) => sample(i + 0.5, 999, { quality }))
  rejected.push(sample(7.5, null, { quality: 1 }), sample(8.5, '32.9', { quality: 1 }))
  const report = await generateEquipmentReport({ points: [point], ranges: { current: range, baseline: range },
    telemetry: { getStoredAggregate: async () => aggregate([...readings, ...rejected]) },
    alarms: { getAlarms: async () => ({ events: [] }) }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
  })
  const row = report.rows[0]
  assert.equal(row.current.count, 12)
  assert.equal(row.current.invalid, rejected.length)
  assert.equal(row.current.coverage, 1)
  assert.equal(row.current.min, -1)
  assert.equal(row.current.max, 10)
  assert.equal(row.current.mean, 4.5)
  assert.equal(row.change.percent, 0)
})

test('trend smoothing does not remove original peaks from sample statistics and resets after gaps', () => {
  const clean = cleanReportSamples(Array.from({ length: 60 }, (_, i) => sample(i, i === 30 ? 1000 : i)), point, range)
  const summary = summarizeReportSamples(clean, point, range)
  assert.equal(summary.max, 1000); assert.equal(summary.peak.value, 1000)
  assert.ok(summary.slope > 40 && summary.slope < 80)
  assert.ok(summary.overCount > 0); assert.equal(summary.coverage, 1)
  const filtered = minuteReportSeries([{ time: start, value: 1 }, { time: start + 60000, value: 1 }, { time: start + 600000, value: 50 }])
  assert.equal(filtered.at(-1).value, 50)
  assert.equal(summarizeReportSamples(clean, point, range, true).slope, null)
  assert.equal(summarizeReportSamples(cleanReportSamples([sample(0, 10)], point, range), point, range).slope, null)
  assert.deepEqual(reportChange(5, 0), { delta: 5, percent: null })
  assert.deepEqual(reportChange(-5, -10), { delta: 5, percent: 50 })
})

test('IO debounce ignores bounce edges, never bridges bad quality/gaps, and does not infer a first rising edge', () => {
  const samples = [[0, 0], [4, 1], [5, 0], [9, 1], [13, 0], [17, 0]].map(([second, value]) => sample(second / 60, value))
  const summary = summarizeDigitalReport(cleanReportSamples(samples, point, range), range, false, { debounceMs: 3000 })
  assert.equal(summary.rising, 1); assert.equal(summary.falling, 1)
  assert.equal(summary.activeSeconds, 4); assert.equal(summary.longestHighSeconds, 4)
  assert.equal(summary.rejectedRuns, 1)
  const interrupted = [[0, 1], [4, 1], [70, 0], [74, 0]].map(([second, value]) => sample(second / 60, value))
  const gaps = summarizeDigitalReport(cleanReportSamples(interrupted, point, range), range)
  assert.equal(gaps.rising, 0); assert.equal(gaps.falling, 0)
  assert.equal(gaps.activeSeconds, 4); assert.equal(gaps.observedSeconds, 8)
  const invalid = [sample(0, 0), sample(0.1, 1, { quality: 'Bad' }), sample(0.2, 1), sample(0.3, 1)]
  assert.equal(summarizeDigitalReport(cleanReportSamples(invalid, point, range), range).rising, 0)
})

test('event statistics enforce the half-open period and never resolve ambiguous channel identity', () => {
  const other = { ...point, pointId: 36, channelId: 'AI02' }
  const events = [{ pointId: 35, alarmId: '1', startedAt: range.start }, { pointId: 35, alarmId: '1', startedAt: range.start }, { moduleId: point.moduleId, pointCode: point.pointCode, startedAt: range.start }, { pointId: 35, startedAt: range.end }]
  const matched = reportEvents(events, [point, other], range)
  assert.equal(matched.events.length, 1); assert.equal(matched.unmapped, 1)
})

test('IO defaults retain short pulses and final observed edges without inventing final duration', () => {
  const short = [[0, 0], [0.1, 1], [0.2, 0], [0.3, 0]].map(([second, value]) => sample(second / 60, value))
  const raw = summarizeDigitalReport(cleanReportSamples(short, point, range), range)
  assert.equal(raw.rising, 1); assert.equal(raw.falling, 1)
  assert.equal(raw.activeSeconds, 0.1)
  const debounced = summarizeDigitalReport(cleanReportSamples(short, point, range), range, false, { debounceMs: 500 })
  assert.equal(debounced.rising, 0); assert.equal(debounced.rawRising, 1)
  const final = summarizeDigitalReport(cleanReportSamples([sample(0, 0), sample(0.1, 1)], point, range), range)
  assert.equal(final.rising, 1); assert.equal(final.activeSeconds, 0)
})

test('report queue bounds concurrency, preserves partial failures and stops scheduling after cancellation', async () => {
  let running = 0, maximum = 0
  const result = await reportPool([1, 2, 3, 4, 5], async value => {
    running++; maximum = Math.max(maximum, running)
    await new Promise(resolve => setTimeout(resolve, 2)); running--
    if (value === 3) throw new Error('offline')
    return value
  }, { concurrency: 2 })
  assert.equal(maximum, 2); assert.equal(result[2].status, 'rejected'); assert.equal(result[4].value, 5)
  const controller = new AbortController(), calls = []
  await assert.rejects(reportPool([1, 2, 3], async value => { calls.push(value); controller.abort(); return value }, { signal: controller.signal, concurrency: 1 }), /abort/i)
  assert.deepEqual(calls, [1])
})

test('report catalogs include only key measurements and reject mismatched catalog modules', async () => {
  assert.equal(eligibleReportPoint({ ...point, pointCode: 'ACOUSTIC_RMS' }), false)
  for (const metricType of ['DigitalInput', 'Boolean', 'AlarmStatus', 'SelfTestResult', 'Speed', 'Current']) assert.equal(eligibleReportPoint({ ...point, metricType }), false)
  for (const metricType of ['VibrationRms', 'VibrationUnbalance', 'Temperature', 'NegativePressure', 'Pressure']) assert.equal(eligibleReportPoint({ ...point, metricType }), true)
  const calls = []
  const result = await loadReportCatalog({ api: {
    getModules: async () => ({ modules: [{ moduleId: 'A' }, { moduleId: 'B' }, { moduleId: 'C', protocol: 'Acoustic' }] }),
    getModulePoints: async moduleId => { calls.push(moduleId); return { moduleId: moduleId === 'B' ? 'wrong' : 'A', points: [point, { ...point, metricType: 'DigitalInput' }] } },
  } })
  assert.deepEqual(calls, ['A', 'B']); assert.equal(result.errors.length, 1); assert.equal(result.points.length, 1)
})

test('report generation exposes partial errors and exports a standalone HTML report without IO', async () => {
  const samples = Array.from({ length: 12 }, (_, i) => sample(i * 5, i))
  const io = { ...point, pointId: 36, pointCode: 'DI01', metricType: 'DigitalInput' }
  const report = await generateEquipmentReport({ points: [point, io], ranges: { current: range, baseline: range },
    telemetry: { getStoredAggregate: async query => aggregate(samples, { query }) },
    alarms: { getAlarms: async () => { throw new Error('HTTP 500') } }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
  })
  assert.equal(report.sources.hard.current.events, null); assert.match(report.sources.hard.current.error, /500/)
  assert.equal(report.sources.trend.current.events.length, 0)
  assert.equal(report.rows.find(row => row.kind === 'analog').change.percent, 0)
  assert.equal(report.rows.length, 1)
  const html = reportHtml(report, { title: '<班报>', scope: '全部', notes: '<script>alert(1)</script>' })
  assert.match(html, /^<!DOCTYPE html>/); assert.match(html, /HTTP 500/); assert.match(html, /&lt;班报&gt;/)
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script|IO 状态统计|IO 去抖|https?:\/\//)
  const ioRow = { point: io, kind: 'digital', clean: cleanReportSamples([sample(0, 0), sample(0.1, 1)], io, range), baseClean: cleanReportSamples([], io, range) }
  const option = reportEvidenceOption(ioRow, report.ranges, range)
  assert.equal(option.series.length, 2); assert.equal(option.series[0].step, 'end')
  assert.equal(option.yAxis.max, 1)
})

test('sparse and truncated histories never yield a period comparison', async () => {
  for (const truncated of [false, true]) {
    const report = await generateEquipmentReport({ points: [point], ranges: { current: range, baseline: range },
      telemetry: { getStoredAggregate: async () => aggregate(truncated ? Array.from({ length: 12 }, (_, i) => sample(i * 5, 1)) : [sample(0, 1)], { truncated }) },
      alarms: { getAlarms: async () => ({ events: [] }) }, analysis: { getTrendAlarms: async () => ({ events: [] }) },
    })
    assert.equal(report.rows[0].change.delta, null); assert.equal(report.rows[0].current.slope, null)
  }
})
