<script setup>
import { computed, ref } from 'vue'
import HomePointCard from './HomePointCard.vue'
import SpectrumPage from '../views/SpectrumPage.vue'
import { acousticPointIp } from '../charts/pointAddress.js'
import { pointKey } from '../charts/telemetry'

const props = defineProps({ device: Object, buffers: Object, now: Number, paused: Boolean, error: String })
const channelId = ref('')
const acousticPanel = ref(null)
const switching = ref(false)
defineExpose({ stopSession: () => acousticPanel.value?.stopSession() })
const colors = ['#39a9ff', '#ff9800', '#00c875']
const status = computed(() => props.device.online === true ? '在线' : props.device.online === false ? '离线' : '状态未知')
async function listen(channel) {
  if (switching.value) return
  switching.value = true
  try {
    await acousticPanel.value?.stopSession()
    channelId.value = channel.channelId
  } finally { switching.value = false }
}
</script>

<template>
  <section class="device-dialog-content" :class="{ 'single-point': device.points.length === 1, 'two-points': device.points.length === 2 }">
    <dl class="dialog-device-facts">
      <div><dt>设备编号</dt><dd>{{ device.id }}</dd></div>
      <div><dt>设备状态</dt><dd>{{ status }}</dd></div>
      <div><dt>设备来源</dt><dd>{{ device.source === 'legacy' ? '采集模块' : '声纹设备' }}</dd></div>
      <div><dt>监测点位</dt><dd>{{ device.points.length }} 个</dd></div>
      <div><dt>{{ device.source === 'legacy' ? '通讯协议' : '采集类型' }}</dt><dd>{{ device.source === 'legacy' ? device.raw.protocol || '—' : '声纹采集' }}</dd></div>
      <div><dt>刷新状态</dt><dd>{{ paused ? '已暂停' : '实时刷新' }}</dd></div>
    </dl>
    <p v-if="error" class="dialog-data-error" role="alert">{{ error }}</p>
    <div v-if="device.source === 'legacy'" class="dialog-point-grid">
      <HomePointCard v-for="(point, index) in device.points" :key="pointKey(point)" :point="point" :source-ip="device.raw.host || ''" :samples="buffers[pointKey(point)] || []" :color="colors[index % colors.length]" :now="now" :paused="paused" />
    </div>
    <template v-else>
      <div class="dialog-channels"><section v-for="channel in device.points" :key="channel.channelId"><h3>{{ channel.name || channel.channelName || channel.channelId }}</h3><p>{{ channel.online === true ? '在线' : channel.online === false ? '离线' : '状态未知' }} · {{ channel.channelId }}</p><p>网关 IP：{{ acousticPointIp(device.raw, channel) }}</p><el-button :disabled="paused || switching || channel.online !== true || device.online === false" @click="listen(channel)">{{ channelId === channel.channelId ? '当前监听' : '监听此点位' }}</el-button></section></div>
      <SpectrumPage show-address v-if="channelId" :key="channelId" ref="acousticPanel" embedded :device="device.raw" :channel-id="channelId" display-mode="live" />
    </template>
    <p v-if="!device.points.length" class="dialog-no-points">暂无数值监测点位</p>
    <RouterLink class="dialog-detail-link" :to="{ path: '/device/detail', query: { source: device.source, device: device.id, tab: 'live' } }">进入完整设备详情 ↗</RouterLink>
  </section>
</template>

<style scoped>
.device-dialog-content { --wall-muted: var(--text-muted); --wall-line: var(--glass-border); --wall-point: var(--glass-card-soft); color: var(--text-main); }
.dialog-device-facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; margin: 0 0 24px; padding: 18px; background: var(--glass-card); border: 1px solid var(--glass-border); border-radius: 8px; }
.dialog-device-facts dt { font-size: 13px; color: var(--text-muted); }
.dialog-device-facts dd { margin: 8px 0 0; font-size: 18px; overflow-wrap: anywhere; }
.dialog-point-grid, .dialog-channels { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.dialog-point-grid :deep(.home-point-chart) { height: 180px; }
.dialog-point-grid :deep(h3) { font-size: 17px; }
.dialog-point-grid :deep(.home-point-value strong) { font-size: 34px; }
.dialog-channels section { padding: 18px; background: var(--glass-card); border: 1px solid var(--glass-border); border-radius: 8px; }
.dialog-channels h3 { margin: 0; font-size: 18px; }
.dialog-channels p, .dialog-no-points { color: var(--text-muted); }
.dialog-channels { margin-bottom: 20px; }
.dialog-data-error { padding: 12px; color: #ff9800; border: 1px solid #ff980044; }
.dialog-detail-link { display: inline-block; padding: 18px 0; color: var(--text-soft); }
@media (max-width: 1100px) { .dialog-point-grid, .dialog-channels { grid-template-columns: repeat(2, minmax(0, 1fr)); } .dialog-device-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 600px) { .dialog-point-grid, .dialog-channels { grid-template-columns: minmax(0, 1fr); } .dialog-device-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.single-point .dialog-point-grid, .single-point .dialog-channels { grid-template-columns: minmax(0, 1fr); }
.two-points .dialog-point-grid, .two-points .dialog-channels { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.single-point .dialog-point-grid :deep(.home-point-chart), .two-points .dialog-point-grid :deep(.home-point-chart) { height: 260px; }
.single-point .dialog-channels section, .two-points .dialog-channels section { padding: 24px; }
@media (max-width: 600px) { .two-points .dialog-point-grid, .two-points .dialog-channels { grid-template-columns: minmax(0, 1fr); } }
</style>
