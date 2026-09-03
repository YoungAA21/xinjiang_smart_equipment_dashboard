const onlineState = (value) => typeof value === 'boolean' ? value : null
const newestTime = (values) => values.filter((value) => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null

// There is no cross-service identity mapping. A module and a device are separate
// records even if their IDs/names happen to match. Never coerce 64-bit IDs to Number.
export function mergeHomeDevices(legacy = [], monitor = []) {
  return [
    ...legacy.map((module) => ({
      key: JSON.stringify(['legacy', module.protocol || '', String(module.moduleId)]),
      source: 'legacy', sourceLabel: '采集模块', id: String(module.moduleId), name: module.moduleId,
      kind: '采集模块', protocol: module.protocol, isOnline: onlineState(module.isOnline),
      offlineReason: module.offlineReason || '', updatedAt: module.lastUpdatedAt,
      updatedAtLabel: '模块更新',
    })),
    ...monitor.map((device) => ({
      key: JSON.stringify(['monitor', String(device.deviceId)]),
      source: 'monitor', sourceLabel: '声纹设备', id: String(device.deviceId), name: device.deviceName || String(device.deviceId),
      kind: '声纹设备', isOnline: onlineState(device.online),
      // Device online is authoritative; a connecting collector does not make
      // the whole device offline. Show child connectivity separately.
      offlineReason: device.offlineReason || '',
      updatedAt: newestTime((Array.isArray(device.collectors) ? device.collectors : []).map((collector) => collector?.runtime?.updatedAt)),
      updatedAtLabel: '网关最近更新',
      collectorCount: Array.isArray(device.collectors) ? device.collectors.length : null,
      connectedCollectors: Array.isArray(device.collectors) ? device.collectors.filter((c) => c?.runtime?.connected === true).length : null,
      channelCount: Array.isArray(device.channels) ? device.channels.length : null,
      onlineChannels: Array.isArray(device.channels) ? device.channels.filter((c) => c?.online === true).length : null,
    })),
  ]
}

export function deviceSourceSummary({ legacyLoaded, monitorLoaded, legacyError, monitorError }) {
  if (!legacyLoaded || !monitorLoaded) return '部分来源未返回，当前为已获取数量'
  if (legacyError || monitorError) return '含上次成功数据，请留意来源更新时间'
  return '按业务类型独立计数，不跨系统去重'
}
