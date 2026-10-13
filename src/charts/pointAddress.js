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
