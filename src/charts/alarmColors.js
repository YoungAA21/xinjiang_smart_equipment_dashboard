export const alarmSeverity = event => String(event.severity || event.level || event.riskLevel || '告警')
export const alarmKind = event => String(event.alarmType || event.kind || event.type || event.metricType || '未分类')
export const alarmIdentity = event => JSON.stringify([event.source || (event.moduleId != null ? 'collection' : event.deviceId != null ? 'monitor' : 'event'), String(event.alarmId || event.trendAlarmId || event.eventId || event.id || JSON.stringify([event.moduleId, event.channelId, event.pointCode, event.pointId, event.startedAt]))])
export function alarmRuleKey(scope, event) {
  return JSON.stringify([scope, scope === 'alarm' ? alarmIdentity(event) : scope === 'kind' ? alarmKind(event) : alarmSeverity(event)])
}
export function alarmColorName(event, rules = {}) {
  for (const scope of ['alarm', 'kind', 'severity']) {
    const color = rules[alarmRuleKey(scope, event)]
    if (['yellow', 'red'].includes(color)) return color
  }
  return /critical|fatal|emergency|error|danger|严重|紧急|故障|高危|^alarm$|^报警$/i.test(alarmSeverity(event)) ? 'red' : 'yellow'
}
