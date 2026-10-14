import { findDisplayNameRule, ruleKey } from '../services/displayNames.js'
import { monitoringLocations, monitoringLocationOf } from './monitoringLocations.js'

// One configuration row can own several returned measurements (wildcards or shared IPs).
// Match with the same priority used by the actual display helpers.
export function mergeDisplayNameMappings(rules, backendRows) {
  const rows = rules.map(rule => ({ key: `rule:${ruleKey(rule)}`, ...rule, rule, backendRecords: [] }))
  const indexed = new Map(rows.map(row => [ruleKey(row.rule), row]))
  backendRows.forEach((backend, index) => {
    const rule = findDisplayNameRule(backend.kind, backend, rules)
      || findDisplayNameRule('name', {
        source: ['module', 'point'].includes(backend.kind) ? 'legacy' : 'monitor',
        backendName: backend.backendName,
      }, rules)
    if (rule) indexed.get(ruleKey(rule)).backendRecords.push(backend)
    else rows.push({ ...backend, key: `backend:${index}:${ruleKey(backend)}`, rule: null, backendRecords: [backend] })
  })
  return rows
}

export function monitoringCardMappings(rules, backendRows) {
  const locationIds = new Set(monitoringLocations.map(location => location.id))
  const cardPoints = backendRows.filter(row => {
    if (row.kind === 'point') return locationIds.has(monitoringLocationOf({ source: 'legacy', id: row.moduleId }, row.raw))
    if (row.kind === 'channel') return locationIds.has(monitoringLocationOf({ source: 'monitor', raw: row.device }, row.raw))
    return false
  })
  return mergeDisplayNameMappings(rules, cardPoints).filter(row => row.rule && row.backendRecords.length)
}
