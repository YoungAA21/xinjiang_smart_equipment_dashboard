import { monitoringLocationOf } from './monitoringLocations.js'
import { acousticChannelDisplayName } from './machineGroups.js'

export function listeningChannels(devices, locations) {
  return devices.flatMap(device => (device.channels || []).flatMap(channel => {
    if (channel.channelId == null || String(channel.channelId) === '') return []
    const locationId = monitoringLocationOf({ source: 'monitor', id: device.deviceId, raw: device }, channel)
    if (!locations.some(location => location.id === locationId)) return []
    const collectors = device.collectors || []
    const collector = channel.collectorId != null
      ? collectors.find(item => String(item.collectorId) === String(channel.collectorId))
      : collectors.length === 1 ? collectors[0] : null
    const connected = collector?.runtime?.connected
    const online = connected === false || device.online === false || channel.online === false ? false
      : connected === true || (device.online === true && channel.online === true) ? true : null
    return [{ key: JSON.stringify([String(device.deviceId), String(channel.channelId)]), locationId,
      deviceId: device.deviceId, channelId: channel.channelId, name: acousticChannelDisplayName(device, channel),
      deviceName: device.deviceName || String(device.deviceId), online,
      sampleRate: Number(collector?.runtime?.effectiveSampleRate || collector?.sampleRate) || 0 }]
  }))
}

export const emptyListeningSignal = () => ({ waveform: [], spectrum: [], waterfall: [], durations: [], sampleRate: 0, sequence: null, peakDb: null })

export function appendListeningSignal(previous, frame) {
  const sampleRate = Number(frame.sampleRate)
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384000) throw new Error('实时信号采样率无效')
  const incoming = Array.isArray(frame.waveform) ? frame.waveform.map(Number) : []
  if (incoming.length > sampleRate * 10 || incoming.some(value => !Number.isFinite(value))) throw new Error('实时时域数据无效')
  const sequence = Number.isSafeInteger(frame.sequence) ? frame.sequence : null
  const discontinuity = previous.sampleRate !== sampleRate
    || (sequence !== null && previous.sequence !== null && sequence !== previous.sequence + 1)
  const before = discontinuity ? emptyListeningSignal() : previous
  const waveform = [...before.waveform, ...incoming].slice(-sampleRate * 10)
  const row = Array.isArray(frame.waterfallRow) ? frame.waterfallRow.slice(0, 4096).map(Number) : []
  if (row.some(value => !Number.isFinite(value))) throw new Error('实时频谱数据无效')
  const waterfall = [...before.waterfall], durations = [...before.durations]
  if (row.length && incoming.length) { waterfall.push(row); durations.push(incoming.length / sampleRate) }
  let duration = durations.reduce((sum, value) => sum + value, 0)
  while (durations.length > 1 && (duration - durations[0] >= 10 || durations.length > 300)) {
    duration -= durations.shift()
    waterfall.shift()
  }
  return { waveform, waterfall, durations, sampleRate, sequence,
    spectrum: Array.isArray(frame.spectrum) ? frame.spectrum.slice(0, 4096) : [],
    peakDb: frame.metrics?.peak != null && Number.isFinite(Number(frame.metrics.peak)) ? Number(frame.metrics.peak) : null }
}

export function listeningEnvelope(waveform, bins = 1400) {
  const size = Math.min(bins, waveform.length)
  return Array.from({ length: size }, (_, index) => {
    let minimum = Infinity, maximum = -Infinity
    const end = Math.floor((index + 1) * waveform.length / size)
    for (let i = Math.floor(index * waveform.length / size); i < end; i++) {
      minimum = Math.min(minimum, waveform[i])
      maximum = Math.max(maximum, waveform[i])
    }
    return [minimum, maximum]
  })
}
