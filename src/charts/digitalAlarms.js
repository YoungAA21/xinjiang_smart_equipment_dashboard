import { pointKey } from './telemetry.js'

export const digitalModules = ['PRESS01', 'PRESS02', 'PRESS03']
const signalNames = {
  PRESS02_DI01: '卷烟机高低速转换',
  PRESS03_DI01: 'CH 双包剔除信号',
  PRESS03_DI02: 'CH 补包器信号',
  PRESS01_DI02: '小包外观剔除按钮',
}
const hosts = { PRESS01: '192.168.3.104', PRESS02: '192.168.3.106', PRESS03: '192.168.3.103' }
export const digitalSignalName = point => signalNames[point.pointCode] || `${point.moduleId} ${point.channelId?.split('-').at(-1) || point.pointCode} 信号`
export const isDigitalSignal = point => point?.metricType === 'DigitalInput'
  && digitalModules.includes(point.moduleId)
  && new RegExp(`^${point.moduleId}-DI0[12]$`).test(point.channelId)
  && point.pointCode === `${point.moduleId}_${point.channelId.split('-').at(-1)}`

export function updateDigitalAlarms(snapshot, samples, metadata = {}, now = new Date().toISOString()) {
  const events = (snapshot.events || []).map(row => ({ ...row }))
  const states = { ...snapshot.states }
  const triggered = []
  let changed = false
  const ordered = samples.filter(isDigitalSignal).sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt))
  for (const sample of ordered) {
    if (![0, 1].includes(sample.value) || !Number.isFinite(Date.parse(sample.collectedAt)) || (sample.quality && sample.quality !== 'Good')) continue
    const key = pointKey(sample)
    const previous = states[key]
    if (previous && Date.parse(sample.collectedAt) <= Date.parse(previous.collectedAt)) continue
    const point = metadata[key] || {}
    let activeId = previous?.activeId
    if (sample.value === 1 && previous?.value !== 1) {
      activeId = `di:${key}:${sample.collectedAt}`
      const row = {
        alarmId: activeId, source: 'digital-local', pointId: point.pointId ?? null,
        moduleId: sample.moduleId, channelId: sample.channelId, pointCode: sample.pointCode,
        host: point.host || hosts[sample.moduleId], name: digitalSignalName(sample),
        metricType: 'DigitalInput', status: 'Active', isActive: true,
        alarmValue: 1, recoveryValue: null, unit: '', quality: sample.quality,
        startedAt: sample.collectedAt, endedAt: null, createdAt: now, updatedAt: now, acknowledgedAt: null,
        reason: `${digitalSignalName(sample)}：DI 信号为 1`,
      }
      events.push(row)
      triggered.push(activeId)
    } else if (sample.value === 0 && previous?.value === 1) {
      const row = events.find(item => item.alarmId === activeId)
      if (row) Object.assign(row, { status: 'Recovered', isActive: false, recoveryValue: 0, endedAt: sample.collectedAt, updatedAt: now, durationSeconds: Math.max(0, (Date.parse(sample.collectedAt) - Date.parse(row.startedAt)) / 1000) })
      activeId = null
    }
    states[key] = { value: sample.value, collectedAt: sample.collectedAt, activeId }
    changed = true
  }
  // Retain active incidents and the most recent 1000 recovered incidents.
  const active = events.filter(row => row.isActive)
  const recovered = events.filter(row => !row.isActive).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, 1000)
  return { events: [...active, ...recovered], states, triggered, changed }
}

export function filterDigitalAlarms(events, filters = {}) {
  return events.filter(row => {
    if (filters.moduleId && row.moduleId !== filters.moduleId) return false
    if (filters.pointId !== undefined && filters.pointId !== '' && String(row.pointId) !== String(filters.pointId)
      && !(row.pointId == null && filters.pointCode && row.pointCode === filters.pointCode)) return false
    if (filters.pointCode && row.pointCode !== filters.pointCode) return false
    if ([true, 'true'].includes(filters.isActive) && !row.isActive) return false
    if ([false, 'false'].includes(filters.isActive) && row.isActive) return false
    if (filters.start && Date.parse(row.startedAt) < Date.parse(filters.start)) return false
    if (filters.end && Date.parse(row.startedAt) > Date.parse(filters.end)) return false
    return true
  })
}
