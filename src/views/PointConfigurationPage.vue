<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { telemetryApi } from '../services/telemetry.js'
import { api } from '../services/api.js'
import { parameterKey, mergeDiscoveredPoints, updateLocation, removeLocation, isFixedLocation } from '../charts/pointConfiguration.js'
import { monitoringPointName } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName } from '../charts/machineGroups.js'
import { suggestedMonitoringLocationOf } from '../charts/monitoringLocations.js'
import { configurationSnapshot, pointConfiguration, savePointConfiguration, configuredParameter } from '../stores/pointConfiguration.js'
import '../styles/point-configuration.css'

const modules = ref([])
const devices = ref([])
const metadata = ref({})
const latest = ref([])
const errors = ref({})
const loading = ref(false)
const search = ref('')
const source = ref('all')
const status = ref('all')
const page = ref(1)
const selectedKey = ref('')
const notice = ref('')
const saveError = ref('')
const importInput = ref(null)
const editor = reactive({ displayName: '', unit: '', locationId: '', targetId: '' })
const newLocation = reactive({ name: '', machine: 'ZJ117' })
const newTarget = reactive({ name: '', locationId: '' })
const locationEdit = reactive({ id: '', name: '', machine: '' })
const deletion = reactive({ id: '', replacementId: '' })
const deletingLocation = computed(() => pointConfiguration.locations.find(location => location.id === deletion.id))
const childCount = id => pointConfiguration.targets.filter(target => target.locationId === id).length
const parameterCount = id => Object.values(pointConfiguration.parameters).filter(parameter => parameter.locationId === id).length
const controller = new AbortController()
let timer, latestTimer, latestBusy = false
const rows = computed(() => {
  const legacyIds = new Set([...modules.value.map(module => String(module.moduleId)), ...latest.value.map(sample => String(sample.moduleId)).filter(id => id && id !== 'undefined')])
  const result = [...legacyIds].flatMap(id => mergeDiscoveredPoints(metadata.value[id] || [], latest.value, id).map(point => ({ key: parameterKey(point), source: 'legacy', deviceId: id, point, device: modules.value.find(module => String(module.moduleId) === id), available: true })))
  for (const device of devices.value) for (const point of device.channels || []) result.push({ key: parameterKey(point, 'monitor', device.deviceId), source: 'monitor', deviceId: String(device.deviceId), point, device, available: true })
  const keys = new Set(result.map(row => row.key))
  for (const [key, config] of Object.entries(pointConfiguration.parameters)) {
    if (keys.has(key)) continue
    const [kind, deviceId, channelId, pointCode] = JSON.parse(key)
    result.push({ key, source: kind, deviceId, available: false, point: { moduleId: kind === 'legacy' ? deviceId : undefined, channelId, pointCode, pointId: config.pointId, name: config.backendName || pointCode || channelId, unit: config.backendUnit || '' } })
  }
  return result.map(row => ({ ...row, config: configuredParameter(row.point, row.source, row.deviceId) }))
})
const filtered = computed(() => rows.value.filter(row => {
  const text = `${row.deviceId} ${row.point.pointId ?? ''} ${row.point.channelId ?? ''} ${row.point.pointCode || ''} ${backendName(row)} ${row.config?.displayName || ''}`.toLowerCase()
  return (source.value === 'all' || source.value === row.source) && (status.value === 'all' || (status.value === 'configured' ? Boolean(row.config) : !row.config)) && text.includes(search.value.trim().toLowerCase())
}))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 15)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 15, page.value * 15))
const unconfigured = computed(() => rows.value.filter(row => !row.config).length)
const selected = computed(() => rows.value.find(row => row.key === selectedKey.value))
const targets = computed(() => pointConfiguration.targets.filter(target => target.locationId === editor.locationId))
const machineOptions = computed(() => [...new Set(['ZJ117', 'ZB25', 'YB55', 'YB65', 'YB95', ...pointConfiguration.locations.map(location => location.machine)])].filter(machine => !machine.includes('/')))
const backendName = row => row.point.name || row.point.channelName || row.point.pointCode || row.point.channelId || '后端未提供名称'
const locationName = id => pointConfiguration.locations.find(location => location.id === id)?.name || '未配置'
const targetName = id => pointConfiguration.targets.find(target => target.id === id)?.name || '未配置'
const sampleValue = row => {
  if (row.source === 'monitor') return '声纹通道'
  const sample = latest.value.find(item => parameterKey(item) === row.key)
  return sample?.value == null ? '—' : String(sample.value)
}
watch([search, source, status], () => { page.value = 1 })
watch(pageCount, value => { page.value = Math.min(page.value, value) })
function resetEditor() {
  const row = selected.value
  if (!row) return
  const suggestedLocation = suggestedMonitoringLocationOf({ source: row.source, id: row.deviceId, raw: row.device || {} }, row.point)
  Object.assign(editor, row.config || { displayName: row.source === 'legacy' ? monitoringPointName(row.point) : acousticChannelDisplayName(row.device, row.point), unit: row.point.unit || '', locationId: suggestedLocation || '', targetId: '' })
  notice.value = ''; saveError.value = ''
}
watch(selectedKey, resetEditor)
watch(() => editor.locationId, () => {
  if (!targets.value.some(target => target.id === editor.targetId)) editor.targetId = ''
})
function persist(value, message) {
  try { savePointConfiguration(value); notice.value = message; saveError.value = ''; return true }
  catch (error) { saveError.value = error.message; notice.value = ''; return false }
}
function saveParameter() {
  if (!selected.value) return
  const row = selected.value
  const value = configurationSnapshot()
  value.parameters[row.key] = { displayName: editor.displayName.trim(), unit: editor.unit.trim(), locationId: editor.locationId, targetId: editor.targetId, backendName: backendName(row), backendUnit: row.point.unit || '', pointId: row.point.pointId }
  persist(value, '参数配置已保存，监测页面已同步更新')
}
function clearParameter() {
  const value = configurationSnapshot()
  delete value.parameters[selectedKey.value]
  if (persist(value, '已恢复为未配置，后端原始数据保留')) resetEditor()
}
function addLocation() {
  const id = `location-${crypto.randomUUID()}`
  try {
    const value = updateLocation(configurationSnapshot(), id, newLocation)
    if (persist(value, '大点位已添加')) { newLocation.name = ''; newTarget.locationId = id; editor.locationId = id }
  } catch (error) { saveError.value = error.message }
}
function editLocation(location) {
  Object.assign(locationEdit, { id: location.id, name: location.name, machine: location.machine })
  deletion.id = ''; saveError.value = ''; notice.value = ''
}
function saveLocation() {
  if (!pointConfiguration.locations.some(location => location.id === locationEdit.id)) { saveError.value = '大点位已不存在，请重新选择'; return }
  try {
    const value = updateLocation(configurationSnapshot(), locationEdit.id, locationEdit)
    if (persist(value, '大点位已更新，名称和机组归属已同步')) locationEdit.id = ''
  } catch (error) { saveError.value = error.message }
}
function beginDeletion(location) {
  Object.assign(deletion, { id: location.id, replacementId: '' })
  locationEdit.id = ''; saveError.value = ''; notice.value = ''
}
function confirmDeletion() {
  const id = deletion.id
  const hasChildren = childCount(id) > 0 || parameterCount(id) > 0
  if (hasChildren && !deletion.replacementId) { saveError.value = '请选择迁移关联配置，或明确设为未配置'; return }
  const replacementId = deletion.replacementId === '__unconfigured' ? '' : deletion.replacementId
  try {
    const value = removeLocation(configurationSnapshot(), id, replacementId)
    if (!persist(value, replacementId ? '大点位已删除，关联配置已迁移；同名被测点位已合并' : '大点位已删除，关联参数已恢复未配置')) return
    deletion.id = ''
    if (newTarget.locationId === id) newTarget.locationId = replacementId
    if (editor.locationId === id) {
      if (selected.value?.config) Object.assign(editor, selected.value.config)
      else Object.assign(editor, { displayName: selected.value ? backendName(selected.value) : '', unit: selected.value?.point.unit || '', locationId: '', targetId: '' })
    }
  } catch (error) { saveError.value = error.message }
}
function addTarget() {
  const value = configurationSnapshot()
  const name = newTarget.name.trim(), locationId = newTarget.locationId
  if (!name || !locationId) { saveError.value = '请选择大点位并输入被测点位名称'; return }
  if (value.targets.some(target => target.name === name && target.locationId === locationId)) { saveError.value = '该大点位下已存在同名被测点位'; return }
  const target = { id: `target-${crypto.randomUUID()}`, name, locationId }
  value.targets.push(target)
  if (persist(value, `已添加被测点位「${name}」`)) { newTarget.name = ''; if (editor.locationId === locationId) editor.targetId = target.id }
}
function exportConfiguration() {
  const blob = new Blob([JSON.stringify(configurationSnapshot(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = '监测参数配置.json'; link.click()
  URL.revokeObjectURL(url)
}
async function importConfiguration(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('配置文件不能超过 5 MB')
    const value = JSON.parse(await file.text())
    if (persist(value, '配置已导入并同步到监测页面')) { selectedKey.value = ''; resetEditor() }
  } catch (error) { saveError.value = error.message || '配置文件无法读取' }
  finally { event.target.value = '' }
}
async function refreshLatest() {
  if (latestBusy || controller.signal.aborted) return
  latestBusy = true
  try {
    const value = await telemetryApi.getLatest({ signal: controller.signal })
    if (controller.signal.aborted) return
    if (!Array.isArray(value)) throw new Error('实时数据格式不正确')
    latest.value = value; delete errors.value.latest
  } catch (error) { if (!controller.signal.aborted) errors.value.latest = error.message }
  finally { latestBusy = false }
}
async function refresh() {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  const options = { signal: controller.signal }
  try {
    await Promise.all([
      (async () => {
        try {
          const result = await telemetryApi.getModules(options)
          if (controller.signal.aborted) return
          if (!Array.isArray(result?.modules)) throw new Error('模块目录格式不正确')
          modules.value = result.modules; delete errors.value.modules
          let index = 0
          await Promise.all(Array.from({ length: Math.min(3, modules.value.length) }, async () => {
            while (index < modules.value.length && !controller.signal.aborted) {
              const module = modules.value[index++]
              try {
                const body = await telemetryApi.getModulePoints(module.moduleId, options)
                if (controller.signal.aborted) return
                if (!Array.isArray(body?.points) || body.moduleId !== module.moduleId) throw new Error('参数目录格式不正确')
                metadata.value[module.moduleId] = body.points.map(point => ({ ...point, moduleId: module.moduleId }))
                delete errors.value[module.moduleId]
              } catch (error) { if (!controller.signal.aborted) errors.value[module.moduleId] = error.message }
            }
          }))
        } catch (error) { if (!controller.signal.aborted) errors.value.modules = error.message }
      })(),
      (async () => {
        try {
          const result = await api.getMonitorDevices(options)
          if (controller.signal.aborted) return
          if (!Array.isArray(result)) throw new Error('声纹通道目录格式不正确')
          devices.value = result; delete errors.value.monitor
        } catch (error) { if (!controller.signal.aborted) errors.value.monitor = error.message }
      })(),
      refreshLatest(),
    ])
  } finally { loading.value = false }
}
onMounted(() => { refresh(); timer = setInterval(refresh, 30000); latestTimer = setInterval(refreshLatest, 2000) })
onBeforeUnmount(() => { controller.abort(); clearInterval(timer); clearInterval(latestTimer) })
</script>

<template>
  <section class="page parameter-settings">
    <header class="parameter-heading"><div><h1>参数配置</h1><p>将后端参数逐项关联到前端名称、单位和监测点位。</p></div><div class="parameter-actions"><button @click="exportConfiguration">导出配置</button><button @click="importInput.click()">导入配置</button><button :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新后端参数' }}</button><input ref="importInput" hidden type="file" accept=".json,application/json" @change="importConfiguration" /></div></header>
    <p class="parameter-storage">配置保存在本机浏览器，所有账号及同源标签页共享；其他电脑可导入配置文件。单位仅修改显示标签，采样数值保持不变。</p>
    <p v-if="pointConfiguration.error || saveError" class="parameter-error" role="alert">{{ saveError || pointConfiguration.error }}</p>
    <p v-if="notice" class="parameter-success" role="status">{{ notice }}</p>
    <p v-for="(error, key) in errors" :key="key" class="parameter-error" role="alert">{{ key }}：{{ error }}（保留上次成功数据）</p>
    <div class="parameter-summary"><span>后端参数 <strong>{{ rows.length }}</strong></span><span>未配置 <strong>{{ unconfigured }}</strong></span><span>已配置 <strong>{{ rows.length - unconfigured }}</strong></span><span>大点位 <strong>{{ pointConfiguration.locations.length }}</strong></span><span>被测点位 <strong>{{ pointConfiguration.targets.length }}</strong></span></div>
    <details class="parameter-hierarchy"><summary>管理两级点位 <span>大点位 → 被测点位 → 参数</span></summary><div class="hierarchy-forms"><form @submit.prevent="addLocation"><h2>添加大点位</h2><label>所属机组<input v-model="newLocation.machine" list="parameter-machines" required /></label><label>大点位名称<input v-model="newLocation.name" placeholder="例如：排风机" required maxlength="80" /></label><button type="submit">添加大点位</button></form><form @submit.prevent="addTarget"><h2>添加被测点位</h2><label>所属大点位<select v-model="newTarget.locationId" required><option value="" disabled>选择大点位</option><option v-for="location in pointConfiguration.locations" :key="location.id" :value="location.id">{{ location.machine }} · {{ location.name }}</option></select></label><label>被测点位名称<input v-model="newTarget.name" placeholder="例如：电机驱动端轴承" required maxlength="80" /></label><button type="submit">添加被测点位</button></form></div><div class="hierarchy-list">
      <article v-for="location in pointConfiguration.locations" :key="location.id" class="hierarchy-location">
        <div class="hierarchy-location-heading"><strong>{{ location.machine }} · {{ location.name }}</strong><small>{{ childCount(location.id) }} 个被测点位 · {{ parameterCount(location.id) }} 项参数</small><small v-if="isFixedLocation(location.id)">系统固定</small><div v-else class="hierarchy-location-actions"><button type="button" :aria-label="'编辑大点位 '+location.name" @click="editLocation(location)">编辑</button><button type="button" :aria-label="'删除大点位 '+location.name" @click="beginDeletion(location)">删除</button></div></div>
        <div class="hierarchy-targets"><span v-for="target in pointConfiguration.targets.filter(item => item.locationId === location.id)" :key="target.id">{{ target.name }}</span><small v-if="!childCount(location.id)">尚无被测点位</small></div>
        <form v-if="locationEdit.id === location.id" class="hierarchy-edit" @submit.prevent="saveLocation"><label>编辑所属机组<input v-model="locationEdit.machine" list="parameter-machines" required maxlength="80" /></label><label>编辑大点位名称<input v-model="locationEdit.name" required maxlength="80" /></label><div><button type="submit">保存大点位</button><button type="button" @click="locationEdit.id = ''">取消编辑</button></div></form>
        <form v-if="deletion.id === location.id && deletingLocation" class="hierarchy-delete" aria-label="删除大点位确认" @submit.prevent="confirmDeletion"><p>删除「{{ location.name }}」将影响 {{ childCount(location.id) }} 个被测点位和 {{ parameterCount(location.id) }} 项参数配置。</p><label v-if="childCount(location.id) || parameterCount(location.id)">关联配置处理方式<select v-model="deletion.replacementId" required><option value="" disabled>请选择处理方式</option><option v-for="destination in pointConfiguration.locations.filter(item => item.id !== location.id)" :key="destination.id" :value="destination.id">迁移至 {{ destination.machine }} · {{ destination.name }}</option><option value="__unconfigured">删除关联被测点位，参数恢复未配置</option></select></label><p v-if="deletion.replacementId === '__unconfigured'">关联参数的前端名称、单位及归属配置将解除，后端参数和采样数据保留。</p><p v-else-if="deletion.replacementId">迁移保留参数名称和单位；目标大点位下同名被测点位会合并。</p><div><button type="submit">确认删除大点位</button><button type="button" @click="deletion.id = ''">取消删除</button></div></form>
      </article>
    </div></details>
    <datalist id="parameter-machines"><option v-for="machine in machineOptions" :key="machine" :value="machine" /></datalist>
    <div class="parameter-workspace">
      <section class="parameter-directory" aria-label="后端与前端参数对应表">
        <div class="parameter-filters"><input v-model="search" type="search" aria-label="搜索参数" placeholder="搜索后端名称、前端名称或编号" /><select v-model="source" aria-label="参数来源"><option value="all">全部来源</option><option value="legacy">采集参数</option><option value="monitor">声纹通道</option></select><select v-model="status" aria-label="配置状态"><option value="all">全部状态</option><option value="unconfigured">未配置</option><option value="configured">已配置</option></select></div>
        <div class="parameter-table-scroll"><table><thead><tr><th>后端参数 / 唯一标识</th><th>前端名称 / 点位归属</th><th>单位<br /><small>后端 → 前端</small></th><th>当前值</th><th>配置状态</th></tr></thead><tbody><tr v-for="row in visible" :key="row.key" :class="{ selected: selectedKey === row.key }"><td><button class="parameter-select" @click="selectedKey = row.key">{{ backendName(row) }}</button><small>{{ row.source === 'legacy' ? '采集' : '声纹' }} · {{ row.deviceId }} / {{ row.point.channelId }} / {{ row.point.pointCode || '声纹通道' }}</small><small v-if="row.point.pointId != null">pointId：{{ row.point.pointId }}</small><small v-if="!row.available">本次后端未返回，配置保留</small><small v-if="row.point.discoveredFromLatest">实时接口发现，目录尚未返回</small></td><td>{{ row.config?.displayName || '未配置' }}<small v-if="row.config">{{ locationName(row.config.locationId) }} → {{ targetName(row.config.targetId) }}</small></td><td>{{ row.point.unit || '无单位' }} → {{ row.config ? row.config.unit || '无单位' : '未配置' }}</td><td class="parameter-number">{{ sampleValue(row) }}</td><td><button class="parameter-badge" :class="{ pending: !row.config }" @click="selectedKey = row.key">{{ row.config ? '已配置 · 编辑' : '未配置 · 配置' }}</button></td></tr></tbody></table><p v-if="!filtered.length" class="parameter-empty">{{ loading ? '正在读取后端参数…' : '暂无匹配参数，请检查来源或调整筛选' }}</p></div>
        <footer class="parameter-pagination"><span>{{ filtered.length }} 项 · 第 {{ page }} / {{ pageCount }} 页</span><button :disabled="page <= 1" @click="page--">上一页</button><button :disabled="page >= pageCount" @click="page++">下一页</button></footer>
      </section>
      <aside class="parameter-editor" aria-label="参数配置编辑器">
        <h2>{{ selected ? '配置参数' : '选择一个参数' }}</h2>
        <template v-if="selected"><p class="parameter-origin">{{ backendName(selected) }}<small>{{ selected.deviceId }} / {{ selected.point.channelId }} / {{ selected.point.pointCode || '声纹通道' }}</small></p><form @submit.prevent="saveParameter"><label>前端名称<input v-model="editor.displayName" required maxlength="120" placeholder="输入监测页面显示的名称" /></label><label>显示单位<input v-model="editor.unit" list="parameter-units" maxlength="30" placeholder="无单位留空，可输入自定义单位" /></label><datalist id="parameter-units"><option v-for="unit in ['mm/s', 'm/s²', '°C', 'kPa', 'MPa', 'Pa', 'A', 'rpm', 'Hz', 'dB', '%']" :key="unit" :value="unit" /></datalist><label>一级：大点位<select v-model="editor.locationId" required><option value="" disabled>选择大点位</option><option v-for="location in pointConfiguration.locations" :key="location.id" :value="location.id">{{ location.machine }} · {{ location.name }}</option></select></label><label>二级：被测点位<select v-model="editor.targetId" required><option value="" disabled>选择被测点位</option><option v-for="target in targets" :key="target.id" :value="target.id">{{ target.name }}</option></select></label><p class="parameter-hint">同一个被测点位可关联多个参数，例如振动、温度和状态。缺少选项时在上方添加点位。</p><button class="parameter-save" type="submit">保存并同步</button><button type="button" @click="resetEditor">重置编辑</button><button v-if="selected.config" type="button" @click="clearParameter">恢复未配置</button></form></template>
        <p v-else class="parameter-hint">点击表格中的参数，逐项确认名称、单位及两级归属。新增参数不会自动套用其他参数的配置。</p>
      </aside>
    </div>
  </section>
</template>
