// Synthetic fixtures only. Dates follow the requested range and the local clock.
const list = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))
const iso = (time = Date.now()) => new Date(time).toISOString()
const round = (v) => Number(v.toFixed(3))
const dayMs = 86400000
const names = ['主通风机', '循环水泵', '空气压缩机', '引风机', '给水泵', '冷却风机', '输送电机', '备用水泵']
export const modules = names.map((name, i) => ({ moduleId: `M${String(i + 1).padStart(2, '0')}`, moduleName: `${name}采集模块`, protocol: 'ModbusTcp', enabled: true, channelCount: 4, pointCount: 4, runtimeStatus: { isOnline: i !== 7, offlineReason: i === 7 ? '备用设备停机检修' : '' } }))
export const points = modules.flatMap((m, i) => ['轴承振动', '轴承温度', '出口压力', '电机电流'].map((name, j) => ({ pointId: i * 4 + j + 1, moduleId: m.moduleId, channelId: `CH${j + 1}`, pointCode: ['VIB_RMS', 'TEMP', 'PRESSURE', 'CURRENT'][j], name, unit: ['mm/s', '℃', 'MPa', 'A'][j], minimumValue: [0, 20, 0.2, 0][j], maximumValue: [4.5, 80, 1.2, 120][j], base: [2.6, 56, 0.72, 76][j] + (j === 2 ? i * .01 : i * .12) })))
const point = (id) => points.find(p => p.pointId === Number(id)) || points[0]
const value = (p, t) => round(p.base * (1 + .045 * Math.sin(t / 11000 + p.pointId) + .018 * Math.sin(t / 2700)))
const sample = (p, t) => ({ ...p, value: value(p, t), quality: 'Good', collectedAt: iso(t) })
export function collectors(now = Date.now()) {
  return list(4, i => ({ collectorId: `GW${i + 1}`, name: `${names[i]}声纹网关`, ip: `192.168.10.${101 + i}`, audioPort: 9000, runtime: { collectorId: `GW${i + 1}`, connected: true, state: 'online', driver: 'AcousticTcp', transportMode: 'TCP', sampleFormat: 'pcm_s16le', configuredSampleRate: 22000, effectiveSampleRate: 22000, channelCount: 2, bytesReceived: 1284505600 + i * 100000000, samplesReceived: 642252800 + i * 50000000, recordingQueueDepth: 0, recordingsSaved: 286 + i * 34, bufferedSamples: 2200, startedAt: iso(now - 7 * dayMs), connectedAt: iso(now - 7 * dayMs + 4000), lastDataAt: iso(now - 100), updatedAt: iso(now), lastError: '' } }))
}
export function devices(now) {
  return collectors(now).map((c, i) => ({ deviceId: `DEV${i + 1}`, deviceName: `${names[i]} ${String(i + 1).padStart(2, '0')}#`, online: true, collectors: [c], channels: list(2, j => ({ channelId: `MIC${j + 1}`, channelName: j ? '非驱动端声纹' : '驱动端声纹', collectorId: c.collectorId, online: true, enabled: true, sampleRate: 22000 })) }))
}
function tables(now) {
  const date = new Date(now)
  const partitions = list(4, i => { const d = new Date(date.getFullYear(), date.getMonth() + i, 1); return `p${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` })
  return modules.map(m => ({ moduleId: m.moduleId, tableName: `telemetry_${m.moduleId.toLowerCase()}`, exists: true, hasPmax: true, expectedPartitions: partitions, missingPartitions: [], existingPartitions: [...partitions, 'pmax'], existingPartitionsBefore: [...partitions.slice(0, 3), 'pmax'], existingPartitionsAfter: [...partitions, 'pmax'], success: true, createdPartitions: [partitions[3]], droppedPartitions: [] }))
}
function health(now) {
  const t = tables(now)
  return { status: 'Healthy', generatedAt: iso(now), database: { isHealthy: true, message: '数据库连接正常' }, collectorModuleTable: { exists: true, rowCount: modules.length }, moduleChannelPointTable: { exists: true, activePointCount: points.length, expectedPointCount: points.length }, runtimeModules: { enabledModbusCount: 8, enabledAcousticCount: 0, statusCount: 8, statuses: modules.map(m => ({ moduleId: m.moduleId, protocol: m.protocol, ...m.runtimeStatus, lastUpdatedAt: iso(now) })) }, checks: ['database.connection', 'database.collector_module', 'database.points', ...modules.map(m => `database.module_table.${m.moduleId}`), ...modules.map(m => `database.aggregation_table.${m.moduleId}`), 'config.modules', 'config.points', 'offline_cache.directory', 'pipeline.persistence', 'pipeline.analysis', 'runtime.modules'].map(name => ({ name, status: 'Healthy', message: '检查通过' })), moduleTables: t, aggregationTables: t.map(r => ({ ...r, tableName: `${r.tableName}_aggregate` })), offlineCache: { directory: './offline-cache', fileCount: 3, badFileCount: 0, temporaryFileCount: 1, totalBytes: 248320, oldestFileCreatedAt: iso(now - 4000), runtimeStatus: { isRunning: true } }, queues: { persistencePending: 12, analysisPending: 4 }, configFiles: ['modules.json', 'points.json', 'appsettings.json'].map(file => ({ file, path: `./config/${file}`, exists: true })) }
}
function events(now, trend = false) {
  return points.flatMap(p => list(8, i => ({ alarmId: `${trend ? 'TR' : 'AL'}-${p.pointId}-${i + 1}`, trendAlarmId: `TR-${p.pointId}-${i + 1}`, ...p, startedAt: iso(now - (i * 13 + 1) * 3600000), recoveredAt: i === 0 ? null : iso(now - (i * 13 + .6) * 3600000), status: i === 0 ? 'Active' : 'Recovered', alarmValue: round(p.maximumValue * (1.02 + i * .012)), recoveryValue: i === 0 ? null : p.base, thresholdMin: p.minimumValue, thresholdMax: p.maximumValue, durationSeconds: i === 0 ? 3600 : 1440, quality: 'Good', metricType: p.pointCode, createdAt: iso(now - (i * 13 + 1) * 3600000), updatedAt: iso(now), riskLevel: i % 3 === 0 ? 'Warning' : 'Watch', changeRate: round(.15 + i * .018), baselineAverageValue: p.base, recentAverageValue: round(p.base * 1.2), reason: trend ? `${p.name}近期均值持续升高，建议检查运行负荷及润滑状态` : `${p.name}超过设定上限，建议现场复核` })))
}
const between = (time, start, end) => (!start || Date.parse(time) >= Date.parse(start)) && (!end || Date.parse(time) <= Date.parse(end))
const page = (rows, q) => { const currentPage = Math.max(1, Number(q.currentPage || q.page || 1)); const pageSize = Math.max(1, Number(q.pageSize || 20)); return { row: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize), total: rows.length, currentPage, pageSize } }
function daily(q) {
  const p = point(q.pointId), start = Date.parse(q.start), end = Date.parse(q.end)
  const n = Math.min(Number(q.limit || 366), Math.ceil((end - start) / dayMs))
  return list(Math.max(0, n), i => {
    const avg = round(p.base * (1 + .035 * Math.sin(i * .55) + i * .004))
    const high = i % 9 === 7
    return { date: iso(start + i * dayMs).slice(0, 10), minValue: round(avg * .82), averageValue: avg, maxValue: high ? round(p.maximumValue * 1.07) : round(avg * 1.23), minimumValue: p.minimumValue, maximumValue: p.maximumValue, sampleCount: 43200, belowLimitBucketCount: 0, aboveLimitBucketCount: high ? 3 : 0, belowLimitMinutes: 0, aboveLimitMinutes: high ? 15 : 0, limitStatus: high ? 'AboveLimit' : 'Normal' }
  })
}
function recordings(now) {
  return list(48, i => { const d = devices(now)[i % 4]; return { id: `REC${i + 1}`, deviceId: d.deviceId, deviceName: d.deviceName, channelId: 'MIC1', channelName: '驱动端声纹', collectorId: `GW${i % 4 + 1}`, fileName: `${d.deviceName}_声纹_${String(i + 1).padStart(3, '0')}.wav`, kind: i % 3 ? 'normal' : 'alarm', durationMs: 10000, sizeBytes: 440044, sampleRate: 22000, channelCount: 1, sampleFormat: 'pcm_s16le', createdAt: iso(now - i * 1800000), startTime: iso(now - i * 1800000 - 10000), endTime: iso(now - i * 1800000), codec: 'WAV', bitDepth: 16, channels: 1, gatherDeviceId: `GW${i % 4 + 1}`, startedAt: iso(now - i * 1800000 - 10000), endedAt: iso(now - i * 1800000), checksum: 'demo-synthetic-audio', format: 'wav' } })
}
export function signalFrame(phase = 0, q = {}) {
  const waveform = list(Math.min(1600, Number(q.waveformPoints || 1000)), i => round(.32 * Math.sin(i * .31 + phase) * (1 + .3 * Math.sin(i * .017)) + .1 * Math.sin(i * 1.17)))
  const spectrum = list(Math.min(256, Number(q.frequencyBins || 128)), i => round(-78 + 53 * Math.exp(-(((i - 14) / 3) ** 2)) + 38 * Math.exp(-(((i - 37) / 5) ** 2)) + 20 * Math.exp(-(((i - 68) / 4) ** 2)) + 4 * Math.sin(i * 1.3 + phase)))
  return { timestamp: iso(), sampleRate: 22000, startMs: Number(q.startMs || 0), endMs: Number(q.endMs || 10000), waveform, waveformEnvelope: waveform.map(v => [round(v - .08), round(v + .08)]), spectrum, waterfallRow: spectrum.map(v => v + 90), waterfall: list(Math.min(100, Number(q.waterfallRows || 60)), y => spectrum.map((v, x) => round(v + 3 * Math.sin(y * .27 + x * .11)))) }
}
export function demoResponse(path, q = {}, now = Date.now()) {
  if (path === '/auth/login') return { token: 'offline-demo', userInfo: { username: '演示管理员' } }
  if (path === '/api/health') return { status: 'ok', service: 'WorkshopConditionMonitor', time: iso(now) }
  if (path === '/api/health/detail') return health(now)
  if (path === '/api/health/table-maintenance') return { options: { futurePartitionMonths: 3, dataRetentionMonths: 12, checkIntervalHours: 24 }, runtimeStatus: { lastStartedAt: iso(now - 3600000), lastSucceededAt: iso(now - 3596000), lastModuleCount: 8, lastResults: tables(now) } }
  if (path === '/api/configuration/modules') return { generatedAt: iso(now), modules }
  if (/^\/api\/configuration\/modules\/[^/]+\/points$/.test(path)) { const moduleId = decodeURIComponent(path.split('/')[4]); return { moduleId, points: points.filter(p => p.moduleId === moduleId) } }
  // A ready-to-view rolling demo window avoids waiting several minutes for screenshots.
  if (path === '/api/realtime/latest') return points.flatMap(p => list(120, i => sample(p, Math.floor(now / 2000) * 2000 - i * 2000)))
  if (path === '/api/telemetry/history') { const start = Date.parse(q.start), end = Date.parse(q.end), p = point(q.pointId); return { pointId: p.pointId, points: list(Math.min(Number(q.limit || 5000), Math.ceil((end - start) / 2000)), i => sample(p, start + i * 2000)) } }
  if (path === '/api/analysis/daily-limit-trends') return { days: daily(q) }
  if (path === '/api/analysis/trend-insights') { const p = point(q.pointId); return { insight: { unit: p.unit, riskLevel: 'Watch', recentAverageValue: round(p.base * 1.12), baselineAverageValue: p.base, changeRate: .12, trendSlopePerDay: round(p.base * .004), p95Value: round(p.base * 1.18), p99Value: round(p.base * 1.26), standardDeviation: round(p.base * .043) } } }
  if (['/api/analysis/alarms', '/api/analysis/trend-alarms'].includes(path)) return { generatedAt: iso(now), events: events(now, path.endsWith('trend-alarms')).filter(e => (!q.pointId || e.pointId === Number(q.pointId)) && (q.isActive === undefined || (e.status === 'Active') === (String(q.isActive) === 'true')) && between(e.startedAt, q.start, q.end)).slice(0, Number(q.limit || 200)) }
  if (path === '/api/analysis/status') return { generatedAt: iso(now), analysisPending: 4, runtimeStatus: { totalAnalyzedCount: 1382400, totalAlarmCount: 256, totalRecoveryCount: 224, activeAlarms: [] } }
  if (path === '/monitor/devices') return devices(now)
  if (path === '/monitor/sessions') {
    const device = devices(now).find(d => d.deviceId === q.deviceId)
    const channelId = q.channelIds?.[0]
    if (!device || !device.channels.some(c => c.channelId === channelId && c.online)) throw new Error('请选择在线的声纹设备和点位')
    const sessionId = 'demo-'+encodeURIComponent(device.deviceId)+'-'+encodeURIComponent(channelId)
    return { sessionId, websocketPath: '/monitor/ws/'+sessionId, audioStreamUrl: '/monitor/audio/'+sessionId }
  }
  if (path.startsWith('/monitor/sessions/')) return { closed: true }
  if (path === '/collectorManagement/status') return collectors(now)
  if (path === '/collectorManagement/status-history') return collectors(now).map(c => ({ ...c, current: c.runtime, availabilityPercent: 99.98, onlineSeconds: Number(q.hours || 168) * 3600 - 120, periodStart: iso(now - Number(q.hours || 168) * 3600000), periodEnd: iso(now), events: list(4, i => ({ eventAt: iso(now - i * 3600000) })) }))
  if (path === '/collectorManagement/status-events') { const rows = list(32, i => ({ collectorId: `GW${i % 4 + 1}`, state: 'online', connected: true, eventType: i % 3 ? 'transition' : 'recovery', eventAt: iso(now - i * 3600000), message: i % 3 ? '网关连接正常，采样数据持续接收' : '通讯恢复，数据同步完成' })); return page(rows.filter(r => (!q.collectorId || q.collectorId === r.collectorId) && (!q.state || q.state === r.state) && (!q.eventType || q.eventType === r.eventType) && (!q.connected || q.connected === String(r.connected)) && (!q.keyword || r.message.includes(q.keyword)) && Date.parse(r.eventAt) >= now - Number(q.hours || 168) * 3600000), q) }
  if (/^\/collectorManagement\/[^/]+\/status$/.test(path)) return collectors(now).find(c => c.collectorId === path.split('/')[2])?.runtime
  if (path === '/recordings') return page(recordings(now).filter(r => (!q.deviceId || q.deviceId === r.deviceId) && (!q.channelId || q.channelId === r.channelId) && (!q.kind || q.kind === r.kind) && (!q.fileName || r.fileName.includes(q.fileName)) && between(r.createdAt, q.startTime, q.endTime)), q)
  if (/^\/recordings\/[^/]+\/visualization$/.test(path)) return signalFrame(0, q)
  if (/^\/recordings\/[^/]+$/.test(path)) return recordings(now).find(r => r.id === path.split('/')[2])
  if (path === '/alarm/page') return page(list(36, i => ({ id: `AC${i + 1}`, deviceName: devices(now)[i % 4].deviceName, deviceId: `DEV${i % 4 + 1}`, channelId: 'MIC1', channelName: '驱动端声纹', type: ['轴承异响', '机械摩擦', '运行噪声偏高'][i % 3], status: i % 4 === 0 ? '1' : '0', alarmTime: iso(now - i * 3600000), createdAt: iso(now - i * 3600000), description: '声纹特征偏离基线，建议检查设备' })).filter(r => (!q.status || q.status === r.status) && between(r.alarmTime, q.beginTime, q.endTime)), q)
  if (path === '/alarm/audioFiles') return page(recordings(now).slice(0, 3), q)
  if (path.startsWith('/alarm/audioFileSampleTypes/')) return ['轴承异响', '机械摩擦']
  if (path === '/alarm/chatByDay') return list(7, i => ({ day: iso(now - (6 - i) * dayMs).slice(0, 10), count: [3, 5, 2, 8, 4, 6, 3][i] }))
  throw new Error(`演示模式尚未提供接口：${path}`)
}

