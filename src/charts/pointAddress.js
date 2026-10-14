export function acousticPointIp(device, channel) {
  const collectors = device?.collectors || []
  const collector = channel?.collectorId != null
    ? collectors.find(item => String(item.collectorId) === String(channel.collectorId))
    : collectors.length === 1 ? collectors[0] : null
  const channelText = `${channel?.channelId || ''} ${channel?.channelName || ''} ${channel?.name || ''}`
  return collector?.ip
    || channelText.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0]
    || device?.ip
    || '未提供'
}

export function acousticDisplayContext(device, channel) {
  const collectors = device?.collectors || []
  const collector = collectors.find(item => channel?.collectorId != null && String(item.collectorId) === String(channel.collectorId))
    || (collectors.length === 1 ? collectors[0] : null)
  const text = `${channel?.channelId || ''} ${channel?.channelName || ''} ${channel?.name || ''}`
  const ip = collector?.ip || text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || device?.ip || ''
  const channelNumber = Number(text.match(/(\d+)\s*ch(?:annel)?(?:[-_\s]|$)/i)?.[1]
    || text.match(/(?:^|[^a-z0-9])ch(?:annel)?[-_ ]?(\d+)(?:$|[^0-9])/i)?.[1]
    || text.match(/通道\s*(\d+)/)?.[1]
    || text.match(/^(\d+)$/)?.[1])
  return { ip, channelNumber }
}
