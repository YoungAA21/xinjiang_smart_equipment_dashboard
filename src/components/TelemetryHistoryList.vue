<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  samples: { type: Array, required: true },
  point: { type: Object, required: true },
})
const page = ref(1)
const pageSize = ref(20)
const order = ref('desc')
const sortedSamples = computed(() => [...props.samples].sort((a, b) => {
  const left = Date.parse(a.collectedAt)
  const right = Date.parse(b.collectedAt)
  if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0
  if (!Number.isFinite(right)) return -1
  return order.value === 'desc' ? right - left : left - right
}))
const pageCount = computed(() => Math.max(1, Math.ceil(sortedSamples.value.length / pageSize.value)))
const offset = computed(() => (page.value - 1) * pageSize.value)
const rows = computed(() => sortedSamples.value.slice(offset.value, offset.value + pageSize.value))
watch([() => props.samples, () => props.point.pointId, pageSize, order], () => { page.value = 1 })
const valueText = (value) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
const timeText = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
}
</script>

<template>
  <section class="history-list" aria-label="历史数据列表">
    <header class="history-list-header">
      <div><h3>历史数据列表</h3><p>{{ point.name || point.pointCode }} · pointId {{ point.pointId }} · 共 {{ samples.length }} 条</p></div>
      <label>时间排序<select v-model="order" aria-label="历史列表时间排序"><option value="desc">最新优先</option><option value="asc">最早优先</option></select></label>
    </header>
    <div class="history-table-scroll" tabindex="0" aria-label="历史数据表格滚动区域">
      <table>
        <caption>当前查询返回的原始采样；时间按本地时区显示，数值保留接口精度。</caption>
        <thead><tr><th scope="col">序号</th><th scope="col">采集时间</th><th scope="col" class="value-cell">数值{{ point.unit ? '（'+point.unit+'）' : '' }}</th><th scope="col">质量（原始值）</th></tr></thead>
        <tbody>
          <tr v-for="(sample, index) in rows" :key="offset + index"><td>{{ offset + index + 1 }}</td><td :title="sample.collectedAt">{{ timeText(sample.collectedAt) }}</td><td class="value-cell">{{ valueText(sample.value) }}</td><td>{{ sample.quality ?? '—' }}</td></tr>
          <tr v-if="!rows.length"><td colspan="4" class="empty-history">所选时间区间没有历史数据</td></tr>
        </tbody>
      </table>
    </div>
    <footer class="history-list-footer">
      <span>显示 {{ samples.length ? offset + 1 : 0 }}–{{ offset + rows.length }} / {{ samples.length }} 条</span>
      <label>每页<select v-model.number="pageSize" aria-label="历史列表每页条数"><option :value="20">20 条</option><option :value="50">50 条</option><option :value="100">100 条</option></select></label>
      <nav aria-label="历史列表分页"><button :disabled="page <= 1" @click="page--">上一页</button><span aria-live="polite">{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></nav>
    </footer>
  </section>
</template>

<style scoped>
.history-list { margin: 18px 0; border-top: 1px solid var(--glass-border); padding-top: 16px; font-size: 14px; color: var(--text-main); }
.history-list-header, .history-list-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
h3 { font-size: 16px; margin: 0 0 7px; font-weight: 600; }
p { color: var(--text-muted); font-size: 14px; margin: 0; }
label { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 14px; }
select, button { background: var(--surface); color: var(--text-main); border: 1px solid var(--glass-border); border-radius: 4px; padding: 6px 8px; font: inherit; }
button { cursor: pointer; } button:disabled { opacity: .4; cursor: default; }
button:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
.history-table-scroll { max-height: 410px; overflow: auto; scrollbar-width: thin; margin: 12px 0; border: 1px solid var(--glass-border); border-radius: 5px; }
.history-table-scroll::-webkit-scrollbar { display: block; width: 8px; height: 8px; }
.history-table-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); background-clip: padding-box; border: 2px solid transparent; border-radius: 6px; }
.history-table-scroll::-webkit-scrollbar-thumb:hover { background-color: var(--scrollbar-thumb-hover); }
table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
caption { text-align: left; padding: 9px 12px; font-size: 14px; color: var(--text-muted); }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--glass-border); white-space: nowrap; }
th { position: sticky; top: 0; background: var(--surface); color: var(--text-soft); font-size: 14px; font-weight: 500; z-index: 1; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: #50d8cb08; }
.value-cell { text-align: right; } td.value-cell { color: var(--accent); }
.empty-history { text-align: center; color: var(--text-muted); padding: 28px; }
.history-list-footer { color: var(--text-muted); font-size: 14px; }
.history-list-footer > label { margin-left: auto; }
nav { display: flex; align-items: center; gap: 12px; }
</style>
