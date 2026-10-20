import { localInputTime } from './telemetry.js'
import { shiftRange } from './shiftRange.js'

const MINUTE = 60000
export const reportNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null
export const reportValue = value => reportNumber(value) === null ? '—' : Number(value.toFixed(3)).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
export const reportPointKind = point => ['DigitalInput', 'AlarmStatus', 'SelfTestResult', 'Boolean'].includes(point.metricType) ? 'digital' : 'analog'
export const reportMetricGroups = [
  { id: 'vibration', label: '振动' },
  { id: 'temperature', label: '温度' },
  { id: 'pressure', label: '负压 / 压力' },
]
export function reportMetricGroup(point) {
  if (reportPointKind(point) === 'digital') return null
  const type = point.metricType || ''
  if (/^Vibration|振动/i.test(type)) return 'vibration'
  if (/^Temperature$|温度/i.test(type)) return 'temperature'
  if (/^(NegativePressure|Pressure)$|压力|负压/i.test(type)) return 'pressure'
  return null
}
export const eligibleReportPoint = point => Number.isSafeInteger(Number(point.pointId)) && Number(point.pointId) > 0
  && !/acoustic|audio|sound|声纹|声学/i.test(`${point.metricType || ''} ${point.pointCode || ''} ${point.protocol || ''}`)
  && reportMetricGroup(point) !== null

export function defaultReportSelection(now = new Date()) {
  const current = shiftRange('current', now)
  const last = Date.parse(current.end) <= now.getTime() ? current : shiftRange('previous', now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return { date: last.start.slice(0, 10), shift: last.start.slice(11, 13) === '09' ? 'day' : 'night', yesterday: localInputTime(yesterday).slice(0, 10) }
}

export function reportRanges({ mode = 'shift', date, shift = 'day', comparison = 'adjacent' }, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('请选择报告日期')
  const start = new Date(`${date}T00:00:00`)
  if (!Number.isFinite(start.getTime()) || localInputTime(start).slice(0, 10) !== date) throw new Error('报告日期无效')
  if (!['shift', 'daily'].includes(mode) || !['day', 'night'].includes(shift)) throw new Error('报告类型或班次无效')
  const end = new Date(start), baseStart = new Date(start), baseEnd = new Date(start)
  if (mode === 'daily') {
    end.setDate(end.getDate() + 1)
    baseStart.setDate(baseStart.getDate() - 1)
  } else {
    start.setHours(shift === 'day' ? 9 : 18, shift === 'day' ? 30 : 0)
    end.setHours(shift === 'day' ? 18 : 2)
    if (shift === 'night') end.setDate(end.getDate() + 1)
    if (comparison === 'same') {
      baseStart.setTime(start.getTime()); baseStart.setDate(baseStart.getDate() - 1)
      baseEnd.setTime(end.getTime()); baseEnd.setDate(baseEnd.getDate() - 1)
    } else if (shift === 'day') {
      baseStart.setDate(baseStart.getDate() - 1); baseStart.setHours(18)
      baseEnd.setHours(2)
    } else {
      baseStart.setHours(9, 30); baseEnd.setHours(18)
    }
  }
  if (end.getTime() > now.getTime()) throw new Error('仅能生成已结束的班次或日期报告')
  const range = (from, to) => ({ start: localInputTime(from), end: localInputTime(to), hours: (to - from) / 3600000 })
  return { current: range(start, end), baseline: range(baseStart, baseEnd) }
}

export function cleanReportSamples(samples, point, range) {
  const byTime = new Map()
  let outside = 0, duplicates = 0
  for (const sample of samples) {
    const time = Date.parse(sample.collectedAt)
    if (!Number.isFinite(time) || time < Date.parse(range.start) || time >= Date.parse(range.end)) { outside++; continue }
    if (sample.pointId != null && String(sample.pointId) !== String(point.pointId)) throw new Error('历史数据 pointId 不匹配')
    for (const field of ['moduleId', 'channelId', 'pointCode']) {
      if (sample[field] != null && point[field] != null && String(sample[field]) !== String(point[field])) throw new Error('历史数据采集身份不匹配')
    }
    if (byTime.has(time)) duplicates++
    byTime.set(time, { time, value: reportNumber(sample.value), quality: sample.quality })
  }
  const ordered = [...byTime.values()].sort((a, b) => a.time - b.time)
  // Collection history serializes Good as enum value 1; other responses use its name.
  const raw = ordered.map(row => ({ ...row, value: row.quality === 'Good' || row.quality === 1 ? row.value : null }))
  const valid = raw.filter(row => row.value !== null)
  return { raw, valid, invalid: raw.length - valid.length, outside, duplicates }
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Minute medians reduce sampling-frequency bias. Gaps reset both filters.
export function minuteReportSeries(valid, filter = 'ema') {
  const buckets = new Map()
  for (const row of valid) {
    const time = Math.floor(row.time / MINUTE) * MINUTE
    if (!buckets.has(time)) buckets.set(time, [])
    buckets.get(time).push(row.value)
  }
  const minutes = [...buckets].sort((a, b) => a[0] - b[0]).map(([time, values]) => ({ time, value: median(values) }))
  let window = [], previous = null, ema = null
  return minutes.map(row => {
    if (previous !== null && row.time - previous > MINUTE * 1.5) { window = []; ema = null }
    previous = row.time
    window.push(row.value)
    if (window.length > 5) window.shift()
    const center = median(window)
    ema = ema === null ? center : 0.3 * center + 0.7 * ema
    return { time: row.time, value: filter === 'median' ? center : filter === 'raw' ? row.value : ema }
  })
}

export function summarizeReportSamples(clean, point, range, truncated = false) {
  const values = clean.valid.map(row => row.value).sort((a, b) => a - b)
  const count = values.length
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null
  const minutes = minuteReportSeries(clean.valid)
  const coverage = minutes.length / Math.ceil((Date.parse(range.end) - Date.parse(range.start)) / MINUTE)
  const min = reportNumber(point.minimumValue), max = reportNumber(point.maximumValue)
  const over = clean.valid.filter(row => (min !== null && row.value < min) || (max !== null && row.value > max))
  // OLS in units/hour, only with sufficient observed minutes across the period.
  let slope = null
  if (!truncated && coverage >= 0.6 && minutes.length >= 20) {
    const origin = minutes[0].time
    const xs = minutes.map(row => (row.time - origin) / 3600000)
    const xMean = xs.reduce((a, b) => a + b, 0) / xs.length
    const yMean = minutes.reduce((a, b) => a + b.value, 0) / minutes.length
    const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)
    if (denominator > 0) slope = minutes.reduce((sum, row, i) => sum + (xs[i] - xMean) * (row.value - yMean), 0) / denominator
  }
  let peak = null
  for (const row of clean.valid) if (!peak || Math.abs(row.value - mean) > Math.abs(peak.value - mean)) peak = row
  const strongest = minutes.reduce((best, row, i) => {
    if (!i || row.time - minutes[i - 1].time > 1.5 * MINUTE) return best
    const delta = Math.abs(row.value - minutes[i - 1].value)
    return !best || delta > best.delta ? { time: row.time, delta } : best
  }, null)
  return { count, mean, min: values[0] ?? null, max: values.at(-1) ?? null,
    p95: count ? values[Math.max(0, Math.ceil(count * 0.95) - 1)] : null,
    deviation: count ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count) : null,
    coverage: Math.min(1, coverage), invalid: clean.invalid, duplicates: clean.duplicates,
    overCount: min === null && max === null ? null : over.length,
    overMinutes: min === null && max === null ? null : new Set(over.map(row => Math.floor(row.time / MINUTE))).size,
    slope, peak, strongest, truncated, minutes,
  }
}

// Only observed adjacent intervals count as duration. No carry-forward over gaps,
// bad quality, non-binary values, or beyond the final sample. Debounce is temporal.
export function summarizeDigitalReport(clean, range, truncated = false, { debounceMs = 0, maxGapMs = 60000 } = {}) {
  const runs = []
  let block = 0, rawRising = 0, rawFalling = 0
  for (let i = 0; i < clean.raw.length - 1; i++) {
    const row = clean.raw[i], next = clean.raw[i + 1]
    if (![0, 1].includes(row.value) || ![0, 1].includes(next.value) || next.time - row.time > maxGapMs) { block++; continue }
    if (row.value === 0 && next.value === 1) rawRising++
    if (row.value === 1 && next.value === 0) rawFalling++
    const last = runs.at(-1)
    if (last && last.block === block && last.value === row.value && last.end === row.time) last.end = next.time
    else runs.push({ time: row.time, end: next.time, value: row.value, block })
  }
  const stable = runs.filter(run => run.end - run.time >= debounceMs)
  let rising = 0, falling = 0
  for (let i = 1; i < stable.length; i++) {
    if (stable[i].block !== stable[i - 1].block || stable[i].value === stable[i - 1].value) continue
    if (stable[i].value === 1) rising++
    else falling++
  }
  if (debounceMs === 0) { rising = rawRising; falling = rawFalling }
  const valid = clean.valid.filter(row => [0, 1].includes(row.value))
  const observedMs = runs.reduce((sum, run) => sum + run.end - run.time, 0)
  const high = stable.filter(run => run.value === 1)
  const activeMs = high.reduce((sum, run) => sum + run.end - run.time, 0)
  return { count: valid.length, invalid: clean.raw.length - valid.length, duplicates: clean.duplicates,
    coverage: new Set(valid.map(row => Math.floor(row.time / MINUTE))).size / Math.ceil((Date.parse(range.end) - Date.parse(range.start)) / MINUTE),
    rising, falling, rawRising, rawFalling, debounceMs, activeSeconds: activeMs / 1000, observedSeconds: observedMs / 1000,
    longestHighSeconds: high.reduce((max, run) => Math.max(max, (run.end - run.time) / 1000), 0),
    rejectedRuns: runs.length - stable.length, stable, truncated,
    peak: high[0] || valid[0] || null, strongest: stable.find((run, i) => i > 0 && run.block === stable[i - 1].block && run.value !== stable[i - 1].value) || null,
    mean: null, min: null, max: null, p95: null, deviation: null, slope: null, overCount: null, overMinutes: null,
  }
}

export function reportChange(current, baseline) {
  if (reportNumber(current) === null || reportNumber(baseline) === null) return { delta: null, percent: null }
  return { delta: current - baseline, percent: baseline === 0 ? null : (current - baseline) / Math.abs(baseline) * 100 }
}

export function matchReportEvent(event, points) {
  const candidates = points.filter(point => event.pointId != null
    ? String(event.pointId) === String(point.pointId)
    : event.moduleId != null && event.pointCode != null && String(event.moduleId) === String(point.moduleId) && event.pointCode === point.pointCode
      && (event.channelId == null || String(event.channelId) === String(point.channelId)))
  return candidates.length === 1 ? candidates[0] : null
}

export function reportEvents(events, points, range) {
  const mapped = [], unmapped = [], seen = new Set()
  for (const event of events) {
    const time = Date.parse(event.startedAt || event.createdAt)
    if (!Number.isFinite(time) || time < Date.parse(range.start) || time >= Date.parse(range.end)) continue
    const point = matchReportEvent(event, points)
    if (!point) { unmapped.push(event); continue }
    const key = String(event.alarmId ?? event.id ?? JSON.stringify([point.pointId, time, event.alarmType, event.reason]))
    if (seen.has(key)) continue
    seen.add(key)
    mapped.push({ ...event, reportPointId: point.pointId })
  }
  return { events: mapped, unmapped: unmapped.length }
}

export function evidenceRange(summary, range, kind = 'peak') {
  if (kind === 'full') return { start: range.start, end: range.end }
  const anchor = kind === 'change' ? summary.strongest : summary.peak
  if (!anchor) return { start: range.start, end: range.end }
  return { start: localInputTime(Math.max(Date.parse(range.start), anchor.time - 15 * MINUTE)), end: localInputTime(Math.min(Date.parse(range.end), anchor.time + 15 * MINUTE)) }
}

const gapData = (rows, gap = 90000) => {
  const data = []
  for (const row of rows) {
    if (data.length && row.time - data.at(-1)[0] > gap) data.push([data.at(-1)[0] + 1, null])
    data.push([row.time, row.value])
  }
  return data
}

export function reportEvidenceOption(row, ranges, selection, filter = 'ema') {
  const currentStart = Date.parse(ranges.current.start), baseStart = Date.parse(ranges.baseline.start)
  const raw = row.clean.raw.filter(item => item.time >= Date.parse(selection.start) && item.time < Date.parse(selection.end))
  const digital = row.kind === 'digital'
  const filtered = digital ? [] : minuteReportSeries(row.clean.valid, filter).filter(item => item.time >= Date.parse(selection.start) && item.time < Date.parse(selection.end))
  // Same elapsed time since period start; no stretching an 8h shift into an 8.5h shift.
  const baseline = (digital ? row.baseClean?.raw || [] : minuteReportSeries(row.baseClean?.valid || [], filter)).map(item => ({ ...item, time: currentStart + item.time - baseStart }))
    .filter(item => item.time >= Date.parse(selection.start) && item.time < Date.parse(selection.end))
  const series = (name, rows, color, width, extra = {}) => ({ name, type: 'line', data: gapData(rows.map(item => digital && ![0, 1].includes(item.value) ? { ...item, value: null } : item), digital ? 60000 : 90000), showSymbol: false, connectNulls: false, ...(digital ? { step: 'end' } : { sampling: 'lttb' }), lineStyle: { color, width, ...extra }, itemStyle: { color } })
  return {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' }, valueFormatter: value => reportValue(value) },
    legend: { top: 8, textStyle: { color: '#C3E2D9', fontSize: 12 }, itemWidth: 16 },
    grid: { left: 65, right: 30, top: 65, bottom: 65 },
    xAxis: { type: 'time', min: Date.parse(selection.start), max: Date.parse(selection.end), axisLabel: { color: '#C3E2D9', hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, ...(digital ? { min: 0, max: 1, interval: 1 } : {}), name: digital ? 'IO 电平' : row.point.unit || '', nameTextStyle: { color: '#C3E2D9' }, axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)', type: 'dashed' } } },
    dataZoom: [{ type: 'inside', filterMode: 'none' }, { type: 'slider', bottom: 8, height: 20, textStyle: { color: '#C3E2D9' }, borderColor: 'rgba(195,226,217,.12)' }],
    series: [series(digital ? '本期原始 IO 电平' : '本期原始有效值', raw, digital ? '#50d8cb' : '#80958c', digital ? 2 : 1), ...(!digital ? [series(filter === 'raw' ? '分钟中位值' : filter === 'median' ? '5分钟中值' : '中值 + EMA', filtered, '#50d8cb', 2.3)] : []), series('对比期（等经过时长）', baseline, '#c49e67', 1.5, { type: 'dashed' })],
  }
}
