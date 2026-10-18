<script setup>
import { useRuntimeInfo } from '../composables/useRuntimeInfo.js'

const { summary, status, error } = useRuntimeInfo()
const count = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
const percent = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—'
</script>

<template>
  <section class="production-summary" aria-label="86号机台生产状态">
    <h2>86#机台</h2>
    <dl><div><dt>牌号</dt><dd>{{ summary.brand || '—' }}</dd></div><div><dt>小盒产量</dt><dd>{{ count(summary.checkCount) }}</dd></div><div><dt>NG数</dt><dd>{{ count(summary.checkNg) }}</dd></div><div><dt>NG率</dt><dd>{{ percent(summary.ngP) }}</dd></div></dl>
<!--    <p v-if="status" class="runtime-status" :title="error" role="status">{{ status }}</p>-->
  </section>
</template>

<style scoped>
.production-summary dd { overflow-wrap:anywhere; }
.runtime-status { margin:6px 0 0; color:var(--line-soft); font-size:12px; }
.production-summary { padding:12px 16px 9px; border-bottom:1px solid var(--line-border); }
.production-summary h2 { margin:0 0 10px; font-size:28px; font-weight:650; letter-spacing:1px; }.production-summary dl { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; margin:0; }.production-summary dt { font-size:14px; color:var(--line-soft); }.production-summary dd { margin:4px 0 0; font-size:25px; font-variant-numeric:tabular-nums; color:var(--line-text); line-height:1.1; }
@media(max-height:800px) { .production-summary { padding:9px 12px 7px; }.production-summary h2 { font-size:25px; margin-bottom:7px; }.production-summary dt { font-size:13px; }.production-summary dd { font-size:21px; } }
</style>
