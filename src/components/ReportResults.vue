<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { reportValue } from '../charts/reportAnalysis.js'
import { reportBucketPath } from '../charts/reportAggregates.js'
const props = defineProps({ report: { type: Object, required: true } })
const detailPointId = ref('')
watch(() => props.report, () => { detailPointId.value = '' })
const detailRow = computed(() => props.report.rows.find(row => String(row.point.pointId) === detailPointId.value))
const detailOpen = computed({ get: () => Boolean(detailRow.value), set: value => { if (!value) detailPointId.value = '' } })
const detailPath = computed(() => detailRow.value ? reportBucketPath(detailRow.value.current, props.report.ranges.current) : '')
const bucketTime = bucket => new Date(bucket.time).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
const rangeText = range => `${range.start.replace('T', ' ').slice(0, 16)} — ${range.end.replace('T', ' ').slice(0, 16)}`
const resultTotals = computed(() => props.report.rows.reduce((total, row) => ({
  count: total.count + (row.current?.count || 0), missing: total.missing + (row.current?.missingBuckets || 0),
  attention: total.attention + Number(row.attention), failed: total.failed + Number(!row.current),
}), { count: 0, missing: 0, attention: 0, failed: 0 }))
</script>

<template>
    <template v-if="report">
      <div class="report-metrics report-aggregate-metrics">
        <article><div><span>报告测点</span><strong>{{ report.rows.length }}</strong></div></article>
        <article><div><span>有效样本</span><strong>{{ resultTotals.count.toLocaleString() }}</strong></div></article>
        <article><div><span>缺失时间桶</span><strong>{{ resultTotals.missing }}</strong></div></article>
        <article><div><span>需要复核</span><strong>{{ resultTotals.attention }}</strong></div></article>
      </div>
      <section class="report-panel">
        <div class="report-section-heading"><h2>本期测点汇总</h2><span v-if="resultTotals.failed" class="report-warning">{{ resultTotals.failed }} 个测点读取失败</span></div>
        <div class="report-table-scroll"><table><thead><tr><th>测点</th><th>加权均值</th><th>最小 / 最大</th><th>末值</th><th>样本数</th><th>有效 / 应有桶</th><th>均值变化</th><th>数据状态</th><th></th></tr></thead><tbody>
          <tr v-for="row in report.rows" :key="row.point.pointId" :class="{ 'report-selected-row': String(row.point.pointId) === detailPointId }">
            <td><strong>{{ row.point.name || row.point.pointCode }}</strong><small>{{ row.point.moduleId }} · {{ row.point.unit || '无单位' }}</small></td>
            <td>{{ reportValue(row.current?.mean) }}</td><td>{{ reportValue(row.current?.min) }} / {{ reportValue(row.current?.max) }}</td><td>{{ reportValue(row.current?.last) }}</td><td>{{ row.current?.count ?? '—' }}</td>
            <td>{{ row.current ? `${row.current.bucketCount} / ${row.current.expectedBuckets}` : '—' }}</td>
            <td>{{ row.change.percent === null ? (row.change.delta === null ? '不可比' : `差值 ${reportValue(row.change.delta)}`) : `${reportValue(row.change.percent)}%` }}</td>
            <td :class="{ 'report-warning': row.attention }">{{ row.errors.join('；') || (!row.current?.count ? '无有效数据' : row.current.missingBuckets ? `缺失 ${row.current.missingBuckets} 桶` : '数据完整') }}<small v-if="row.current?.overBuckets" class="report-warning">{{ row.current.overBuckets }} 个桶极值越限</small><small v-if="row.current?.invalid" class="report-warning">剔除 {{ row.current.invalid }} 条无效桶</small><small v-if="row.current?.truncated" class="report-warning">数据已截断</small><small v-if="row.change.percent !== null && Math.abs(row.change.percent) >= 10" class="report-warning">均值变化达到 10%</small></td>
            <td><button :disabled="!row.current?.buckets.length" @click="detailPointId = String(row.point.pointId)">时间桶明细</button></td>
          </tr>
        </tbody></table></div>
      </section>
      <ElDialog v-model="detailOpen" :title="`${detailRow?.point.name || detailRow?.point.pointCode || '测点'} · 5 分钟明细`" width="min(1100px, 94vw)" align-center append-to-body destroy-on-close :close-on-click-modal="false" class="equipment-report-page report-bucket-dialog">
        <template v-if="detailRow">
        <div class="report-bucket-chart"><div class="report-section-heading"><span>各时间桶平均值（{{ detailRow.point.unit || '无单位' }}）</span><span>{{ reportValue(Math.min(...detailRow.current.buckets.map(bucket => bucket.averageValue))) }} — {{ reportValue(Math.max(...detailRow.current.buckets.map(bucket => bucket.averageValue))) }}</span></div><svg viewBox="0 0 900 180" role="img" aria-label="5 分钟平均值趋势，缺数处断开"><path :d="detailPath" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" /></svg><div class="report-bucket-chart-axis"><span>{{ rangeText(report.ranges.current).split(' — ')[0] }}</span><span>{{ rangeText(report.ranges.current).split(' — ')[1] }}</span></div></div>
        <div class="report-table-scroll report-bucket-details"><table><thead><tr><th>时间桶开始（北京时间）</th><th>最小值</th><th>最大值</th><th>平均值</th><th>末值</th><th>样本数</th></tr></thead><tbody><tr v-for="bucket in detailRow.current.buckets" :key="bucket.time"><td>{{ bucketTime(bucket) }}</td><td>{{ reportValue(bucket.minValue) }}</td><td>{{ reportValue(bucket.maxValue) }}</td><td>{{ reportValue(bucket.averageValue) }}</td><td>{{ reportValue(bucket.lastValue) }}</td><td>{{ bucket.sampleCount }}</td></tr></tbody></table></div>
        </template>
        <template #footer><button @click="detailOpen = false">关闭</button></template>
      </ElDialog>
    </template>
</template>
