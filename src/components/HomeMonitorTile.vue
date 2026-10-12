<script setup>
import HomePointCard from './HomePointCard.vue'
import HomeSoundChart from './HomeSoundChart.vue'
import HomeAuxiliaryCard from './HomeAuxiliaryCard.vue'

defineProps({ row: Object, buffers: Object, now: Number, paused: Boolean, soundStatus: String })
const emit = defineEmits(['details'])
</script>
<template>
  <article class="point-tile" :style="{ '--category-color': row.color }">
    <div class="point-context"><span :title="row.member.name"><i></i>{{ row.categoryName }} · {{ row.member.id }}</span><button @click="emit('details', row.member)" :aria-label="(row.point.name || row.point.channelId || row.point.pointCode)+'详情'">详情 ↗</button></div>
    <HomeAuxiliaryCard v-if="row.combined" :title="row.combined.title" :speed-name="row.combined.speedName" :current-name="row.combined.currentName" :speed="row.combined.speed" :current="row.combined.current" :buffers="buffers" :now="now" :paused="paused" />
    <HomePointCard v-else-if="row.member.source === 'legacy'" compact :point="row.point" :samples="buffers[row.key] || []" :color="row.color" :now="now" :paused="paused" />
    <HomeSoundChart v-else :frame="row.soundFrame" :name="row.point.name || row.point.channelName || row.point.channelId" :status="row.soundStatus || soundStatus" />
  </article>
</template>
<style scoped>
.point-context { min-width:0; padding:8px 14px 0; display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--text-muted); font-size:11px; }
.point-context > span { min-width:0; display:flex; align-items:center; gap:6px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.point-context i { width:6px; height:6px; flex:none; border-radius:50%; background:var(--category-color); }
.point-context button { flex:none; padding:4px 8px; border:1px solid var(--glass-border); border-radius:5px; background:transparent; color:var(--text-soft); font-size:11px; line-height:1.2; white-space:nowrap; transition:background .15s,border-color .15s,color .15s; }
.point-context button:hover { border-color:var(--control-border-active); background:var(--glass-card); color:var(--text-main); }
</style>
