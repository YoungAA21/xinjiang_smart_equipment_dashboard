<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElAlert, ElDialog, ElForm, ElFormItem, ElMessage, ElMessageBox } from 'element-plus'
import { RefreshCcw, Search } from 'lucide-vue-next'
import { defaultDisplayNameRules, displayNameRules, displayNameStorageError, ruleKinds, saveDisplayNameRules } from '../services/displayNames.js'
import { monitoringCardMappings } from '../charts/displayNameMapping.js'
import { moduleDisplayName, monitoringPointName } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName, acousticCollectorDisplayName } from '../charts/machineGroups.js'
import { acousticDisplayContext } from '../charts/pointAddress.js'
import { telemetryApi } from '../services/telemetry.js'
import { api } from '../services/api'

const clone = value => JSON.parse(JSON.stringify(value))
const draft = ref(clone(displayNameRules.value))
const query = ref('')
const kind = ref('')
const machine = ref('')
const dialog = ref(false)
const editor = reactive({})
const editingIndex = ref(-1)
const counts = computed(() => Object.entries(ruleKinds).filter(([id]) => ['point', 'channel', 'name'].includes(id)).map(([id, label]) => ({ id, label, count: mergedRows.value.filter(row => row.kind === id).length })).filter(item => item.id !== 'name' || item.count))
const machineOptions = computed(() => [...new Set(mergedRows.value.map(row => row.machine).filter(Boolean))].sort())
function conditions(row) {
  if (row.kind === 'module') return [['模块编号', row.moduleId]]
  if (row.kind === 'point') return [['模块编号', row.moduleId], ['点位编码', row.pointCode], ['指标类型', row.metricType]]
  if (row.kind === 'collector') return [['采集器 IP', row.ip]]
  if (row.kind === 'channel') return [['采集器 IP', row.ip], ['通道编号', row.channelNumber]]
  return [['数据来源', row.source === 'legacy' ? '采集服务' : '声纹服务'], ['后端原名称', row.backendName]]
}
function edit(row) {
  editingIndex.value = draft.value.indexOf(row)
  if (editingIndex.value < 0) return
  for (const key of Object.keys(editor)) delete editor[key]
  Object.assign(editor, clone(row))
  dialog.value = true
}
function applyEdit() {
  try {
    const next = clone(draft.value)
    if (editingIndex.value < 0 || !next[editingIndex.value]) return
    // Backend selectors always come from the existing rule, never from the editor.
    next[editingIndex.value] = {
      ...next[editingIndex.value],
      displayName: editor.displayName,
      machine: editor.machine,
      note: editor.note,
    }
    if (persistConfiguration(next)) dialog.value = false
  } catch (error) { ElMessage.error(error.message) }
}
async function removeRow(row) {
  try { await ElMessageBox.confirm(`删除“${row.displayName}”的名称映射？删除后该条件将显示后端原名称。`, '删除映射', { type: 'warning', customClass: 'name-mapping-confirm' }) }
  catch { return }
  const next = draft.value.filter(item => item !== row)
  persistConfiguration(next)
}
async function restoreAll() {
  try { await ElMessageBox.confirm('将全部映射恢复为预置配置并立即生效。', '恢复默认配置', { type: 'warning', customClass: 'name-mapping-confirm' }) }
  catch { return }
  persistConfiguration(defaultDisplayNameRules())
}
function persistConfiguration(next) {
  try {
    saveDisplayNameRules(next)
    draft.value = clone(displayNameRules.value)
    ElMessage.success('已保存')
    return true
  } catch (error) {
    ElMessage.error(`保存失败：${error.message}`)
    return false
  }
}

const backendRows = ref([])
const loadErrors = ref([])
const loading = ref(false)
const loaded = ref(false)
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
const mergedRows = computed(() => monitoringCardMappings(draft.value, backendRows.value))
const visibleRows = computed(() => mergedRows.value.filter(row => (!kind.value || row.kind === kind.value)
  && (!machine.value || row.machine === machine.value)
  && JSON.stringify([row.rule || row, row.backendRecords.map(record => [record.backendName, record.moduleId, record.pointCode, record.ip, record.channelNumber, rowDisplay(record)])]).toLowerCase().includes(query.value.trim().toLowerCase())))
const backendNames = row => [...new Set(row.backendRecords.map(record => record.backendName))]
const editorSource = computed(() => draft.value[editingIndex.value])
const editorBackendNames = computed(() => {
  const row = mergedRows.value.find(row => row.rule === editorSource.value)
  return row ? backendNames(row) : []
})
const displayedName = row => row.rule?.displayName || row.backendRecords[0]?.backendName || '—'
function rowDisplay(row) {
  if (row.kind === 'module') return moduleDisplayName(row.raw)
  if (row.kind === 'point') return monitoringPointName(row.raw)
  if (row.kind === 'collector') return acousticCollectorDisplayName(row.ip, row.backendName)
  return acousticChannelDisplayName(row.device, row.raw)
}
async function loadBackend() {
  if (loading.value) return
  loading.value = true
  loadErrors.value = []
  const rows = []
  const errors = []
  const signal = controller.signal
  try {
    await Promise.all([
      (async () => {
        try {
          const result = await telemetryApi.getModules({ signal })
          const modules = result?.modules
          if (!Array.isArray(modules)) throw new Error('模块返回格式不正确')
          for (let i = 0; i < modules.length && !signal.aborted; i += 3) {
            await Promise.all(modules.slice(i, i + 3).map(async module => {
              try {
                const result = await telemetryApi.getModulePoints(module.moduleId, { signal })
                if (result?.moduleId !== module.moduleId || !Array.isArray(result.points)) throw new Error('点位返回格式不正确')
                for (const point of result.points) rows.push({ kind: 'point', moduleId: module.moduleId, pointCode: point.pointCode, metricType: point.metricType, backendName: point.name || point.pointCode, raw: { ...point, moduleId: module.moduleId } })
              } catch (error) { errors.push(`${module.moduleId}：${error.message}`) }
            }))
          }
        } catch (error) { errors.push(`采集服务：${error.message}`) }
      })(),
      (async () => {
        try {
          const devices = await api.getMonitorDevices({ signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
          if (!Array.isArray(devices)) throw new Error('设备返回格式不正确')
          for (const device of devices) {
            for (const channel of device.channels || []) rows.push({ kind: 'channel', ...acousticDisplayContext(device, channel), backendName: channel.name || channel.channelName || String(channel.channelId), raw: channel, device })
          }
        } catch (error) { errors.push(`声纹服务：${error.message}`) }
      })(),
    ])
    if (!signal.aborted) { backendRows.value = rows; loadErrors.value = errors; loaded.value = true }
  } finally { if (!signal.aborted) loading.value = false }
}
onMounted(loadBackend)
</script>

<template>
  <section class="name-settings">
    <header class="settings-heading">
      <h1>点位名称配置</h1>
    </header>
    <el-alert v-if="displayNameStorageError" type="error" :closable="false" :title="displayNameStorageError" />
    <div class="mapping-summary">
      <button v-for="item in counts" :key="item.id" :class="{ active: kind === item.id }" @click="kind = kind === item.id ? '' : item.id"><span>{{ item.label }}</span><strong>{{ item.count }}</strong></button>
    </div>
    <section class="panel mapping-panel">
      <div class="mapping-toolbar">
        <el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索" aria-label="搜索名称映射" class="mapping-search" />
        <el-select v-model="kind" clearable placeholder="全部类型" aria-label="筛选映射类型"><el-option v-for="item in counts" :key="item.id" :label="item.label" :value="item.id" /></el-select>
        <el-select v-model="machine" clearable placeholder="全部机组" aria-label="筛选机组"><el-option v-for="id in machineOptions" :key="id" :label="id" :value="id" /></el-select>
      </div>
      <div class="table-actions">
        <div><el-button :icon="RefreshCcw" :loading="loading" @click="loadBackend">{{ loaded ? '刷新后端名称' : '读取后端名称' }}</el-button><el-button :icon="RefreshCcw" @click="restoreAll">恢复默认</el-button></div>
      </div>
      <el-alert v-if="loadErrors.length" type="warning" :closable="false" title="后端名称读取失败"><div v-for="error in loadErrors" :key="error">{{ error }}</div></el-alert>
      <div class="mapping-table-container">
      <el-table :data="visibleRows" row-key="key" height="100%" scrollbar-always-on class="dark-table mapping-table" empty-text="暂无已配置的监测点位">
        <el-table-column label="类型 / 机组" width="200"><template #default="{ row }"><strong>{{ ruleKinds[row.kind] }}</strong><div>{{ row.machine || '—' }}</div></template></el-table-column>
        <el-table-column label="后端原名称" width="300"><template #default="{ row }">
          <div v-for="name in backendNames(row)" :key="name"><code>{{ name }}</code></div>
          <template v-if="!row.backendRecords.length"><code v-if="row.kind === 'name'">{{ row.backendName }}</code><span v-else>—</span></template>
        </template></el-table-column>
        <el-table-column label="后端匹配条件" width="300"><template #default="{ row }"><div v-for="[label, value] in conditions(row)" :key="label" class="condition"><span>{{ label }}</span><code>{{ value || '—' }}</code></div></template></el-table-column>
        <el-table-column label="前端显示名称" min-width="245"><template #default="{ row }"><strong class="display-name">{{ displayedName(row) }}</strong></template></el-table-column>
        <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }"><template v-if="row.rule"><el-button link type="primary" @click="edit(row.rule)">编辑</el-button><el-button link type="danger" @click="removeRow(row.rule)">删除</el-button></template><span v-else>—</span></template></el-table-column>
      </el-table>
      </div>
    </section>
    <el-dialog v-model="dialog" title="编辑名称映射" width="700px" class="name-mapping-dialog" :close-on-click-modal="false">
      <el-form label-position="top" @submit.prevent="applyEdit">
        <section v-if="editorSource" class="readonly-backend" aria-label="后端信息（只读）">
          <h3>后端信息</h3>
          <dl><div><dt>映射类型</dt><dd>{{ ruleKinds[editorSource.kind] }}</dd></div><div v-for="[label, value] in conditions(editorSource)" :key="label"><dt>{{ label }}</dt><dd><code>{{ value }}</code></dd></div><div v-if="editorBackendNames.length"><dt>后端原名称</dt><dd><div v-for="name in editorBackendNames" :key="name"><code>{{ name }}</code></div></dd></div></dl>
        </section>
        <el-form-item label="前端显示名称"><el-input v-model="editor.displayName" maxlength="300" /></el-form-item>
        <div class="editor-fields"><el-form-item label="机组备注"><el-input v-model="editor.machine" /></el-form-item><el-form-item label="说明"><el-input v-model="editor.note" /></el-form-item></div>
      </el-form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" @click="applyEdit">完成</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.name-settings { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; padding:8px 4px 24px; color:var(--control-text); font-size:18px; }
.settings-heading { display:flex; flex-shrink:0; align-items:center; justify-content:space-between; gap:20px; margin-bottom:18px; }
.settings-heading h1 { font-size:30px; margin:0 0 8px; }
.name-settings > .el-alert { flex-shrink:0; margin-bottom:12px; }
.mapping-summary { display:grid; flex-shrink:0; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:18px 0; }
.mapping-summary button { border:1px solid var(--glass-border); background:var(--glass-card); color:var(--control-text); border-radius:8px; padding:16px; text-align:left; cursor:pointer; }
.mapping-summary button.active { border-color:var(--control-border-active); background:var(--control-bg-active); }
.mapping-summary span { display:block; font-size:18px; margin-bottom:10px; }
.mapping-summary strong { font-size:32px; margin-right:10px; }
.mapping-panel { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; padding:20px; }
.mapping-panel > .el-alert { flex-shrink:0; max-height:120px; overflow:auto; margin-bottom:12px; }
.mapping-toolbar { display:flex; flex-shrink:0; align-items:center; gap:12px; margin-bottom:14px; }
.mapping-search { max-width:480px; }
.name-settings :deep(.el-button),.name-settings :deep(.el-input__inner),.name-settings :deep(.el-select__selected-item),.name-settings :deep(.el-select__placeholder) { font-size:18px; }
.name-settings :deep(.el-button:not(.is-link)),.name-settings :deep(.el-input__wrapper),.name-settings :deep(.el-select__wrapper) { min-height:38px; }
.mapping-toolbar .el-select { width:165px; }
.table-actions { display:flex; flex-shrink:0; align-items:center; gap:12px; flex-wrap:wrap; margin:6px 0 16px; justify-content:flex-end; }
.mapping-table-container { flex:1; min-height:0; overflow:hidden; }
.mapping-table { width:100%; margin:0; }
.mapping-table :deep(.cell) { line-height:1.8; font-size:17px; padding-top:7px; padding-bottom:7px; }
.condition { display:flex; gap:10px; align-items:baseline; }
.condition span { color:var(--control-muted); font-size:16px; flex:none; min-width:80px; }
code { font-family:Consolas,monospace; font-size:17px; overflow-wrap:anywhere; }
.display-name { font-size:18px; }
.readonly-backend { border:1px solid var(--popup-border); border-radius:8px; background:var(--popup-soft-bg); padding:14px 16px; margin-bottom:20px; }
.readonly-backend h3 { font-size:20px; color:var(--control-text); margin:0 0 12px; }
.readonly-backend dl { margin:0; display:grid; gap:8px; }
.readonly-backend dl > div { display:grid; grid-template-columns:100px minmax(0,1fr); gap:10px; }
.readonly-backend dt { color:var(--control-muted); font-size:17px; }
.readonly-backend dd { margin:0; color:var(--control-text); font-size:17px; overflow-wrap:anywhere; }
.editor-fields { display:grid; grid-template-columns:1fr 1fr; gap:0 18px; }
.editor-fields .el-input-number,.el-form .el-select { width:100%; }
@media(max-width:1300px) { .mapping-summary { gap:8px; }.mapping-summary button { padding:12px; }.mapping-panel { padding:14px; } }
</style>

<style>
.name-mapping-dialog .el-dialog__title { font-size:24px; }
.name-mapping-dialog .el-form-item__label,
.name-mapping-dialog .el-input__inner,
.name-mapping-dialog .el-button,
.name-mapping-confirm .el-message-box__message,
.name-mapping-confirm .el-button { font-size:18px; }
.name-mapping-dialog .el-input__wrapper,
.name-mapping-dialog .el-button,
.name-mapping-confirm .el-button { min-height:38px; }
.name-mapping-confirm .el-message-box__title { font-size:22px; }
.name-mapping-confirm { width:480px; }
</style>
