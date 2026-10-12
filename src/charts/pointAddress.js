export function acousticPointIp(device, channel) {
  const collectors = device?.collectors || []
  if (channel?.collectorId != null) {
    return collectors.find(collector => collector.collectorId === channel.collectorId)?.ip || '未提供'
  }
  return collectors.length === 1 ? collectors[0].ip || '未提供' : '未提供'
}
