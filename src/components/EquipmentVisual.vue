<script setup>
import { computed, ref } from 'vue'
import { Fan, Server } from 'lucide-vue-next'
const props = defineProps({ name: String, source: String, deviceId: String })
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
  <div class="equipment-visual" :class="{ 'has-photo': image && failedImage !== image }">
    <img v-if="image && failedImage !== image" :src="image" :alt="name" loading="lazy" @error="failedImage = image" />
    <div v-else class="equipment-symbol" aria-hidden="true"><component :is="source === 'monitor' ? Fan : Server" :size="70" :stroke-width="1" /></div>
    <span class="visual-baseline" aria-hidden="true"></span>
  </div>
</template>
<style scoped>
.equipment-visual { position: relative; height: 190px; display: grid; place-items: center; overflow: hidden; background: radial-gradient(ellipse at 50% 75%, #348fbc16, transparent 65%); }
.equipment-visual::before { content: ''; position: absolute; width: 180px; height: 180px; border: 1px solid #5c9fc512; border-radius: 50%; }
.equipment-visual img { position: relative; z-index: 1; width: 90%; height: 90%; object-fit: contain; filter: drop-shadow(0 14px 12px #0004); }
.equipment-symbol { color: #709cac; border: 1px solid #709cac24; border-radius: 18px; padding: 20px; background: #709cac08; transform: perspective(500px) rotateY(-12deg); }
.visual-baseline { position: absolute; bottom: 13px; left: 20%; right: 20%; height: 1px; background: linear-gradient(90deg, transparent, #6ea7c650, transparent); }
</style>
