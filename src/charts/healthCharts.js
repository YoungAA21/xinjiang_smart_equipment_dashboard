export const palette = { mint: '#8ee6a8', cyan: '#50d8cb', blue: '#68afff', violet: '#ab9ff2', orange: '#ffad66', red: '#ff7285', gray: '#708781', text: '#C3E2D9', line: 'rgba(195,226,217,.12)' }
const text = palette.text
const tooltip = { trigger: 'item', renderMode: 'richText', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF', fontSize: 14 }, confine: true }
const base = { animationDuration: 900, animationDurationUpdate: 450, textStyle: { fontFamily: 'Microsoft YaHei, sans-serif' } }
const gradient = (a, b) => ({ type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: a }, { offset: 1, color: b }] })
const empty = (message = '等待接口数据') => ({ ...base, graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: message, fill: text, fontSize: 15 } }], series: [] })
export const countOnline = (modules = []) => ({
  online: modules.filter((m) => m.isOnline === true).length,
  offline: modules.filter((m) => m.isOnline === false).length,
  unknown: modules.filter((m) => typeof m.isOnline !== 'boolean').length,
})

export function healthGauge(checks = []) {
  if (!checks.length) return empty('暂无检查结果')
  const passed = checks.filter((c) => c.status === 'Healthy').length
  const percent = passed / checks.length * 100
  const color = passed === checks.length ? palette.mint : palette.orange
  return { ...base, series: [
    { type: 'gauge', radius: '89%', center: ['50%', '53%'], startAngle: 225, endAngle: -45, min: 0, max: 100,
      axisLine: { lineStyle: { width: 1, color: [[1, palette.line]] } }, axisTick: { distance: -8, splitNumber: 5, length: 3, lineStyle: { color: '#46907C' } },
      splitLine: { distance: -9, length: 9, lineStyle: { color: '#46907C' } }, axisLabel: { show: false }, pointer: { show: false }, detail: { show: false } },
    { type: 'gauge', radius: '77%', center: ['50%', '53%'], startAngle: 225, endAngle: -45, min: 0, max: 100,
      progress: { show: true, roundCap: true, width: 14, itemStyle: { color: gradient(palette.cyan, color), shadowBlur: 15, shadowColor: '#50d8cb55' } },
      axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, palette.line]] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
      title: { offsetCenter: [0, '27%'], color: text, fontSize: 14 }, detail: { valueAnimation: true, offsetCenter: [0, '-6%'], formatter: (v) => `${Number(v.toFixed(1))}%`, fontSize: 50, fontWeight: 600, color: '#FFFFFF' },
      data: [{ value: percent, name: '健康检查通过率' }] },
  ] }
}

export function onlineDonut(modules = []) {
  if (!modules.length) return empty('暂无模块状态')
  const counts = countOnline(modules)
  return { ...base, tooltip, title: { text: `${Math.round(counts.online / modules.length * 100)}%`, subtext: '在线率', left: 'center', top: '34%', itemGap: 5, textStyle: { color: '#FFFFFF', fontSize: 30 }, subtextStyle: { color: text, fontSize: 14 } }, series: [{
    type: 'pie', radius: ['68%', '85%'], center: ['50%', '51%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
    itemStyle: { borderRadius: 5, borderColor: '#111312', borderWidth: 3 }, emphasis: { scaleSize: 4 }, data: [
      { name: '在线', value: counts.online, itemStyle: { color: palette.mint } },
      { name: '离线', value: counts.offline, itemStyle: { color: palette.orange } },
      { name: '未知', value: counts.unknown, itemStyle: { color: palette.gray } },
    ].filter((d) => d.value > 0),
  }] }
}

export function groupChecks(checks = []) {
  const groups = [
    { name: '数据库 / 点位', matches: (n) => n.startsWith('database.') && !n.startsWith('database.module_table.') && !n.startsWith('database.aggregation_table.') },
    { name: '历史数据表', matches: (n) => n.startsWith('database.module_table.') },
    { name: '聚合数据表', matches: (n) => n.startsWith('database.aggregation_table.') },
    { name: '配置文件', matches: (n) => n.startsWith('config.') },
    { name: '缓存 / 队列', matches: (n) => n.startsWith('offline_cache') || n.startsWith('pipeline.') },
    { name: '模块运行时', matches: (n) => n.startsWith('runtime.') },
  ]
  const result = groups.map((g) => ({ name: g.name, checks: checks.filter((c) => g.matches(c.name || '')) }))
  const other = checks.filter((c) => !groups.some((g) => g.matches(c.name || '')))
  if (other.length) result.push({ name: '其他检查', checks: other })
  return result.map((g) => ({ name: g.name, total: g.checks.length, passed: g.checks.filter((c) => c.status === 'Healthy').length }))
}

export function checksBars(checks = []) {
  if (!checks.length) return empty('暂无检查结果')
  const groups = groupChecks(checks)
  return { ...base, tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } }, grid: { left: 100, right: 25, top: 8, bottom: 22 },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: palette.line, type: 'dashed' } }, axisLabel: { color: text, fontSize: 14 } },
    yAxis: { type: 'category', inverse: true, data: groups.map((g) => g.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: text, fontSize: 14 } },
    series: [
      { name: '通过', type: 'bar', stack: 'checks', barWidth: 8, itemStyle: { color: gradient('#357c72', palette.cyan), borderRadius: 4 }, data: groups.map((g) => g.passed) },
      { name: '异常', type: 'bar', stack: 'checks', barWidth: 8, itemStyle: { color: palette.orange, borderRadius: 4 }, data: groups.map((g) => g.total - g.passed) },
    ],
  }
}

// 0 = not required, 1 = covered, 2 = missing/table absent, 3 = pmax absent, 4 = unknown.
export function partitionMatrix(tables = []) {
  const months = [...new Set(tables.flatMap((t) => [...(t.expectedPartitions || []), ...(t.missingPartitions || [])]))].sort()
  const columns = [...months, 'pmax']
  const data = tables.flatMap((table, y) => columns.map((partition, x) => {
    let state = 4
    if (table.exists === false) state = 2
    else if (partition === 'pmax') state = table.hasPmax === true ? 1 : table.hasPmax === false ? 3 : 4
    else if (table.missingPartitions?.includes(partition)) state = 2
    else if (Array.isArray(table.expectedPartitions) && !table.expectedPartitions.includes(partition)) state = 0
    else if (table.exists === true && Array.isArray(table.missingPartitions)) state = 1
    return [x, y, state]
  }))
  return { columns, rows: tables.map((t) => t.moduleId), data }
}

export function partitionHeatmap(tables = []) {
  if (!tables.length) return empty('暂无分区数据')
  const matrix = partitionMatrix(tables)
  const names = ['不要求', '已覆盖', '缺失 / 表不存在', 'pmax 缺失', '状态未知']
  return { ...base, tooltip: { ...tooltip, formatter: (p) => `${matrix.rows[p.value[1]]} · ${matrix.columns[p.value[0]]}\n${names[p.value[2]]}` }, grid: { left: 77, right: 20, top: 8, bottom: 28 },
    xAxis: { type: 'category', data: matrix.columns, position: 'bottom', axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false }, axisLabel: { color: text, fontSize: 14, formatter: (v) => /^p\d{6}$/.test(v) ? `${v.slice(1, 5)}.${v.slice(5)}` : v } },
    yAxis: { type: 'category', inverse: true, data: matrix.rows, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: text, fontSize: 14 } },
    visualMap: { show: false, type: 'piecewise', pieces: [{ value: 0, color: '#233b36' }, { value: 1, color: '#469f85' }, { value: 2, color: palette.orange }, { value: 3, color: palette.red }, { value: 4, color: palette.gray }] },
    series: [{ type: 'heatmap', data: matrix.data, label: { show: true, color: '#FFFFFF', fontSize: 14, formatter: (p) => ['·', '✓', '!', '!', '?'][p.value[2]] }, itemStyle: { borderWidth: 5, borderColor: '#111312', borderRadius: 5 }, emphasis: { itemStyle: { shadowBlur: 12, shadowColor: '#50d8cb88' } } }],
  }
}

export function maintenanceBars(results = []) {
  if (!results.length) return empty('尚无维护结果')
  return { ...base, tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } }, legend: { top: 0, right: 12, itemWidth: 8, itemHeight: 8, textStyle: { color: text, fontSize: 14 } },
    grid: { top: 35, left: 32, right: 16, bottom: 34 },
    xAxis: { type: 'category', data: results.map((r) => r.moduleId), axisLabel: { color: text, fontSize: 14, interval: 0, rotate: results.length > 8 ? 25 : 0 }, axisTick: { show: false }, axisLine: { lineStyle: { color: palette.line } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: text, fontSize: 14 }, splitLine: { lineStyle: { color: palette.line, type: 'dashed' } } },
    series: [
      { name: '维护前', type: 'bar', barMaxWidth: 14, itemStyle: { color: '#367b72', borderRadius: [3, 3, 0, 0] }, data: results.map((r) => r.existingPartitionsBefore?.length ?? null) },
      { name: '维护后', type: 'bar', barMaxWidth: 14, itemStyle: { color: gradient(palette.cyan, palette.mint), borderRadius: [3, 3, 0, 0] }, data: results.map((r) => r.existingPartitionsAfter?.length ?? null) },
    ],
  }
}

export function cacheDonut(cache) {
  if (!cache) return empty('暂无缓存数据')
  const data = [{ name: '待回写', value: cache.fileCount, itemStyle: { color: palette.cyan } }, { name: '坏文件', value: cache.badFileCount, itemStyle: { color: palette.orange } }, { name: '临时文件', value: cache.temporaryFileCount, itemStyle: { color: palette.violet } }]
  if (data.some((d) => typeof d.value !== 'number')) return empty('缓存计数不完整')
  const total = data.reduce((sum, d) => sum + d.value, 0)
  return { ...base, tooltip, title: { text: String(total), subtext: '缓存文件', left: 'center', top: '33%', textStyle: { color: '#FFFFFF', fontSize: 38 }, subtextStyle: { color: text, fontSize: 14 }, itemGap: 5 }, series: [{
    type: 'pie', radius: ['68%', '84%'], center: ['50%', '50%'], label: { show: false }, emptyCircleStyle: { color: palette.line, borderWidth: 0 }, itemStyle: { borderRadius: 4, borderColor: '#111312', borderWidth: 3 }, data: data.filter((d) => d.value > 0),
  }] }
}
