<script setup>
import HomePointCard from './HomePointCard.vue'
import HomeSoundChart from './HomeSoundChart.vue'
import HomeAuxiliaryCard from './HomeAuxiliaryCard.vue'
import { acousticChannelDisplayName } from '../charts/machineGroups.js'

defineProps({ row: Object, buffers: Object, loading: Boolean, now: Number, paused: Boolean, soundStatus: String })
const emit = defineEmits(['details'])
</script>
<template>
  <article class="point-tile" :style="{ '--category-color': row.color }" role="button" tabindex="0" :aria-label="(row.combined?.title || (row.member.source === 'monitor' ? acousticChannelDisplayName(row.member.raw, row.point) : row.point.name || row.point.channelId || row.point.pointCode))+'详情'" aria-haspopup="dialog" @click="emit('details', row)" @keydown.enter.prevent="emit('details', row)" @keydown.space.prevent="emit('details', row)">
    <HomeAuxiliaryCard v-if="row.combined" :title="row.combined.title" :speed-name="row.combined.speedName" :current-name="row.combined.currentName" :speed="row.combined.speed" :current="row.combined.current" :buffers="buffers" :now="now" :paused="paused" />
    <HomePointCard v-else-if="row.member.source === 'legacy'" compact :loading="loading" :point="row.point" :samples="buffers[row.key] || []" :color="row.color" :now="now" :paused="paused" />
    <HomeSoundChart v-else :frame="row.soundFrame" :name="acousticChannelDisplayName(row.member.raw, row.point)" :status="row.soundStatus || soundStatus" />
  </article>
</template>
<style scoped>
.point-tile { cursor:pointer; padding-top:8px; }
.point-tile:focus-visible { outline:2px solid var(--category-color); outline-offset:3px; }
</style>
