export const pointKey = (point) => JSON.stringify([point.moduleId, point.channelId, point.pointCode])
export const numericValue = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null
export const localInputTime = (value) => {
  const date = new Date(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function appendSamples(buffers, samples, maxPoints = 300) {
  const next = { ...buffers }
  const grouped = new Map()
  for (const sample of samples) {
    if (!sample || !sample.moduleId || !sample.channelId || !sample.pointCode || !Number.isFinite(Date.parse(sample.collectedAt))) continue
    const key = pointKey(sample)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(sample)
  }
  for (const [key, incoming] of grouped) {
    const byTime = new Map((buffers[key] || []).map((sample) => [Date.parse(sample.collectedAt), sample]))
    for (const sample of incoming) byTime.set(Date.parse(sample.collectedAt), sample)
    next[key] = [...byTime.values()].sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt)).slice(-maxPoints)
  }
  // Bound memory if backend configuration changes repeatedly during a long visit.
  for (const key of Object.keys(next)) if (!grouped.has(key)) delete next[key]
  return next
}

export function seriesData(samples = [], gapMs = Infinity) {
  const ordered = [...samples].filter((s) => Number.isFinite(Date.parse(s.collectedAt))).sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt))
  const data = []
  for (const sample of ordered) {
    const time = Date.parse(sample.collectedAt)
    if (data.length && time - data.at(-1)[0] > gapMs) data.push([data.at(-1)[0] + 1, null])
    data.push([time, numericValue(sample.value)])
  }
  return data
}

export function telemetryLine(samples, point, { history = false, color = history ? '#68afff' : '#50d8cb' } = {}) {
  const data = seriesData(samples, history ? Infinity : 15000)
  return {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' }, valueFormatter: (value) => typeof value === 'number' ? `${value.toFixed(3)} ${point?.unit || ''}` : '无效值' },
    grid: { left: 65, right: 28, top: 40, bottom: 65 },
    xAxis: { type: 'time', axisLabel: { color: '#C3E2D9', fontSize: 14, hideOverlap: true }, axisLine: { lineStyle: { color: '#46907C' } }, splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, name: point?.unit || '', nameTextStyle: { color: '#C3E2D9' }, axisLabel: { color: '#C3E2D9', fontSize: 14 }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)', type: 'dashed' } } },
    dataZoom: [{ type: 'inside', filterMode: 'none' }, { type: 'slider', bottom: 8, height: 20, borderColor: 'rgba(195,226,217,.12)', textStyle: { color: '#C3E2D9' } }],
    graphic: data.length ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: history ? '请选择时间范围并查询历史数据' : '等待该点位的真实采样', fill: '#C3E2D9', fontSize: 15 } }],
    series: [{ id: history ? 'history' : 'live', name: point?.name || point?.pointCode || '采样值', type: 'line', smooth: false, connectNulls: false, showSymbol: data.length < 20, symbolSize: 5, sampling: 'lttb', lineStyle: { color, width: 2 }, itemStyle: { color }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}30` }, { offset: 1, color: `${color}00` }] } }, data }],
  }
}
