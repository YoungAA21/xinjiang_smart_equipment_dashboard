<script setup>
import { computed, ref, watch } from 'vue'
import { alarmTime, mergeAlarmSnapshots } from '../charts/alarms.js'
const props = defineProps({ legacy: { type: Object, required: true }, external: { type: Object, required: true }, externalSnapshot: { type: Object, required: true } })
defineEmits(['refresh', 'inspect'])
const source = ref('all')
const page = ref(1)
const allRows = computed(() => mergeAlarmSnapshots(props.legacy.rows || [], props.external.rows))
const filtered = computed(() => allRows.value.filter((row) => source.value === 'all' || row.source === source.value))
const rows = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
watch([source, allRows], () => { page.value = 1 })
</script>

<template>
  <section class="alarm-overview">
    <header class="alarm-overview-heading"><div><h2>双源告警总览</h2><p>按时间汇总已获取结果，点击详情进入对应来源</p></div><button :disabled="legacy.loading || external.loading" @click="$emit('refresh')">刷新两侧告警</button></header>
    <div class="alarm-source-cards">
      <article><span>5158 · 采集报警</span><strong>{{ legacy.rows?.length ?? '—' }} <small>条已获取</small></strong><p>上限 {{ legacy.requested?.limit ?? 200 }} 条 · {{ legacy.requested?.isActive === undefined ? '全部状态' : legacy.requested.isActive ? '当前告警' : '已恢复' }} · pointId {{ legacy.requested?.pointId ?? '全部' }}</p><p>{{ alarmTime(legacy.requested?.start) }} → {{ alarmTime(legacy.requested?.end) }}</p><p>更新 {{ alarmTime(legacy.updatedAt) }}</p><b v-if="legacy.loading">正在查询</b><b v-else-if="legacy.error" class="alarm-error-text">{{ legacy.rows ? '查询失败，保留上次结果' : '报警事件暂不可用' }}</b></article>
      <article><span>18080 · 设备告警</span><strong>{{ externalSnapshot.updatedAt ? external.rows.length : '—' }} <small>条当前页</small></strong><p>接口总数 {{ externalSnapshot.updatedAt ? external.total : '—' }} 条</p><p>{{ externalSnapshot.queryLabel }}</p><p>更新 {{ alarmTime(externalSnapshot.updatedAt) }}</p><b v-if="external.loading">正在查询</b><b v-else-if="externalSnapshot.error" class="alarm-error-text">{{ externalSnapshot.updatedAt ? '查询失败，保留上次结果' : '尚未获取结果' }}</b></article>
    </div>
    <p v-if="legacy.error" class="alarm-error" role="alert">5158：{{ legacy.error }}。分析 Worker 状态可在“5158 采集报警”查看，不能替代报警事件。</p>
    <p v-if="externalSnapshot.error" class="alarm-error" role="alert">18080：{{ externalSnapshot.error }}</p>
    <p class="alarm-muted">列表仅合并两侧已获取数据，不代表全量告警。5158 的“已恢复”与 18080 的“已处理”分别展示，不跨来源去重；各自筛选条件在来源页设置。</p>
    <p v-if="legacy.rows && legacy.rows.length >= legacy.requested?.limit" class="alarm-error">5158 已达到查询上限，请在来源页缩小范围。</p>
    <label class="alarm-source-filter">列表来源<select v-model="source" aria-label="告警总览来源"><option value="all">全部来源</option><option value="5158">5158</option><option value="18080">18080</option></select></label>
    <div class="alarm-table-scroll"><table class="alarm-data-table"><thead><tr><th>来源</th><th>告警时间</th><th>设备 / 点位</th><th>状态</th><th>原因 / 类型</th><th>详情</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="row.key"><td><span class="alarm-source-badge" :class="{ external: row.source === '18080' }">{{ row.source }}</span><small>{{ row.id }}</small></td><td>{{ alarmTime(row.time) }}</td><td>{{ row.device }}<small>{{ row.point }}</small></td><td>{{ row.status }}</td><td class="alarm-reason">{{ row.reason }}</td><td><button @click="$emit('inspect', row)">查看详情</button></td></tr>
      <tr v-if="!rows.length"><td colspan="6" class="alarm-empty">{{ legacy.loading || external.loading ? '正在加载告警…' : legacy.error || externalSnapshot.error ? '当前可用结果中没有记录；部分来源请求失败' : '当前已获取结果中没有匹配告警' }}</td></tr>
    </tbody></table></div>
    <footer class="alarm-pagination"><span>当前范围 {{ filtered.length }} 条</span><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" @click="page++">下一页</button></footer>
  </section>
</template>
