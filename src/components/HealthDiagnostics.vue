<script setup>
import { computed, ref } from 'vue'
import { Database } from 'lucide-vue-next'
import { useHealthStore } from '../stores/health'

const health = useHealthStore()
const tableTab = ref('moduleTables')
const onlyIssues = ref(false)
const dateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}
const display = (value) => value ?? '—'
const exists = (value) => value === true ? '正常' : value === false ? '异常' : '未知'
const tone = (value) => value === true ? 'good' : value === false ? 'bad' : 'muted'
const statusText = (status) => ({ Healthy: '健康', Unhealthy: '异常', Degraded: '降级', ok: '运行中' }[status] || status || '等待数据')
const statusTone = (status) => ['Healthy', 'ok'].includes(status) ? 'good' : status ? 'bad' : 'muted'
const detail = computed(() => health.detail || {})
const cache = computed(() => detail.value.offlineCache || {})
const maintenance = computed(() => health.maintenance?.runtimeStatus || detail.value.tableMaintenance || {})
const maintenanceOptions = computed(() => health.maintenance?.options || {})
const sortedModules = computed(() => [...health.modules].sort((a, b) => Number(a.isOnline === true) - Number(b.isOnline === true)))
const visibleChecks = computed(() => onlyIssues.value ? health.failedChecks : [...health.checks].sort((a, b) => Number(a.status === 'Healthy') - Number(b.status === 'Healthy')))
const tableRows = computed(() => detail.value[tableTab.value] || [])
const tableReady = (row) => row.exists === true && row.hasPmax === true && Array.isArray(row.missingPartitions) && row.missingPartitions.length === 0
const cacheEvents = computed(() => {
  const value = cache.value.runtimeStatus || {}
  return [
    { name: '最近缓存', time: value.lastCachedAt, file: value.lastCachedFile, count: value.lastCachedSampleCount },
    { name: '最近回写', time: value.lastFlushedAt, file: value.lastFlushedFile, count: value.lastFlushedSampleCount },
    { name: '最近坏文件', time: value.lastBadFileAt, file: value.lastBadFile, movedFile: value.lastMovedBadFile },
    { name: '最近回写失败', time: value.lastFlushFailedAt, file: value.lastFlushFailedFile, count: value.lastFlushFailedSampleCount, error: value.lastFlushFailedError },
  ]
})
const partitions = (items) => items?.length ? items.join('、') : '无'
const bytes = (value) => value == null ? '—' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`
</script>

<template>
  <div class="health-home health-grid">
      <article class="panel health-wide">
        <h2>模块运行状态 <small>离线优先 · {{ health.modules.length }} 个状态</small></h2>
        <el-table :data="sortedModules" row-key="moduleId" class="dark-table" max-height="330" empty-text="暂无模块运行状态">
          <el-table-column type="expand" width="42"><template #default="{ row }"><dl class="health-expanded"><dt>最近上线</dt><dd>{{ dateTime(row.lastOnlineAt) }}</dd><dt>最近离线</dt><dd>{{ dateTime(row.lastOfflineAt) }}</dd><dt>离线原因</dt><dd>{{ row.offlineReason || '无' }}</dd></dl></template></el-table-column>
          <el-table-column prop="moduleId" label="模块" width="120" />
          <el-table-column prop="protocol" label="协议" width="100" />
          <el-table-column label="状态" width="110"><template #default="{ row }"><span class="health-badge" :class="tone(row.isOnline)">{{ row.isOnline === true ? '在线' : row.isOnline === false ? '离线' : '未知' }}</span></template></el-table-column>
          <el-table-column label="最近更新" width="190"><template #default="{ row }">{{ dateTime(row.lastUpdatedAt) }}</template></el-table-column>
          <el-table-column label="离线原因" min-width="260" show-overflow-tooltip><template #default="{ row }"><span :class="row.isOnline === false ? 'bad' : 'muted'">{{ row.offlineReason || '—' }}</span></template></el-table-column>
        </el-table>
      </article>

      <article class="panel health-wide">
        <h2>健康检查明细 <small>{{ health.checks.length - health.failedChecks.length }} / {{ health.checks.length }} 项通过</small></h2>
        <div class="health-section-tools"><span>数据库、配置文件、缓存与运行时检查</span><label><el-switch v-model="onlyIssues" aria-label="仅看异常" />仅看异常</label></div>
        <el-table :data="visibleChecks" class="dark-table" max-height="290" :empty-text="onlyIssues && health.detail ? '当前没有异常检查项' : '暂无健康检查数据'">
          <el-table-column prop="name" label="检查项" min-width="290" show-overflow-tooltip />
          <el-table-column label="结果" width="100"><template #default="{ row }"><span class="health-badge" :class="statusTone(row.status)">{{ statusText(row.status) }}</span></template></el-table-column>
          <el-table-column prop="message" label="检查说明" min-width="380" show-overflow-tooltip />
        </el-table>
      </article>

      <article class="panel health-wide">
        <h2>数据表与分区状态</h2>
        <el-tabs v-model="tableTab" class="health-tabs"><el-tab-pane :label="`原始历史表（${detail.moduleTables?.length ?? 0}）`" name="moduleTables" /><el-tab-pane :label="`聚合表（${detail.aggregationTables?.length ?? 0}）`" name="aggregationTables" /></el-tabs>
        <el-table :data="tableRows" row-key="tableName" class="dark-table" max-height="320" empty-text="暂无数据表状态">
          <el-table-column type="expand" width="42"><template #default="{ row }"><dl class="health-expanded"><dt>预期分区</dt><dd>{{ partitions(row.expectedPartitions) }}</dd><dt>缺失分区</dt><dd :class="row.missingPartitions?.length ? 'bad' : ''">{{ partitions(row.missingPartitions) }}</dd></dl></template></el-table-column>
          <el-table-column prop="moduleId" label="模块" width="110" />
          <el-table-column prop="tableName" label="数据表" min-width="310" show-overflow-tooltip />
          <el-table-column label="表状态" width="100"><template #default="{ row }"><span :class="tableReady(row) ? 'good' : 'bad'">{{ tableReady(row) ? '就绪' : '待检查' }}</span></template></el-table-column>
          <el-table-column label="表存在" width="85"><template #default="{ row }">{{ exists(row.exists) }}</template></el-table-column>
          <el-table-column label="pmax" width="85"><template #default="{ row }">{{ exists(row.hasPmax) }}</template></el-table-column>
          <el-table-column prop="partitionCount" label="分区数" width="85" />
          <el-table-column v-if="tableTab === 'aggregationTables'" label="聚合桶" width="90"><template #default="{ row }">{{ row.bucketMinutes }} 分钟</template></el-table-column>
          <el-table-column label="缺失分区" min-width="100"><template #default="{ row }"><span :class="row.missingPartitions?.length ? 'bad' : ''">{{ row.missingPartitions?.length ?? '—' }}</span></template></el-table-column>
        </el-table>
      </article>

      <article class="panel">
        <h2>离线缓存</h2>
        <div class="health-cache-metrics"><div><span>待回写文件</span><strong>{{ display(cache.fileCount) }}</strong></div><div><span>坏文件</span><strong :class="cache.badFileCount ? 'bad' : ''">{{ display(cache.badFileCount) }}</strong></div><div><span>临时文件</span><strong>{{ display(cache.temporaryFileCount) }}</strong></div><div><span>总大小</span><strong>{{ bytes(cache.totalBytes) }}</strong></div></div>
        <dl class="health-info"><dt>缓存目录</dt><dd>{{ cache.directory || '—' }}</dd><dt>最早文件创建</dt><dd>{{ dateTime(cache.oldestFileCreatedAt) }}</dd></dl>
        <details class="health-details"><summary>查看缓存运行记录</summary><div v-for="event in cacheEvents" :key="event.name" class="health-cache-event"><b>{{ event.name }}</b><span>{{ dateTime(event.time) }}</span><p>文件：{{ event.file || '无' }}<template v-if="event.count != null"> · 样本 {{ event.count }} 条</template></p><p v-if="event.movedFile">转移至：{{ event.movedFile }}</p><p v-if="event.error" class="bad">{{ event.error }}</p></div></details>
      </article>

      <article class="panel">
        <h2>配置文件</h2>
        <div v-if="!detail.configFiles?.length" class="health-empty">暂无配置文件状态</div>
        <div v-for="file in detail.configFiles || []" :key="file.file" class="health-config"><div><Database :size="17" /><strong>{{ file.file }}</strong><span class="health-badge" :class="tone(file.exists)">{{ file.exists === true ? '存在' : file.exists === false ? '缺失' : '未知' }}</span></div><p>{{ file.path || '—' }}</p></div>
        <p class="health-footnote">显示服务端配置文件状态与路径。</p>
      </article>

      <article class="panel health-wide">
        <h2>分区自动维护 <small>生成于 {{ dateTime(health.maintenance?.generatedAt) }}</small></h2>
        <div v-if="!health.maintenance && detail.tableMaintenance" class="health-footnote">当前运行记录来自健康详情；独立维护接口尚未返回，维护参数暂不可用。</div>
        <div class="health-maintenance-options"><span>预建分区 <b>{{ display(maintenanceOptions.futurePartitionMonths) }}</b> 个月</span><span>数据保留 <b>{{ display(maintenanceOptions.dataRetentionMonths) }}</b> 个月</span><span>检查周期 <b>{{ display(maintenanceOptions.checkIntervalHours) }}</b> 小时</span><span>最近处理 <b>{{ display(maintenance.lastModuleCount) }}</b> 个模块</span></div>
        <dl class="health-maintenance-times"><div><dt>最近开始</dt><dd>{{ dateTime(maintenance.lastStartedAt) }}</dd></div><div><dt>最近成功</dt><dd>{{ dateTime(maintenance.lastSucceededAt) }}</dd></div><div><dt>最近失败</dt><dd>{{ dateTime(maintenance.lastFailedAt) }}</dd></div></dl>
        <div v-if="maintenance.lastError" class="health-error">最近维护错误：{{ maintenance.lastError }}</div>
        <el-table :data="maintenance.lastResults || []" row-key="tableName" class="dark-table" max-height="320" empty-text="暂无维护记录">
          <el-table-column type="expand" width="42"><template #default="{ row }"><dl class="health-expanded"><dt>维护前分区</dt><dd>{{ partitions(row.existingPartitionsBefore) }}</dd><dt>新增分区</dt><dd>{{ partitions(row.missingPartitionsAdded) }}</dd><dt>清理过期分区</dt><dd>{{ partitions(row.expiredPartitionsDropped) }}</dd><dt>维护后分区</dt><dd>{{ partitions(row.existingPartitionsAfter) }}</dd></dl></template></el-table-column>
          <el-table-column prop="moduleId" label="模块" width="110" />
          <el-table-column prop="tableName" label="数据表" min-width="270" show-overflow-tooltip />
          <el-table-column label="表已就绪" width="110"><template #default="{ row }"><span :class="tone(row.tableCreatedOrExists)">{{ exists(row.tableCreatedOrExists) }}</span></template></el-table-column>
          <el-table-column label="新增分区" width="110"><template #default="{ row }">{{ row.missingPartitionsAdded?.length ?? '—' }}</template></el-table-column>
          <el-table-column label="清理分区" width="110"><template #default="{ row }">{{ row.expiredPartitionsDropped?.length ?? '—' }}</template></el-table-column>
          <el-table-column label="维护后分区数" width="125"><template #default="{ row }">{{ row.existingPartitionsAfter?.length ?? '—' }}</template></el-table-column>
        </el-table>
      </article>
  </div>
</template>

<style scoped>
.health-home { color: var(--text-main); }
.health-home .panel { border-radius: 8px; }
.health-home .panel:hover { transform: none; }
.health-home .panel h2 { height: 45px; background: none; padding-left: 18px; font-size: 14px; gap: 12px; }
.health-home .panel h2::before, .health-home .panel h2::after { display: none; }
.health-home .panel h2 small { color: var(--text-muted); font-size: 11px; font-weight: 400; margin-left: auto; }
.health-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr); gap: 16px; }
.health-grid > article { min-width: 0; }
.health-wide { grid-column: 1 / -1; }
.health-badge { display: inline-flex; align-items: center; padding: 3px 9px; border: 1px solid currentColor; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.health-home .good { color: var(--health-good, #a8ff7d); }
.health-home .bad { color: var(--health-bad, #ffad66); }
.health-home .muted { color: var(--text-muted); }
:global(.light-theme .health-home) { --health-good: #287452; --health-bad: #b65015; }
.health-error { margin-bottom: 12px; padding: 12px 16px; border: 1px solid rgba(255, 139, 31, .4); background: rgba(255, 139, 31, .08); color: var(--health-bad, #ffad66); border-radius: 6px; font-size: 12px; overflow-wrap: anywhere; }
.health-footnote { padding: 0 18px; margin: 12px 0 16px; font-size: 11px; line-height: 1.7; color: var(--text-muted); }
.health-section-tools { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 18px; color: var(--text-muted); font-size: 11px; }
.health-section-tools label { display: flex; align-items: center; gap: 8px; }
.health-expanded, .health-info { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; padding: 12px 20px; margin: 0; font-size: 12px; }
.health-expanded dt, .health-info dt { color: var(--text-muted); }
.health-expanded dd, .health-info dd { margin: 0; line-height: 1.6; overflow-wrap: anywhere; }
.health-tabs { padding: 0 18px; }
.health-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.health-cache-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 20px 18px 10px; gap: 12px; }
.health-cache-metrics span { display: block; font-size: 10px; color: var(--text-muted); }
.health-cache-metrics strong { display: block; margin-top: 8px; font-size: 20px; font-weight: 500; }
.health-details { padding: 12px 18px 18px; font-size: 12px; }
.health-details summary { cursor: pointer; color: var(--text-soft); }
.health-cache-event { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; overflow-wrap: anywhere; }
.health-cache-event span { margin-left: 12px; color: var(--text-muted); }
.health-cache-event p { color: var(--text-muted); font-size: 11px; }
.health-config { margin: 20px 18px; }
.health-config > div { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.health-config .health-badge { margin-left: auto; }
.health-config p { color: var(--text-muted); font-size: 11px; overflow-wrap: anywhere; margin-left: 27px; }
.health-empty { color: var(--text-muted); text-align: center; padding: 30px; font-size: 12px; }
.health-maintenance-options { display: flex; flex-wrap: wrap; gap: 15px 36px; padding: 18px; font-size: 12px; border-bottom: 1px solid var(--line); color: var(--text-soft); }
.health-maintenance-options b { color: var(--text-main); font-size: 20px; margin: 0 6px; }
.health-maintenance-times { display: grid; grid-template-columns: repeat(3, 1fr); padding: 16px 18px; margin: 0; gap: 20px; font-size: 12px; }
.health-maintenance-times dt { color: var(--text-muted); font-size: 11px; }
.health-maintenance-times dd { margin: 8px 0 0; }
.health-home :deep(.el-table__expanded-cell) { background: var(--glass-card); padding: 8px 0; }
.health-home :deep(.el-table .cell) { font-size: 12px; }
</style>
