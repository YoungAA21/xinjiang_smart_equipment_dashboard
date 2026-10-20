import { numericValue } from './telemetry.js'

export const defaultLineColors = Object.freeze({ normal: '#50c878', alarm: '#f3c45c', damage: '#ff6565' })

export function validateLineColors(value = defaultLineColors) {
  if (!value || typeof value !== 'object' || Object.keys(defaultLineColors).some(key => !/^#[\da-f]{6}$/i.test(value[key]))) throw new Error('图表线条颜色必须是有效的六位十六进制颜色')
  return Object.fromEntries(Object.keys(defaultLineColors).map(key => [key, value[key]]))
}

export function liveLineColor(point, sample, events = [], colors = defaultLineColors, fallback = '#9aaba5') {
  const active = events.some(event => {
    if (!(event.isActive === true || event.status === 'Active') || String(event.moduleId) !== String(point.moduleId)) return false
    if (event.pointId != null) return point.pointId != null && String(event.pointId) === String(point.pointId)
    if (!event.pointCode || event.pointCode !== point.pointCode) return false
    return event.channelId == null || String(event.channelId) === String(point.channelId)
  })
  if (active) return colors.alarm
  const value = numericValue(sample?.value)
  if (value === null) return fallback
  const minimum = numericValue(point.minimumValue)
  const maximum = numericValue(point.maximumValue)
  return (minimum !== null && value < minimum) || (maximum !== null && value > maximum) ? colors.alarm : colors.normal
}
