<script setup>
import SpectrogramCanvas from './SpectrogramCanvas.vue'
const props = defineProps({ frame: Object, name: String, status: String })
</script>
<template>
  <div class="sound-chart">
    <header><h3>{{ name }}</h3><span>{{ status }}</span></header>
    <div class="plot" role="img" :aria-label="name + '频谱瀑布图'">
      <SpectrogramCanvas :frames="frame?.rows || []" :sample-rate="frame?.sampleRate || 22000" />
    </div>
  </div>
</template>
<style scoped>
.sound-chart { padding:6px 14px 10px; }
header { display:flex; justify-content:space-between; gap:8px; min-height:42px; }
h3 { margin:0; font-size:14px; font-weight:500; line-height:21px; color:var(--text-main); }
header span { color:var(--text-muted); font-size:11px; white-space:nowrap; margin-top:3px; }
.plot { margin-top:6px; height:128px; overflow:hidden; border-radius:4px; }
.plot :deep(.spectrogram-canvas) { height:128px; }
.plot :deep(.empty-chart) { font-size:11px; }
.plot :deep(.frequency-axis),.plot :deep(.time-axis) { font-size:9px; }
.plot :deep(.frequency-axis) { width:32px; }
</style>
