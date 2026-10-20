<script setup>
defineProps({ loading: Boolean, compact: Boolean, chart: Boolean, label: { type: String, default: '正在加载数据' } })
</script>

<template>
  <component :is="compact ? 'span' : 'div'" v-if="loading" class="data-loading" :class="{ 'data-loading-compact': compact, 'data-loading-chart': chart }" role="status" aria-live="polite" :aria-label="label" aria-busy="true">
    <span v-for="index in compact ? 1 : 3" :key="index" class="data-loading-line" aria-hidden="true"></span>
    <span class="data-loading-label">{{ label }}</span>
  </component>
  <slot v-else />
</template>

<style scoped>
.data-loading { display:flex; flex-direction:column; justify-content:center; gap:14px; width:100%; min-height:110px; padding:18px 12px; box-sizing:border-box; grid-column:1 / -1; color:var(--text-muted); }
.data-loading-line { display:block; height:12px; width:100%; border-radius:5px; background:color-mix(in srgb, var(--text-muted, #8b9b95) 30%, transparent); opacity:.8; animation:data-loading-pulse 1.5s ease-in-out infinite; }
.data-loading-line:nth-child(2) { width:85%; }.data-loading-line:nth-child(3) { width:65%; }
.data-loading-label { font-size:13px; font-weight:normal; text-align:center; }
.data-loading-compact { display:inline-flex; vertical-align:middle; width:3.5em; min-height:1em; padding:0; gap:0; }
.data-loading-compact .data-loading-line { height:.7em; }.data-loading-compact .data-loading-label { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.data-loading-chart { min-height:180px; height:100%; }
@keyframes data-loading-pulse { 50% { opacity:.45; } }
@media(prefers-reduced-motion:reduce) { .data-loading-line { animation:none; } }
</style>
