import { monitoringLocationOf } from './monitoringLocations.js'

export const homeStatusLabel = label => String(label || '').includes('待确认') ? '' : label

export function homePointTarget(group) {
  const alarmRow = group.rows.find(row => row.alarm)
  const row = alarmRow || group.rows[0]
  const location = alarmRow ? monitoringLocationOf(row.member, row.point) || group.location : group.location
  if (location) {
    return { path: '/device', query: { location, ...(alarmRow ? {
      openPoint: '1', source: row.member.source, device: String(row.member.id),
      pointId: row.point.pointId, channelId: row.point.channelId, pointCode: row.point.pointCode,
    } : {}) } }
  }
  return { path: '/device/detail', query: {
    source: row.member.source, device: String(row.member.id), pointId: row.point.pointId,
    channelId: row.point.channelId, pointCode: row.point.pointCode, tab: 'live',
  } }
}

export function requestedPointRow(rows, query) {
  if (query.openPoint !== '1' || !query.source || !query.device) return null
  return rows.find(row => {
    if (row.member.source !== query.source || String(row.member.id) !== String(query.device)) return false
    if (query.pointId != null && query.pointId !== '') return row.point.pointId != null && String(row.point.pointId) === String(query.pointId)
    return Boolean(query.channelId && query.pointCode)
      && String(row.point.channelId) === String(query.channelId) && row.point.pointCode === query.pointCode
  }) || null
}
