<script setup>
import { ref } from 'vue'
import SiteProductionLinePlan from '../components/SiteProductionLinePlan.vue'

const variant = ref('dark')
const variants = [{ id: 'dark', label: '深色' }, { id: 'light', label: '浅色' }, { id: 'flat', label: '扁平' }]
</script>

<template>
  <section class="page site-plan-preview">
    <nav aria-label="图纸样式"><button v-for="item in variants" :key="item.id" :aria-pressed="variant === item.id" @click="variant = item.id">{{ item.label }}</button></nav>
    <SiteProductionLinePlan :variant="variant" />
  </section>
</template>

<style scoped>
.site-plan-preview { display:flex; flex-direction:column; gap:8px; }
nav { display:flex; justify-content:flex-end; gap:6px; }
button { padding:5px 14px; color:var(--text-main); background:var(--control-bg); border:1px solid var(--glass-border); border-radius:4px; font-size:12px; }
button[aria-pressed=true] { border-color:var(--cyan); }
.site-plan-preview :deep(.site-production-plan) { flex:1; }
</style>
