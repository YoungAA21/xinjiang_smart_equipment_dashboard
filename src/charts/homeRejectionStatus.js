import { readingState } from './productionLine.js'

export function appearanceRejectionStatus(samples = [], { now = Date.now(), error = '' } = {}) {
  const sample = samples.filter(row => row.moduleId === 'PRESS01'
    && row.channelId === 'PRESS01-DI02' && row.pointCode === 'PRESS01_DI02'
    && (row.pointId == null || Number(row.pointId) === 74))
    .sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt))[0]
  if (error || !sample || !readingState(sample, [sample], now).usable) return { label: '未知', state: 'unknown' }
  if (sample.value === 0) return { label: '开启', state: 'normal' }
  if (sample.value === 1) return { label: '关闭', state: 'alarm' }
  return { label: '未知', state: 'unknown' }
}
