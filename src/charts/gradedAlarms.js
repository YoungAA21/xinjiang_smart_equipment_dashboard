import { alarmValue } from './alarms.js'

export const isGradedAlarm = event => event?.alarmKey === 'GradedLimit'
export function collectionAlarmKind(event) {
  if (isGradedAlarm(event)) return 'graded'
  if (String(event?.alarmKey || '').startsWith('Composite:')) return 'composite'
  return event?.alarmKey == null || event.alarmKey === '' ? 'limit' : 'other'
}
export const collectionAlarmType = event => ({ graded: '分级报警', composite: '组合报警', limit: '上下限告警', other: '其他报警' }[collectionAlarmKind(event)])
export const gradedSeverity = event => isGradedAlarm(event) && ['number', 'string'].includes(typeof event.severity)
  && [1, 2, 3].includes(Number(event.severity)) ? Number(event.severity) : null
export function alarmLevelText(event) {
  if (isGradedAlarm(event)) return String(event.levelName || '').trim() || ({ 1: '损坏', 2: '告警', 3: '提示' }[gradedSeverity(event)] ?? '未知等级')
  return String(event?.levelName || event?.severity || event?.level || event?.riskLevel || (collectionAlarmKind(event) === 'limit' ? '上下限告警' : '未分级'))
}
export const alarmDirectionText = event => isGradedAlarm(event) ? ({ Upper: '上限', Lower: '下限' }[event.alarmDirection] || '—') : '—'
export const gradedDefaultColor = event => ({ 1: 'red', 2: 'orange', 3: 'yellow' }[gradedSeverity(event)] || null)
export function alarmTriggerValue(event) {
  if (!isGradedAlarm(event)) return null
  return event.triggerThreshold ?? (event.alarmDirection === 'Upper' ? event.thresholdMax : event.alarmDirection === 'Lower' ? event.thresholdMin : null)
}
export function alarmThresholdText(event) {
  if (isGradedAlarm(event)) {
    const value = alarmValue(alarmTriggerValue(event), event.unit)
    if (value === '—') return value
    return `${({ Upper: '≥ ', Lower: '≤ ' }[event.alarmDirection] || '')}${value}`
  }
  if (collectionAlarmKind(event) === 'composite') return '—'
  const bounds = []
  if (Number.isFinite(event?.thresholdMin)) bounds.push(`< ${alarmValue(event.thresholdMin, event.unit)}`)
  if (Number.isFinite(event?.thresholdMax)) bounds.push(`> ${alarmValue(event.thresholdMax, event.unit)}`)
  return bounds.join(' / ') || alarmValue(event?.threshold ?? event?.thresholdValue, event?.unit)
}
export function filterCollectionAlarms(events, { kind = '', severity = '', direction = '' } = {}) {
  const matchesLevel = event => !severity
    || (severity === 'limit' ? collectionAlarmKind(event) === 'limit'
      : severity === 'other' ? gradedSeverity(event) === null && collectionAlarmKind(event) !== 'limit'
      : severity === 'ungraded' ? gradedSeverity(event) === null : gradedSeverity(event) === Number(severity))
  return (events || []).filter(event => (!kind || collectionAlarmKind(event) === kind)
    && matchesLevel(event)
    && (!direction || isGradedAlarm(event) && event.alarmDirection === direction))
}
export function gradedAlarmCounts(events) {
  const counts = { 1: 0, 2: 0, 3: 0 }
  for (const event of events || []) if (event.status === 'Active' && gradedSeverity(event)) counts[gradedSeverity(event)]++
  return counts
}
export function compareAlarmPriority(first, second) {
  return (gradedSeverity(first) ?? 4) - (gradedSeverity(second) ?? 4)
    || (Date.parse(second.startedAt) || 0) - (Date.parse(first.startedAt) || 0)
}
