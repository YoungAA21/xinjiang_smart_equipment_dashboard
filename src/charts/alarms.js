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
