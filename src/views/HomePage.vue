<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, ArrowDown, ChevronRight, CircleCheck, Database, FileCheck2, Layers3, Radio, RefreshCw, Server, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-vue-next'
import EChart from '../components/EChart.vue'
import { useHealthStore } from '../stores/health'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { mergeHomeDevices, deviceSourceSummary } from '../charts/homeDevices'
import { countOnline } from '../charts/healthCharts'
import { cacheDonut, checksBars, healthGauge, maintenanceBars, onlineDonut, partitionHeatmap } from '../charts/healthCharts'

const HealthDiagnostics = defineAsyncComponent(() => import('../components/HealthDiagnostics.vue'))
const health = useHealthStore()
const homeDevices = useHomeDevicesStore()
const deviceSource = ref('all')
const autoRefresh = ref(true)
const detailsOpen = ref(false)
const partitionType = ref('moduleTables')
const selectedModuleKey = ref('')
const reducedMotion = ref(false)
const controller = new AbortController()
let timer, motionQuery
const syncMotion = () => { reducedMotion.value = motionQuery.matches }
const refreshing = computed(() => health.loading || homeDevices.loading)
const refresh = () => Promise.all([health.refresh({ signal: controller.signal }), homeDevices.refresh({ signal: controller.signal })])
onMounted(() => {
  refresh()
  timer = window.setInterval(() => { if (autoRefresh.value) refresh() }, 15000)
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncMotion()
  motionQuery.addEventListener('change', syncMotion)
})
onBeforeUnmount(() => {
  window.clearInterval(timer)
  controller.abort()
  homeDevices.clear()
  motionQuery?.removeEventListener('change', syncMotion)
})
const chart = (option) => ({ ...option, animation: !reducedMotion.value })
const detail = computed(() => health.detail || {})
const runtime = computed(() => detail.value.runtimeModules || {})
const cache = computed(() => detail.value.offlineCache)
const maintenance = computed(() => health.maintenance?.runtimeStatus || detail.value.tableMaintenance || {})
const options = computed(() => health.maintenance?.options || {})
const passedChecks = computed(() => health.checks.length - health.failedChecks.length)
const allDevices = computed(() => mergeHomeDevices(health.modules, homeDevices.devices || []))
const totalStates = computed(() => countOnline(allDevices.value))
const hasDeviceData = computed(() => health.detail !== null || homeDevices.devices !== null)
const filteredLoaded = computed(() => deviceSource.value === 'legacy' ? health.detail !== null : deviceSource.value === 'monitor' ? homeDevices.devices !== null : hasDeviceData.value)
const modules = computed(() => allDevices.value
  .filter((device) => deviceSource.value === 'all' || device.source === deviceSource.value)
  .sort((a, b) => Number(a.isOnline === true) - Number(b.isOnline === true) || Number(b.source === 'monitor') - Number(a.source === 'monitor')))
const visibleStates = computed(() => countOnline(modules.value))
const selectedModule = computed(() => modules.value.find((m) => m.key === selectedModuleKey.value) || modules.value[0])
const sourceSummary = computed(() => deviceSourceSummary({ legacyLoaded: health.detail !== null, monitorLoaded: homeDevices.devices !== null, legacyError: health.errors.detail, monitorError: homeDevices.error }))
const sourceStates = computed(() => [
  { key: 'legacy', label: '5158 模块', count: health.detail ? health.modules.length : '—', error: health.errors.detail, loaded: health.detail !== null, time: health.detail?.generatedAt },
  { key: 'monitor', label: '18080 设备', count: homeDevices.devices?.length ?? '—', error: homeDevices.error, loaded: homeDevices.devices !== null, time: homeDevices.refreshedAt },
])
const tables = computed(() => detail.value[partitionType.value] || [])
const missingPartitions = computed(() => tables.value.reduce((sum, t) => sum + (t.missingPartitions?.length || 0), 0))
const pointCount = computed(() => detail.value.moduleChannelPointTable)
const gaugeOption = computed(() => chart(healthGauge(health.checks)))
const onlineOption = computed(() => chart(onlineDonut(modules.value)))
const checksOption = computed(() => chart(checksBars(health.checks)))
const partitionOption = computed(() => chart(partitionHeatmap(tables.value)))
const maintenanceOption = computed(() => chart(maintenanceBars(maintenance.value.lastResults)))
const cacheOption = computed(() => chart(cacheDonut(cache.value)))
const dateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}
const display = (value) => value ?? '—'
const bytes = (value) => value == null ? '—' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`
const tone = (value) => value === true ? 'good' : value === false ? 'warn' : 'muted'
const statusText = computed(() => health.errors.detail ? '数据待更新' : ({ Healthy: '5158 健康', Unhealthy: '5158 异常', Degraded: '5158 降级' }[detail.value.status] || '等待数据'))
const errorLabels = { heartbeat: '基础心跳', detail: '健康详情', maintenance: '分区维护' }
const metrics = computed(() => [
  { label: '设备 / 模块总数', value: hasDeviceData.value ? allDevices.value.length : '—', unit: '个', icon: Server, color: 'cyan', note: '5158 模块 + 18080 设备' },
  { label: '在线设备 / 模块', value: hasDeviceData.value ? totalStates.value.online : '—', unit: '个', icon: Wifi, color: 'green', note: '两套来源已获取的在线记录' },
  { label: '离线设备 / 模块', value: hasDeviceData.value ? totalStates.value.offline : '—', unit: '个', icon: WifiOff, color: 'orange', note: '未知状态 '+(hasDeviceData.value ? totalStates.value.unknown : '—')+' 个 · 不计为离线' },
  { label: '5158 有效监测点', value: display(pointCount.value?.activePointCount), unit: '个', icon: Radio, color: 'purple', note: '预期点位 '+display(pointCount.value?.expectedPointCount)+' 个 · 不含新通道' },
])
const systemNodes = computed(() => [
  { label: '数据库连接', ok: detail.value.database?.isHealthy, icon: Database },
  { label: '模块配置表', ok: detail.value.collectorModuleTable?.exists, icon: Layers3 },
  { label: '点位同步', ok: pointCount.value ? pointCount.value.exists && pointCount.value.activePointCount === pointCount.value.expectedPointCount : undefined, icon: Radio },
])
const maintenanceEvents = computed(() => [
  { label: '最近启动', time: maintenance.value.lastStartedAt, type: 'cyan' },
  { label: '最近成功', time: maintenance.value.lastSucceededAt, type: 'green' },
  { label: '最近失败', time: maintenance.value.lastFailedAt, type: 'orange' },
])
</script>

<template>
  <section class="page page-home health-cockpit" :aria-busy="refreshing">
    <header class="cockpit-header">
      <div><div class="eyebrow"><Sparkles :size="13" /> LIVE SYSTEM OBSERVATORY</div><h1>设备健康驾驶舱 <span class="live-pill" :class="{ warning: health.errors.detail || (detail.status && detail.status !== 'Healthy') }"><i></i>{{ statusText }}</span></h1><p>{{ health.heartbeat?.service || '等待服务响应' }}<span> / </span><b :class="tone(health.errors.heartbeat ? false : health.heartbeat ? health.heartbeat.status === 'ok' : undefined)">{{ health.errors.heartbeat ? '心跳连接失败' : health.heartbeat?.status === 'ok' ? '心跳运行中' : health.heartbeat?.status || '心跳待连接' }}</b><span> / </span>{{ dateTime(health.heartbeat?.time) }}</p></div>
      <div class="cockpit-actions"><label><el-switch v-model="autoRefresh" aria-label="自动刷新" /><span>15 秒自动刷新</span></label><el-button :loading="refreshing" @click="refresh"><RefreshCw v-if="!refreshing" :size="14" />刷新状态</el-button><small>详情生成于 {{ dateTime(detail.generatedAt) }}</small></div>
    </header>

    <div v-for="(message, key) in health.errors" :key="key" class="cockpit-error" role="alert">{{ errorLabels[key] }}获取失败：{{ message }}。{{ health[key] ? '图表保留上次成功数据，请留意生成时间。' : '暂无可用数据。' }}</div>

    <div v-if="homeDevices.error" class="cockpit-error" role="alert">18080 设备获取失败：{{ homeDevices.error }}。{{ homeDevices.devices !== null ? '设备汇总保留上次成功数据，请留意更新时间。' : '当前汇总尚不包含新接口设备。' }}</div>
    <div class="device-source-status"><div v-for="source in sourceStates" :key="source.key" :class="source.error ? 'warn' : source.loaded ? 'good' : 'muted'" :title="'更新时间 '+dateTime(source.time)"><i></i><b>{{ source.label }}</b><span>{{ source.count }} 个 · {{ source.error ? source.loaded ? '数据过期' : '获取失败' : source.loaded ? '已更新' : '等待数据' }}</span><time>{{ dateTime(source.time) }}</time></div><p>{{ sourceSummary }}</p></div>

    <div class="metric-strip"><article v-for="(metric, index) in metrics" :key="metric.label" class="metric-tile" :class="metric.color"><div class="metric-icon"><component :is="metric.icon" :size="21" /></div><div><span>{{ metric.label }}</span><strong>{{ metric.value }}<small>{{ metric.unit }}</small></strong><p>{{ metric.note }}</p></div><span class="metric-index">0{{ index + 1 }}</span><div class="tile-trace"></div></article></div>

    <div class="cockpit-grid">
      <article class="viz-panel module-panel"><header><div><span class="section-no">01</span><h2>设备 / 模块在线分布</h2></div><small>{{ modules.length }} 个状态</small></header>
        <div class="device-source-filter segmented" role="group" aria-label="设备来源"><button type="button" :class="{ active: deviceSource === 'all' }" :aria-pressed="deviceSource === 'all'" @click="deviceSource = 'all'">全部</button><button type="button" :class="{ active: deviceSource === 'legacy' }" :aria-pressed="deviceSource === 'legacy'" @click="deviceSource = 'legacy'">5158 模块</button><button type="button" :class="{ active: deviceSource === 'monitor' }" :aria-pressed="deviceSource === 'monitor'" @click="deviceSource = 'monitor'">18080 设备</button></div>
        <div class="module-summary"><div class="online-chart" role="img" :aria-label="'当前来源：在线 '+visibleStates.online+'，离线 '+visibleStates.offline+'，未知 '+visibleStates.unknown"><EChart :option="onlineOption" /></div><div class="module-legend"><span><i class="green-dot"></i>在线 <b>{{ filteredLoaded ? visibleStates.online : '—' }}</b></span><span><i class="orange-dot"></i>离线 <b>{{ filteredLoaded ? visibleStates.offline : '—' }}</b></span><span><i class="gray-dot"></i>未知 <b>{{ filteredLoaded ? visibleStates.unknown : '—' }}</b></span></div></div>
        <div class="module-matrix"><button v-for="module in modules" :key="module.key" type="button" :class="[tone(module.isOnline), { selected: selectedModule?.key === module.key, 'new-device': module.source === 'monitor' }]" :aria-pressed="selectedModule?.key === module.key" :aria-label="module.sourceLabel+' '+module.name+' '+(module.isOnline === true ? '在线' : module.isOnline === false ? '离线' : '未知')" :title="module.sourceLabel+' · '+module.name+' · '+module.id" @click="selectedModuleKey = module.key"><i></i><span>{{ module.name }}</span><small>{{ module.sourceLabel }}</small></button><p v-if="!modules.length" class="muted">{{ filteredLoaded ? '当前来源暂无设备 / 模块' : '当前来源尚未返回数据' }}</p></div>
        <div v-if="selectedModule" class="module-insight"><b :class="tone(selectedModule.isOnline)">{{ selectedModule.name }} · {{ selectedModule.isOnline === true ? '在线' : selectedModule.isOnline === false ? '离线' : '未知' }}</b><small>{{ selectedModule.sourceLabel }} · {{ selectedModule.kind }} · {{ selectedModule.id }}</small><p v-if="selectedModule.source === 'monitor'">网关连接 {{ display(selectedModule.connectedCollectors) }}/{{ display(selectedModule.collectorCount) }} · 通道在线 {{ display(selectedModule.onlineChannels) }}/{{ display(selectedModule.channelCount) }}</p><p :title="selectedModule.offlineReason || selectedModule.updatedAtLabel+' '+dateTime(selectedModule.updatedAt)">{{ selectedModule.offlineReason || selectedModule.updatedAtLabel+' '+dateTime(selectedModule.updatedAt) }}</p></div>
        <p class="micro-note">按模块 isOnline / 设备 online 统计；网关不重复计入设备数。</p>
      </article>

      <article class="viz-panel core-panel"><header><div><span class="section-no">02</span><h2>健康检查核心</h2></div><ShieldCheck :size="17" /></header><div class="core-orbit" aria-hidden="true"></div><div class="core-gauge" role="img" :aria-label="`健康检查 ${passedChecks} 项通过，共 ${health.checks.length} 项`"><EChart :option="gaugeOption" /></div><div class="core-summary"><span><b class="good">{{ health.detail ? passedChecks : '—' }}</b>项通过</span><i></i><span><b :class="health.failedChecks.length ? 'warn' : ''">{{ health.detail ? health.failedChecks.length : '—' }}</b>项异常</span></div><div class="core-nodes"><div v-for="node in systemNodes" :key="node.label" :class="tone(node.ok)"><component :is="node.icon" :size="17" /><span>{{ node.label }}</span><b>{{ node.ok === true ? '正常' : node.ok === false ? '异常' : '未知' }}</b></div></div><p class="micro-note">仅 5158 健康检查 · 不代表 18080 服务健康</p></article>

      <article class="viz-panel checks-panel"><header><div><span class="section-no">03</span><h2>检查项覆盖</h2></div><span class="mini-tag">{{ health.checks.length }} CHECKS</span></header><div class="mini-legend"><span><i class="cyan-dot"></i>通过</span><span><i class="orange-dot"></i>异常</span><small>单位：项</small></div><div class="checks-chart" role="img" aria-label="按数据库、历史表、聚合表、配置、缓存队列、运行时分类的检查结果"><EChart :option="checksOption" /></div><div class="check-message" :class="{ warning: health.failedChecks.length }"><CircleCheck :size="16" /><span>{{ !health.detail ? '等待检查结果' : health.failedChecks.length ? `${health.failedChecks.length} 项检查需要关注` : '全部已上报检查项通过' }}</span></div><p class="micro-note">5158 检查项 · 异常详情见底部诊断区</p></article>

      <article class="viz-panel partition-panel"><header><div><span class="section-no">04</span><h2>数据分区覆盖矩阵</h2></div><div class="segmented" role="group" aria-label="分区表类型"><button type="button" :class="{ active: partitionType === 'moduleTables' }" :aria-pressed="partitionType === 'moduleTables'" @click="partitionType = 'moduleTables'">原始历史表</button><button type="button" :class="{ active: partitionType === 'aggregationTables' }" :aria-pressed="partitionType === 'aggregationTables'" @click="partitionType = 'aggregationTables'">聚合表</button></div></header><div class="partition-stats"><span><b>{{ tables.length }}</b> 张表</span><span :class="missingPartitions ? 'warn' : 'good'"><b>{{ health.detail ? missingPartitions : '—' }}</b> 缺失分区</span><div class="mini-legend"><span><i class="green-dot"></i>覆盖</span><span><i class="orange-dot"></i>缺失</span><span><i class="gray-dot"></i>未知 / 不要求</span></div></div><div class="partition-chart" :style="{ height: `${Math.max(225, Math.min(tables.length, 20) * 23 + 42)}px` }" role="img" :aria-label="`${tables.length} 张表的预期分区覆盖矩阵，缺失 ${missingPartitions} 个分区`"><EChart :option="partitionOption" /></div><p class="micro-note">横轴为预期分区月份与 pmax；悬停查看每个模块的覆盖状态。</p></article>

      <article class="viz-panel cache-panel"><header><div><span class="section-no">05</span><h2>离线缓存舱</h2></div><Database :size="16" /></header><div class="cache-visual"><div class="cache-chart" role="img" aria-label="待回写、坏文件与临时文件数量分布"><EChart :option="cacheOption" /></div><div class="cache-amount"><span>缓存占用</span><strong>{{ bytes(cache?.totalBytes) }}</strong><small>{{ cache?.fileCount === 0 && cache?.badFileCount === 0 && cache?.temporaryFileCount === 0 ? '当前无缓存文件' : '当前缓存快照' }}</small></div></div><div class="cache-meters"><div><i class="cyan-dot"></i><span>待回写</span><b>{{ display(cache?.fileCount) }}</b></div><div><i class="orange-dot"></i><span>坏文件</span><b :class="cache?.badFileCount ? 'warn' : ''">{{ display(cache?.badFileCount) }}</b></div><div><i class="purple-dot"></i><span>临时文件</span><b>{{ display(cache?.temporaryFileCount) }}</b></div></div><p class="micro-note">缓存为零时显示空环，不填充模拟占比。</p></article>

      <article class="viz-panel maintenance-panel"><header><div><span class="section-no">06</span><h2>分区维护观测</h2></div><small>分区数 / 个</small></header><div class="maintenance-policies"><span>预建 <b>{{ display(options.futurePartitionMonths) }}</b> 个月</span><span>保留 <b>{{ display(options.dataRetentionMonths) }}</b> 个月</span><span>周期 <b>{{ display(options.checkIntervalHours) }}</b> 小时</span></div><div class="maintenance-chart" role="img" aria-label="最近一次维护前后，各模块分区数量对比"><EChart :option="maintenanceOption" /></div><div class="maintenance-timeline"><div v-for="event in maintenanceEvents" :key="event.label"><i :class="`${event.type}-dot`"></i><span>{{ event.label }}</span><time>{{ dateTime(event.time) }}</time></div></div><p v-if="maintenance.lastError" class="maintenance-error warn">{{ maintenance.lastError }}</p></article>

      <article class="viz-panel pipeline-panel"><header><div><span class="section-no">07</span><h2>数据管道与配置</h2></div><Activity :size="16" /></header><div class="pipeline-flow"><div class="flow-source"><Radio :size="15" /><span>模块采集</span><b>{{ display(runtime.statusCount) }}</b></div><div class="flow-connector" aria-hidden="true"><ArrowDown :size="15" /></div><div class="flow-queues"><div><span>持久化待处理</span><strong>{{ display(detail.queues?.persistencePending) }}</strong></div><div><span>分析待处理</span><strong>{{ display(detail.queues?.analysisPending) }}</strong></div></div><div class="flow-connector" aria-hidden="true"><ArrowDown :size="15" /></div><div class="flow-database" :class="tone(detail.database?.isHealthy)"><Database :size="15" />数据库<span>{{ detail.database?.isHealthy === true ? '连接正常' : detail.database?.isHealthy === false ? '连接异常' : '状态未知' }}</span></div></div><div class="config-chips"><div v-for="file in detail.configFiles || []" :key="file.file" :title="`${file.file}\n${file.path || ''}`"><FileCheck2 :size="13" /><span>{{ file.file.split('/').pop() }}</span><i :class="file.exists === true ? 'green-dot' : 'orange-dot'"></i></div></div><p class="micro-note">5158 管道示意 · 不含 18080 网关队列</p></article>
    </div>

    <details class="diagnostics-drawer" @toggle="detailsOpen = $event.target.open"><summary><span><Layers3 :size="16" />5158 完整诊断明细</span><span>模块原因 · 检查结果 · 分区与维护记录 <ChevronRight :size="16" /></span></summary><HealthDiagnostics v-if="detailsOpen" /></details>
    <footer class="cockpit-footer"><span><i class="cyan-dot"></i>5158 健康 + 18080 设备 · 双来源数据</span><span>最近请求 {{ dateTime(health.lastAttemptAt) }} · {{ autoRefresh ? '自动刷新开启' : '自动刷新暂停' }}</span></footer>
  </section>
</template>

<style scoped>
.health-cockpit { --glow: #8ee6a8; --aqua: #50d8cb; --warm: #ffad66; --violet: #ab9ff2; --muted: var(--text-muted); --card-fill: rgba(18, 32, 29, .82); display: block; overflow-y: auto; overflow-x: hidden; padding: 20px; scrollbar-width: thin; color: var(--text-main); background: radial-gradient(ellipse at 50% 5%, #46907c14, transparent 55%), var(--page-bg); }
.health-cockpit * { box-sizing: border-box; }
.cockpit-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.eyebrow { display: flex; align-items: center; gap: 7px; font-size: 9px; letter-spacing: 2.8px; color: var(--aqua); }
.cockpit-header h1 { display: flex; align-items: center; gap: 13px; font-size: 25px; letter-spacing: 1px; font-weight: 600; margin: 8px 0; }
.cockpit-header p { font-size: 10px; color: var(--muted); margin: 0; line-height: 1.7; }
.cockpit-header p > span { margin: 0 9px; opacity: .4; }
.live-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 10px; color: var(--glow); background: #8ee6a810; border: 1px solid #8ee6a82b; border-radius: 20px; letter-spacing: 0; white-space: nowrap; }
.live-pill > i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.live-pill.warning { color: var(--warm); border-color: #ffad6655; }
.cockpit-actions { display: grid; grid-template-columns: auto auto; gap: 4px 12px; flex-shrink: 0; }
.cockpit-actions label { display: flex; gap: 7px; align-items: center; font-size: 10px; cursor: pointer; }
.cockpit-actions small { grid-column: 1 / -1; text-align: right; font-size: 10px; color: var(--muted); }
.cockpit-actions :deep(.el-button > span) { gap: 6px; }
.cockpit-error { border: 1px solid #ffad6655; padding: 10px 14px; color: var(--warm); background: #ffad660d; border-radius: 6px; margin-bottom: 12px; font-size: 12px; }
.metric-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.metric-tile { position: relative; display: flex; gap: 15px; align-items: center; min-width: 0; padding: 16px 18px; border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; background: linear-gradient(115deg, #46907c12, transparent), var(--card-fill); --metric-color: var(--aqua); }
.metric-tile.green { --metric-color: var(--glow); }.metric-tile.orange { --metric-color: var(--warm); }.metric-tile.purple { --metric-color: var(--violet); }
.metric-icon { width: 40px; height: 44px; border: 1px solid color-mix(in srgb, var(--metric-color) 23%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--metric-color) 8%, transparent); color: var(--metric-color); display: grid; place-items: center; }
.metric-tile span { font-size: 11px; color: var(--text-soft); }
.metric-tile strong { display: block; font-size: 30px; color: var(--metric-color); font-weight: 600; margin-top: 5px; font-variant-numeric: tabular-nums; line-height: 1.1; text-shadow: 0 0 20px color-mix(in srgb, var(--metric-color) 18%, transparent); }
.metric-tile strong small { color: var(--muted); font-size: 10px; margin-left: 8px; font-weight: 400; }
.metric-tile p { margin: 6px 0 0; font-size: 9px; color: var(--muted); }
.metric-tile .metric-index { position: absolute; top: 12px; right: 12px; opacity: .2; font-size: 20px; font-style: italic; }
.tile-trace { position: absolute; bottom: 0; left: 18px; right: 18px; height: 2px; background: linear-gradient(90deg, var(--metric-color), transparent); opacity: .45; }
.cockpit-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.viz-panel { position: relative; min-width: 0; grid-column: span 4; overflow: hidden; border: 1px solid var(--glass-border); border-radius: 10px; background: linear-gradient(160deg, #46907c08, transparent 55%), var(--card-fill); box-shadow: inset 0 1px 0 #ffffff06, 0 8px 24px #00000012; }
.viz-panel::after { content: ''; position: absolute; top: -1px; left: 22px; width: 68px; height: 1px; background: var(--aqua); box-shadow: 0 0 13px #50d8cb66; opacity: .65; }
.viz-panel > header { height: 46px; margin: 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #7ebca515; }
.viz-panel > header > div:first-child { display: flex; align-items: center; gap: 8px; }
.viz-panel h2 { margin: 0; font-size: 12px; font-weight: 600; white-space: nowrap; letter-spacing: .5px; }
.section-no { font-size: 9px; color: var(--aqua); opacity: .6; font-family: monospace; }
.viz-panel header small, .viz-panel header > svg { font-size: 9px; color: var(--muted); }
.module-summary { display: flex; justify-content: center; align-items: center; gap: 25px; padding: 5px 14px 0; }
.online-chart { width: 130px; height: 130px; }
.module-legend { display: grid; gap: 12px; font-size: 10px; min-width: 86px; }
.module-legend > span { display: flex; align-items: center; gap: 8px; color: var(--text-soft); }.module-legend b { margin-left: auto; color: var(--text-main); }
i.green-dot, i.cyan-dot, i.orange-dot, i.gray-dot, i.purple-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.green-dot { background: var(--glow); }.cyan-dot { background: var(--aqua); }.orange-dot { background: var(--warm); }.gray-dot { background: #708781; }.purple-dot { background: var(--violet); }
.module-matrix { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; padding: 4px 16px 10px; max-height: 145px; overflow: auto; }
.module-matrix button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 39px; padding: 5px 2px; font-family: monospace; font-size: 9px; border: 1px solid #8ee6a826; background: #8ee6a807; border-radius: 4px; transition: background .2s, transform .2s; }
.module-matrix button.warn { border-color: #ffad6645; background: #ffad660d; }.module-matrix button.selected, .module-matrix button:hover { background: #8ee6a815; border-color: currentColor; transform: translateY(-1px); }
.module-matrix button i { height: 3px; width: 16px; background: currentColor; border-radius: 2px; box-shadow: 0 0 7px currentColor; opacity: .8; }
.module-insight { margin: 0 16px 13px; padding: 9px 10px; border-left: 2px solid var(--aqua); background: #46907c0b; font-size: 9px; }.module-insight b { font-size: 10px; }.module-insight p { margin: 5px 0 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.6; overflow-wrap: anywhere; }
.core-panel { background: radial-gradient(ellipse at 50% 45%, #50d8cb0e, transparent 65%), var(--card-fill); }
.core-gauge { position: relative; height: 213px; z-index: 1; margin-top: -3px; }
.core-orbit { position: absolute; width: 205px; height: 205px; border: 1px dashed #50d8cb19; border-radius: 50%; left: calc(50% - 102.5px); top: 50px; animation: orbit 70s linear infinite; }.core-orbit::before { content: ''; position: absolute; width: 4px; height: 4px; border-radius: 50%; top: 10px; left: 50px; background: var(--aqua); box-shadow: 0 0 10px var(--aqua); }
.core-summary { display: flex; justify-content: center; align-items: center; gap: 20px; margin-top: -23px; position: relative; z-index: 2; font-size: 10px; color: var(--muted); }.core-summary b { font-size: 19px; margin-right: 5px; color: var(--text-main); }.core-summary i { height: 20px; width: 1px; background: var(--line); }
.core-nodes { display: grid; grid-template-columns: repeat(3, 1fr); margin: 18px 13px 0; gap: 5px; }.core-nodes > div { display: flex; flex-direction: column; gap: 5px; align-items: center; font-size: 9px; }.core-nodes span { color: var(--muted); }.core-nodes b { font-weight: 400; font-size: 10px; }
.micro-note { color: var(--muted); font-size: 9px; padding: 0 16px; margin: 12px 0; line-height: 1.6; }.core-panel .micro-note { text-align: center; }
.mini-tag { font-size: 8px; letter-spacing: .6px; color: var(--aqua); background: #50d8cb0b; border: 1px solid #50d8cb20; padding: 4px 6px; border-radius: 3px; }
.mini-legend { display: flex; align-items: center; gap: 12px; padding: 15px 16px 8px; color: var(--muted); font-size: 9px; }.mini-legend span { display: inline-flex; align-items: center; gap: 5px; }.mini-legend small { margin-left: auto; font-size: 9px; }
.checks-chart { height: 210px; }.check-message { display: flex; align-items: center; gap: 9px; margin: 7px 16px 0; padding: 9px; border-radius: 4px; background: #8ee6a809; color: var(--glow); font-size: 10px; }.check-message.warning { color: var(--warm); background: #ffad6609; }
.partition-panel, .maintenance-panel { grid-column: span 8; }
.segmented { display: flex; padding: 2px; border: 1px solid var(--glass-border); border-radius: 5px; gap: 2px; }.segmented button { border: 0; color: var(--muted); background: none; border-radius: 3px; font-size: 9px; padding: 5px 9px; white-space: nowrap; }.segmented button.active { color: var(--glow); background: #8ee6a814; }
.partition-stats { display: flex; align-items: center; gap: 16px; padding: 11px 16px 8px; font-size: 10px; color: var(--muted); }.partition-stats b { color: var(--text-main); font-size: 17px; margin-right: 4px; font-weight: 500; }.partition-stats .mini-legend { margin-left: auto; padding: 0; gap: 8px; }.partition-chart { width: 100%; }.partition-panel .micro-note { margin-top: 4px; }
.cache-visual { display: flex; gap: 10px; justify-content: center; align-items: center; padding: 13px 14px 8px; }.cache-chart { width: 160px; height: 160px; flex-shrink: 0; }.cache-amount { display: grid; gap: 9px; }.cache-amount span { font-size: 10px; color: var(--muted); }.cache-amount strong { font-size: 24px; color: var(--aqua); font-weight: 500; white-space: nowrap; }.cache-amount small { font-size: 9px; color: var(--muted); }
.cache-meters { display: grid; gap: 11px; padding: 9px 20px 7px; }.cache-meters > div { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--muted); border-bottom: 1px solid #7ebca515; padding-bottom: 8px; }.cache-meters b { margin-left: auto; color: var(--text-main); font-size: 13px; font-weight: 500; }
.maintenance-policies { display: flex; gap: 22px; padding: 12px 16px; font-size: 10px; color: var(--muted); }.maintenance-policies b { color: var(--aqua); margin: 0 4px; font-size: 16px; font-weight: 500; }.maintenance-chart { height: 190px; }
.maintenance-timeline { display: grid; grid-template-columns: repeat(3, 1fr); padding: 13px 16px 15px; gap: 12px; border-top: 1px solid #7ebca515; }.maintenance-timeline > div { position: relative; display: grid; grid-template-columns: 8px 1fr; align-items: center; gap: 5px; font-size: 9px; color: var(--muted); }.maintenance-timeline time { grid-column: 2; color: var(--text-soft); font-size: 9px; }.maintenance-error { padding: 0 16px; overflow-wrap: anywhere; font-size: 10px; }
.pipeline-flow { padding: 15px 18px 0; }.flow-source, .flow-database { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--aqua); border: 1px solid #50d8cb29; border-radius: 4px; padding: 8px 11px; background: #50d8cb08; }.flow-source b { margin-left: auto; font-size: 14px; font-weight: 500; }.flow-database span { margin-left: auto; font-size: 9px; }
.flow-connector { color: #50d8cb77; display: grid; place-items: center; height: 23px; }.flow-queues { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.flow-queues > div { text-align: center; border: 1px solid #50d8cb25; background: #50d8cb08; padding: 9px 3px; border-radius: 5px; }.flow-queues span { font-size: 9px; color: var(--muted); }.flow-queues strong { display: block; font-size: 23px; font-weight: 500; color: var(--aqua); margin-top: 4px; }
.config-chips { display: grid; gap: 7px; margin: 13px 18px 0; }.config-chips > div { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--muted); }.config-chips i { margin-left: auto; }.config-chips span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diagnostics-drawer { margin-top: 16px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--card-fill); }.diagnostics-drawer > summary { display: flex; justify-content: space-between; align-items: center; padding: 15px 18px; cursor: pointer; font-size: 11px; color: var(--text-soft); list-style: none; }.diagnostics-drawer > summary::-webkit-details-marker { display: none; }.diagnostics-drawer > summary > span { display: flex; align-items: center; gap: 8px; }.diagnostics-drawer > summary > span:last-child { font-size: 10px; color: var(--muted); }.diagnostics-drawer[open] > summary > span:last-child svg { transform: rotate(90deg); }.diagnostics-drawer :deep(.health-grid) { margin: 0 12px 12px; }
.cockpit-footer { display: flex; justify-content: space-between; align-items: center; padding: 16px 0 0; font-size: 9px; color: var(--muted); }.cockpit-footer > span:first-child { display: flex; align-items: center; gap: 6px; }
.health-cockpit .good { color: var(--glow); }.health-cockpit .warn { color: var(--warm); }.health-cockpit .muted { color: var(--muted); }
@keyframes orbit { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .core-orbit { animation: none; }.module-matrix button { transition: none; } }
:global(.light-theme .health-cockpit) { --glow: #287452; --aqua: #237f76; --warm: #b65015; --violet: #7360b2; --card-fill: rgba(255,255,255,.94); }
@media (max-width: 1300px) { .health-cockpit { padding: 14px; }.cockpit-header h1 { font-size: 21px; }.cockpit-header p { max-width: 430px; }.metric-tile { padding: 13px 11px; gap: 10px; }.metric-icon { width: 33px; height: 38px; }.metric-tile p { font-size: 8px; }.cockpit-grid { gap: 12px; }.viz-panel > header { margin: 0 12px; }.module-summary { gap: 12px; }.online-chart { width: 116px; height: 123px; }.cache-visual { gap: 0; }.cache-chart { width: 137px; height: 152px; }.cache-amount strong { font-size: 20px; }.partition-stats { gap: 10px; }.partition-stats .mini-legend { gap: 5px; font-size: 8px; }.mini-tag { font-size: 7px; } }
.device-source-status { display: flex; flex-wrap: wrap; gap: 7px 18px; margin: -5px 0 14px; font-size: 10px; }
.device-source-status > div { display: flex; align-items: center; gap: 6px; }
.device-source-status > div > i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.device-source-status time { color: var(--muted); font-size: 9px; }
.device-source-status p { width: 100%; margin: 0; color: var(--muted); font-size: 9px; }
.device-source-filter { margin: 9px 16px 0; justify-content: space-between; }
.device-source-filter button { flex: 1; }
.module-matrix button { min-height: 51px; gap: 4px; min-width: 0; }
.module-matrix button > span { display: block; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.module-matrix button > small { font-size: 7px; opacity: .65; }
.module-matrix button.new-device { border-bottom: 2px solid var(--violet); }
.module-matrix > p { grid-column: 1 / -1; font-size: 10px; }
.module-insight > small { display: block; font-size: 8px; margin-top: 5px; color: var(--muted); overflow-wrap: anywhere; }
</style>
