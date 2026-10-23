import { localInputTime } from './telemetry.js'

export const REPORT_BUCKET_MINUTES = 5
const STEP = REPORT_BUCKET_MINUTES * 60000

// Keep every request below the 200-bucket limit, including natural-day reports.
export function reportAggregateQueries(pointId, range) {
  const queries = []
  for (let start = Date.parse(range.start); start < Date.parse(range.end); start += STEP * 200) {
    queries.push({ pointId, start: localInputTime(new Date(start)), end: localInputTime(new Date(Math.min(start + STEP * 200, Date.parse(range.end)))), bucketMinutes: REPORT_BUCKET_MINUTES, limit: 200 })
  }
  return queries
}

export function summarizeReportBuckets(results, point, range) {
  const byTime = new Map()
  let invalid = 0, truncated = false
  const from = Date.parse(range.start), end = Date.parse(range.end)
  for (const result of results) {
    if (!Array.isArray(result?.buckets)) throw new Error('聚合历史返回格式不正确')
    if (result.query?.pointId != null && Number(result.query.pointId) !== Number(point.pointId)) throw new Error('聚合历史 pointId 不匹配')
    truncated ||= result.truncated === true
    for (const bucket of result.buckets) {
      for (const field of ['pointId', 'moduleId', 'channelId', 'pointCode']) {
        if (bucket[field] != null && point[field] != null && String(bucket[field]) !== String(point[field])) throw new Error('聚合历史采集身份不匹配')
      }
      const time = Date.parse(bucket.bucketStart)
      const numeric = ['minValue', 'maxValue', 'averageValue', 'lastValue'].every(key => typeof bucket[key] === 'number' && Number.isFinite(bucket[key]))
      if (!Number.isFinite(time) || time < from || time >= end || (time - from) % STEP !== 0
        || !numeric || !Number.isSafeInteger(bucket.sampleCount) || bucket.sampleCount <= 0
        || ![1, 'Good'].includes(bucket.quality) || bucket.minValue > bucket.maxValue
        || bucket.averageValue < bucket.minValue || bucket.averageValue > bucket.maxValue
        || bucket.lastValue < bucket.minValue || bucket.lastValue > bucket.maxValue) { invalid++; continue }
      if (byTime.has(time)) {
        const previous = byTime.get(time)
        if (['minValue', 'maxValue', 'averageValue', 'lastValue', 'sampleCount'].some(key => previous[key] !== bucket[key])) throw new Error('聚合历史存在冲突的重复时间桶')
        continue
      }
      byTime.set(time, { ...bucket, time, value: bucket.averageValue })
    }
  }
  const buckets = [...byTime.values()].sort((a, b) => a.time - b.time)
  const count = buckets.reduce((sum, bucket) => sum + bucket.sampleCount, 0)
  const expectedBuckets = Math.ceil((end - from) / STEP)
  const overBuckets = buckets.filter(bucket => (typeof point.minimumValue === 'number' && bucket.minValue < point.minimumValue)
    || (typeof point.maximumValue === 'number' && bucket.maxValue > point.maximumValue)).length
  return { aggregation: true, bucketMinutes: REPORT_BUCKET_MINUTES, buckets, minutes: buckets,
    count, bucketCount: buckets.length, expectedBuckets, missingBuckets: expectedBuckets - buckets.length,
    coverage: buckets.length / expectedBuckets, invalid, truncated, overBuckets, slope: null,
    mean: count ? buckets.reduce((sum, bucket) => sum + bucket.averageValue * bucket.sampleCount, 0) / count : null,
    min: count ? Math.min(...buckets.map(bucket => bucket.minValue)) : null,
    max: count ? Math.max(...buckets.map(bucket => bucket.maxValue)) : null,
    last: buckets.at(-1)?.lastValue ?? null }
}

export function reportBucketPath(summary, range, width = 900, height = 180) {
  const buckets = summary?.buckets || []
  if (!buckets.length) return ''
  const low = Math.min(...buckets.map(bucket => bucket.averageValue)), high = Math.max(...buckets.map(bucket => bucket.averageValue))
  const duration = Date.parse(range.end) - Date.parse(range.start)
  return buckets.map((bucket, index) => {
    const x = 12 + (bucket.time - Date.parse(range.start)) / duration * (width - 24)
    const y = high === low ? height / 2 : height - 12 - (bucket.averageValue - low) / (high - low) * (height - 24)
    return `${!index || bucket.time - buckets[index - 1].time > STEP ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}
