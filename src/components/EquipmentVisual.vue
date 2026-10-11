<script setup>
import { computed, ref } from 'vue'
import { Fan, Server } from 'lucide-vue-next'
const props = defineProps({ name: String, source: String, deviceId: String, online: { default: undefined }, paused: Boolean })
const active = computed(() => props.online === true && !props.paused)
const isFan = computed(() => /风机|通风|引风/.test(props.name || ''))
const motionLabel = computed(() => props.paused ? '刷新暂停' : props.online === true ? '在线采集' : props.online === false ? '设备离线' : '状态未知')
// Add supplied equipment photos here. Use source + deviceId for an exact device match.
const equipmentImages = [
  { nameIncludes: '输送电机', src: '/equipment/conveyor-motor.png' },
]
const failedImage = ref('')
const image = computed(() => equipmentImages.find(item => item.deviceId
  ? item.deviceId === props.deviceId && item.source === props.source
  : props.name?.includes(item.nameIncludes))?.src || '')
</script>
<template>
  <div class="equipment-visual" :class="{ 'has-photo': image && failedImage !== image, 'is-active': active, 'is-fan': isFan, 'is-offline': online === false }">
    <svg class="operation-ring" viewBox="0 0 200 60" aria-hidden="true"><ellipse class="ring-track" cx="100" cy="30" rx="91" ry="23" /><ellipse class="ring-flow" cx="100" cy="30" rx="91" ry="23" pathLength="100" /></svg>
    <img v-if="image && failedImage !== image" :src="image" :alt="name" loading="lazy" @error="failedImage = image" />
    <div v-else class="equipment-symbol" aria-hidden="true"><component class="equipment-glyph" :is="isFan ? Fan : Server" :size="70" :stroke-width="1" /><span class="activity-leds"><i></i><i></i><i></i></span></div>
    <span class="visual-baseline" aria-hidden="true"></span>
    <span class="operation-state" :title="'根据设备在线状态展示采集动态'"><i></i>{{ motionLabel }}</span>
  </div>
</template>
<style scoped>
.equipment-visual { position: relative; height: 190px; display: grid; place-items: center; overflow: hidden; background: radial-gradient(ellipse at 50% 75%, #348fbc16, transparent 65%); }
.equipment-visual::before { content: ''; position: absolute; width: 180px; height: 180px; border: 1px solid #5c9fc512; border-radius: 50%; }
.equipment-visual img { position: relative; z-index: 1; width: 90%; height: 90%; object-fit: contain; filter: drop-shadow(0 14px 12px #0004); }
.equipment-symbol { color: #709cac; border: 1px solid #709cac24; border-radius: 18px; padding: 20px; background: #709cac08; transform: perspective(500px) rotateY(-12deg); }
.visual-baseline { position: absolute; bottom: 13px; left: 20%; right: 20%; height: 1px; background: linear-gradient(90deg, transparent, #6ea7c650, transparent); }
.equipment-visual { --motion-color: #00c875; }
.equipment-symbol { position: relative; z-index: 1; }
.equipment-visual .operation-ring { position: absolute; width: 85%; max-width: 240px; height: 48px; bottom: 13px; overflow: visible; color: var(--motion-color); pointer-events: none; }
.operation-ring ellipse { fill: none; stroke: currentColor; stroke-width: 1; }
.ring-track { opacity: .12; }
.ring-flow { opacity: 0; stroke-dasharray: 16 34; }
.is-active .ring-flow { opacity: .8; animation: equipment-flow 3s linear infinite; }
.operation-state { position: absolute; z-index: 3; right: 10px; bottom: 5px; display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: var(--text-muted); white-space: nowrap; }
.operation-state > i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.is-active .operation-state { color: var(--motion-color); }
.is-active .operation-state > i { animation: equipment-beacon 2s ease-out infinite; }
.is-offline .operation-state { color: #ff9800; }
.activity-leds { position: absolute; bottom: 6px; left: 50%; display: flex; gap: 4px; transform: translateX(-50%); }
.activity-leds i { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); opacity: .3; }
.is-active .activity-leds i { background: var(--motion-color); animation: equipment-led 1.5s ease-in-out infinite; }
.is-active .activity-leds i:nth-child(2) { animation-delay: .25s; }
.is-active .activity-leds i:nth-child(3) { animation-delay: .5s; }
.is-active.is-fan .equipment-glyph { animation: equipment-spin 4s linear infinite; }
@keyframes equipment-flow { to { stroke-dashoffset: -100; } }
@keyframes equipment-spin { to { transform: rotate(360deg); } }
@keyframes equipment-led { 0%,100% { opacity: .2; } 50% { opacity: 1; } }
@keyframes equipment-beacon { 0% { box-shadow: 0 0 0 0 #00c87555; } 100% { box-shadow: 0 0 0 5px #00c87500; } }
@media (prefers-reduced-motion: reduce) { .equipment-visual *, .equipment-visual *::before { animation: none !important; } .is-active .activity-leds i { opacity: 1; } }
</style>
