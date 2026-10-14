<script setup>
import { computed, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { useAlarmColorsStore } from '../stores/alarmColors.js'
import { alarmSeverity, alarmKind, alarmIdentity, alarmColorName } from '../charts/alarmColors.js'

const props = defineProps({ events: { type: Array, default: () => [] } })
const colors = useAlarmColorsStore()
colors.ensureUser()
const open = ref(false)
const scope = ref('kind')
const target = ref('')
const selection = ref('yellow')
const savedMessage = ref('')
const options = computed(() => [...new Map(props.events.map(event => {
  const value = scope.value === 'alarm' ? alarmIdentity(event) : scope.value === 'kind' ? alarmKind(event) : alarmSeverity(event)
  return [value, { value, label: scope.value === 'alarm' ? `${event.name || event.reason || event.pointCode || '报警'} · ${event.startedAt || value}` : value }]
})).values()])
const ruleKey = computed(() => JSON.stringify([scope.value, target.value.trim()]))
const defaultSelection = computed(() => {
  const event = props.events.find(event => (scope.value === 'alarm' ? alarmIdentity(event) : scope.value === 'kind' ? alarmKind(event) : alarmSeverity(event)) === target.value.trim())
  return event ? alarmColorName(event) : 'yellow'
})
watch(scope, () => { target.value = '' })
watch([ruleKey, defaultSelection], ([key, defaultColor]) => { selection.value = colors.rules[key] || defaultColor; savedMessage.value = '' })
watch(() => colors.rules[ruleKey.value], value => { selection.value = value || defaultSelection.value })
function save() {
  if (!target.value.trim()) return
  colors.save(ruleKey.value, selection.value)
  savedMessage.value = colors.error ? '' : '已保存'
}
function reset() {
  colors.save(ruleKey.value, '')
  savedMessage.value = colors.error ? '' : '已恢复默认'
}
</script>

<template>
  <button type="button" class="alarm-colors-button" @click="open = true">颜色设置</button>
  <ElDialog v-model="open" title="报警颜色设置" width="540px" append-to-body class="alarm-colors-dialog">
    <div class="alarm-color-form">
      <label>设置范围<select v-model="scope" aria-label="颜色设置范围"><option value="kind">警种</option><option value="severity">报警级别</option><option value="alarm">单条报警</option></select></label>
      <label>{{ scope === 'alarm' ? '报警' : scope === 'kind' ? '警种' : '级别' }}<select v-if="scope === 'alarm'" v-model="target" aria-label="颜色配置对象"><option value="">请选择报警</option><option v-for="item in options" :key="item.value" :value="item.value">{{ item.label }}</option></select><input v-else v-model="target" list="alarm-color-options" aria-label="颜色配置对象" placeholder="选择或输入接口中的警种 / 级别" /><datalist id="alarm-color-options"><option v-for="item in options" :key="item.value" :value="item.value" /></datalist></label>
      <div class="color-options" role="group" aria-label="报警颜色"><button type="button" class="yellow" :aria-pressed="selection === 'yellow'" @click="selection = 'yellow'">黄色</button><button type="button" class="red" :aria-pressed="selection === 'red'" @click="selection = 'red'">红色</button></div>
      <p>单条报警优先于警种，警种优先于级别。配置仅影响显示颜色。</p>
      <p v-if="colors.error" role="alert">{{ colors.error }}</p>
      <p v-if="savedMessage" role="status">{{ savedMessage }}</p>
      <div class="color-form-actions"><button type="button" :disabled="!target.trim()" @click="reset">恢复默认</button><button type="button" :disabled="!target.trim()" @click="save">保存颜色</button></div>
    </div>
  </ElDialog>
</template>

<style>
:root { --alarm-color-yellow:#f3c45c; --alarm-color-red:#ff6565; }
:root.light-theme { --alarm-color-yellow:#a56e00; --alarm-color-red:#c73d3d; }
.alarm-colors-button { padding:5px 10px; font:inherit; color:var(--text-main); border:1px solid var(--glass-border); background:var(--control-bg); border-radius:4px; cursor:pointer; }
.alarm-color-form { display:grid; gap:15px; font-size:15px; }.alarm-color-form label { display:grid; gap:7px; }.alarm-color-form input,.alarm-color-form select { width:100%; min-height:36px; padding:5px 8px; font:inherit; color:var(--el-text-color-primary); background:var(--el-bg-color-overlay); border:1px solid var(--el-border-color); border-radius:4px; }.color-options,.color-form-actions { display:flex; gap:10px; }.color-form-actions { justify-content:flex-end; }.alarm-color-form button { padding:7px 18px; border:1px solid var(--el-border-color); background:var(--el-fill-color-blank); border-radius:5px; color:var(--el-text-color-primary); font:inherit; cursor:pointer; }.alarm-color-form button:disabled { opacity:.4; cursor:default; }.color-options .yellow { color:var(--alarm-color-yellow); }.color-options .red { color:var(--alarm-color-red); }.color-options button[aria-pressed=true] { border-color:currentColor; }.alarm-color-form p { margin:0; font-size:13px; color:var(--el-text-color-secondary); }
</style>
