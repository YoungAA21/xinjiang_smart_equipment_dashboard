import { machines, acousticChannelDisplayName } from './machineGroups.js'
import { readingState } from './productionLine.js'
import { pointKey } from './telemetry.js'
import { monitoringPointName } from './equipmentCatalog.js'
import { monitoringLocations, monitoringLocationOf } from './monitoringLocations.js'

export function acquisitionConnectionStatus(modules, devices, { legacyError = '', monitorError = '' } = {}) {
  const states = [...(modules || []).map(module => module.runtimeStatus?.isOnline), ...(devices || []).map(device => device.online)]
  if (states.some(state => state === false)) return { label: '系统报警', state: 'alarm' }
  if (modules === null || devices === null || legacyError || monitorError || states.some(state => state !== true)) return { label: '连接待确认', state: 'unknown' }
  return states.length ? { label: '系统正常', state: 'normal' } : { label: '暂无采集设备', state: 'unknown' }
}

export function groupedMonitoringPoints(rows) {
  const groups = new Map()
  for (const row of rows) {
    const location = monitoringLocationOf(row.member, row.point)
    const key = location || JSON.stringify([row.member.source, row.member.id])
    if (!groups.has(key)) groups.set(key, { key, location, name: monitoringLocations.find(item => item.id === location)?.name || row.member.name || String(row.member.id), rows: [] })
    groups.get(key).rows.push(row)
  }
  return [...groups.values()].map(group => {
    const alarm = group.rows.some(row => row.alarm)
    const normal = group.rows.every(row => row.normal)
    return { ...group, state: alarm ? 'alarm' : normal ? 'normal' : 'unknown', label: alarm ? '报警' : normal ? '正常' : '待确认' }
  })
}

export const isActiveAlarm = event => event.isActive === true || event.status === 'Active'
export function alarmMachineId(event) {
  const id = machines.find(machine => machine.modules.includes(event.moduleId))?.id
  return id === 'ZB25' ? 'YB25' : id || null
}
export function alarmMatchesRow(event, row) {
  if (row.member.source !== 'legacy' || event.moduleId !== row.member.id) return false
  if (event.pointId != null) return row.point.pointId != null && String(event.pointId) === String(row.point.pointId)
  if (event.pointCode && event.pointCode !== row.point.pointCode) return false
  if (event.channelId && String(event.channelId) !== String(row.point.channelId)) return false
  return true
}
export function machineReadings(machine, { latest = [], events = [], now, sourceErrors = {}, pointErrors = {}, alarmsReady = false }) {
  return machine.members.flatMap(member => member.points.map(point => {
    const row = { member, point, key: member.source === 'legacy' ? pointKey(point) : JSON.stringify(['monitor', member.id, point.channelId]) }
    const alarm = events.some(event => isActiveAlarm(event) && alarmMatchesRow(event, row))
    const reading = member.source === 'legacy'
      ? readingState(point, latest, now, Boolean(sourceErrors.legacy || pointErrors[member.id]), member.online)
      : { value: null, usable: !sourceErrors.monitor && member.online === true && point.online === true, label: point.online === false ? '离线' : '状态待确认' }
    return { ...row, ...reading, alarm, normal: reading.usable && !alarm && alarmsReady,
      name: member.source === 'legacy' ? monitoringPointName(point) : acousticChannelDisplayName(member.raw, point),
      label: alarm ? '报警' : !reading.usable ? reading.label : member.source === 'monitor' ? '在线' : alarmsReady ? '正常' : '状态待确认',
    }
  }))
}

export function machineHealth(machine, rows, alarmsReady) {
  if (machine.activeAlarms.length) return { health: 'alarm', healthLabel: '报警', alarmCount: machine.activeAlarms.length }
  if (!machine.sourceId) return { health: 'unknown', healthLabel: '未配置', alarmCount: 0 }
  const normal = alarmsReady && machine.state === 'online' && rows.length > 0 && rows.every(row => row.normal)
  return { health: normal ? 'normal' : 'unknown', healthLabel: normal ? '正常' : machine.state === 'offline' ? '离线' : '待确认', alarmCount: 0 }
}
