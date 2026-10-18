<script setup>
defineProps({ scope: { type: Object, required: true }, options: { type: Object, required: true }, loading: Boolean })
const emit = defineEmits(['change'])
const fields = [
  { key: 'machineId', label: '机组', all: '全部机组' },
  { key: 'modelId', label: '机型', all: '全部机型' },
  { key: 'locationId', label: '大点位', all: '全部大点位' },
  { key: 'targetId', label: '被测点位', all: '全部被测点位' },
  { key: 'parameterId', label: '参数', all: '全部参数' },
]
</script>

<template>
  <div class="alarm-point-filters">
    <label v-for="field in fields" :key="field.key"><span>{{ field.label }}</span>
      <el-select :model-value="scope[field.key]" :placeholder="field.all" filterable :aria-label="`告警${field.label}`" :loading="loading" @update:model-value="scope[field.key] = $event; emit('change', field.key)">
        <el-option :label="field.all" value="" />
        <el-option v-for="item in options[field.key]" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
    </label>
  </div>
</template>
