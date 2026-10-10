const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null

export const riskLabel = (value) => ({ Normal: '正常', Watch: '关注', Warning: '预警', NoData: '无数据' }[value] || value || '未知')
export const riskTone = (value) => ({ Normal: 'normal', Watch: 'watch', Warning: 'warning', NoData: 'empty' }[value] || 'empty')
export const percent = (value) => number(value) === null ? '—' : `${(Number(value) * 100).toFixed(1)}%`
export const valueText = (value, unit = '') => number(value) === null ? '—' : `${Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}${unit ? ` ${unit}` : ''}`

export function dailyLimitTrendOption(days = [], point = {}) {
  const dates = days.map((item) => String(item.date || '').slice(0, 10))
  const series = (name, field, color, extra = {}) => ({
    name,
    type: 'line',
    smooth: false,
    showSymbol: days.length < 40,
    symbolSize: 5,
    data: days.map((item) => number(item[field])),
    lineStyle: { width: 1.5, color, ...(extra.lineStyle || {}) },
    itemStyle: { color },
    connectNulls: false,
    ...extra,
  })
  return {
    animationDuration: 420,
    color: ['#50d8cb', '#ffad66', '#8ee6a8'],
    tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
    legend: { top: 2, right: 8, textStyle: { color: '#C3E2D9', fontSize: 14 }, itemWidth: 14, itemHeight: 7 },
    grid: { left: 54, right: 20, top: 40, bottom: 38 },
    xAxis: { type: 'category', data: dates, boundaryGap: false, axisLabel: { color: '#9fbdb4', fontSize: 14 }, axisLine: { lineStyle: { color: '#9fbdb4' } } },
    yAxis: { type: 'value', name: point.unit || '', nameTextStyle: { color: '#9fbdb4' }, axisLabel: { color: '#9fbdb4', fontSize: 14 }, splitLine: { lineStyle: { color: 'rgba(171,235,218,.12)' } } },
    series: [
      series('日均值', 'averageValue', '#50d8cb', { areaStyle: { color: 'rgba(80,216,203,.09)' }, lineStyle: { width: 2 } }),
      series('日最大值', 'maxValue', '#ffad66'),
      series('日最小值', 'minValue', '#8ee6a8'),
      series('上限', 'maximumValue', '#ff8b1f', { symbol: 'none', lineStyle: { type: 'dashed', width: 1 } }),
      series('下限', 'minimumValue', '#c3e2d9', { symbol: 'none', lineStyle: { type: 'dashed', width: 1 } }),
    ],
  }
}

export function trendAlarmChangeOption(events = []) {
  const ordered = [...events].sort((left, right) => Date.parse(left.startedAt || left.createdAt || 0) - Date.parse(right.startedAt || right.createdAt || 0))
  const labels = ordered.map((item) => String(item.startedAt || item.createdAt || '').replace('T', ' ').slice(0, 16))
  const firstUnit = ordered.find((item) => item.unit)?.unit || ''
  const values = ordered.map((item) => number(item.alarmValue))
  return {
    animationDuration: 420,
    color: ['#50d8cb'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#111312',
      borderColor: '#46907C',
      textStyle: { color: '#FFFFFF' },
      valueFormatter: (value) => value === null || value === undefined ? '—' : value,
    },
    grid: { left: 54, right: 20, top: 28, bottom: 42 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: '#9fbdb4', fontSize: 14 }, axisLine: { lineStyle: { color: '#9fbdb4' } } },
    yAxis: { type: 'value', name: firstUnit, nameTextStyle: { color: '#9fbdb4' }, axisLabel: { color: '#9fbdb4', fontSize: 14 }, splitLine: { lineStyle: { color: 'rgba(171,235,218,.12)' } } },
    dataZoom: ordered.length > 18 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 10, borderColor: 'rgba(80,216,203,.22)', textStyle: { color: '#9fbdb4' } }] : undefined,
    series: [
      { name: '报警值', type: 'line', smooth: false, showSymbol: ordered.length < 60, symbolSize: 5, data: values, lineStyle: { width: 2, color: '#50d8cb' }, itemStyle: { color: '#50d8cb' }, areaStyle: { color: 'rgba(80,216,203,.08)' }, connectNulls: false },
    ],
  }
}
