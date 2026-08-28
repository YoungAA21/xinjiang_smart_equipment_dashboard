export const alarmCell = (row, keys, fallback = '—') => {
  const key = keys.find((key) => row?.[key] !== undefined && row[key] !== null && row[key] !== '')
  return key ? row[key] : fallback
}
export const legacyAlarmStatus = (value) => value === 'Active' ? '当前告警' : value === 'Recovered' ? '已恢复' : value ?? '未知'
export const externalAlarmStatus = (value) => {
  if ([true, '1', 1, 'active'].includes(value)) return '未处理'
  if ([false, '0', 0, 'closed'].includes(value)) return '已处理'
  return value || '—'
}
export const alarmTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : String(value)
}
export const alarmValue = (value, unit = '') => typeof value === 'number' && Number.isFinite(value) ? `${value} ${unit}`.trim() : '—'

// Only merge fetched snapshots: the 5158 limit and 18080 server page are not a global total.
export function mergeAlarmSnapshots(legacy = [], external = []) {
  const rows = [
    ...legacy.map((raw, index) => ({ key: JSON.stringify(['5158', String(raw.alarmId ?? index), index]), source: '5158', id: String(raw.alarmId ?? '—'), time: raw.startedAt, device: raw.moduleId, point: [raw.channelId, raw.pointCode].filter(Boolean).join(' / '), status: legacyAlarmStatus(raw.status), reason: raw.reason || '—', raw })),
    ...external.map((raw, index) => ({ key: JSON.stringify(['18080', String(alarmCell(raw, ['id', 'alarmId', 'eventId'], index)), index]), source: '18080', id: String(alarmCell(raw, ['id', 'alarmId', 'eventId'])), time: alarmCell(raw, ['alarmAt', 'startedAt', 'createdAt', 'time'], ''), device: alarmCell(raw, ['deviceName', 'deviceId', 'moduleId']), point: alarmCell(raw, ['channelName', 'channelId']), status: externalAlarmStatus(raw.status), reason: alarmCell(raw, ['type', 'alarmType', 'metricType', 'pointCode']), raw })),
  ]
  return rows.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
}
