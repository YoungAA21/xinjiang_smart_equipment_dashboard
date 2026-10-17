<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { productionLineTarget } from '../charts/productionLineTargets.js'
import { productionLineLayout, productionLineViewBox } from '../charts/productionLineLayout.js'
import darkPlan from '../../public/production-line/01-real-dark.svg?raw'
import lightPlan from '../../public/production-line/02-real-light.svg?raw'
import flatPlan from '../../public/production-line/03-real-flat.svg?raw'

const props = defineProps({ variant: { type: String, default: 'dark' }, navigate: { type: Boolean, default: true }, selected: String, machines: { type: Array, default: () => [] } })
const emit = defineEmits(['select', 'alarm'])
const router = useRouter()
const plans = { dark: darkPlan, light: lightPlan, flat: flatPlan }
const plan = computed(() => plans[props.variant] || darkPlan)

function selectMachine(event) {
  const link = event.target.closest?.('a[data-machine]')
  if (!link) return
  const id = link.getAttribute('data-machine')
  const target = productionLineTarget(id)
  if (!target) return
  // Preserve normal browser behavior for modified clicks and new-tab navigation.
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('select', id)
  if (props.navigate) router.push(target)
}
const footprints = Object.fromEntries(productionLineLayout.map(machine => [machine.id, machine]))
const statuses = computed(() => props.machines.filter(machine => footprints[machine.id]).map(machine => ({ ...footprints[machine.id], ...machine })))
function selectAlarm(machine) {
  if (machine.health === 'alarm') emit('alarm', machine.id)
}
</script>

<template>
  <!-- Generated local SVG is trusted source; links remain keyboard accessible. -->
  <div class="site-production-plan">
    <div class="plan-art" @click="selectMachine" v-html="plan"></div>
    <svg v-if="machines.length" class="plan-status-overlay" :viewBox="productionLineViewBox" aria-label="机组状态">
      <g v-for="machine in statuses" :key="machine.id">
        <rect v-if="selected === machine.id" class="flow-selection" :x="machine.x-10" :y="machine.y-10" :width="machine.w+20" :height="machine.h+20" rx="6" />
        <g :transform="`translate(${machine.sx} ${machine.sy})`" class="machine-health" :class="machine.health" :role="machine.health === 'alarm' ? 'button' : undefined" :tabindex="machine.health === 'alarm' ? 0 : undefined" :aria-label="`${machine.id} ${machine.healthLabel}${machine.alarmCount ? ' ' + machine.alarmCount + ' 条' : ''}`" @click="selectAlarm(machine)" @keydown.enter.prevent="selectAlarm(machine)" @keydown.space.prevent="selectAlarm(machine)">
          <rect x="-8" y="-23" width="190" height="38" rx="5" /><circle cx="5" cy="-4" r="5" /><text x="19" y="4">{{ machine.healthLabel }}{{ machine.alarmCount ? ' · ' + machine.alarmCount : '' }}</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.site-production-plan { position:relative; width:100%; height:100%; min-height:0; }
.plan-art { width:100%; height:100%; }
.site-production-plan :deep(svg) { display:block; width:100%; height:100%; }
.plan-status-overlay { position:absolute; inset:0; pointer-events:none; }
.flow-selection { fill:none; stroke:#75d9ba; stroke-width:2.7; stroke-dasharray:9 7; animation:selection-flow 1.4s linear infinite; }
.machine-health rect { fill:var(--line-surface,#122019); stroke:var(--line-border,#365546); }.machine-health circle { fill:#81998b; }.machine-health text { fill:#81998b; font:24px 'Microsoft YaHei',sans-serif; }.machine-health.normal text,.machine-health.normal circle { fill:#69cf9d; }.machine-health.alarm { pointer-events:auto; cursor:pointer; }.machine-health.alarm text,.machine-health.alarm circle { fill:#f3c45c; }.machine-health.alarm rect { stroke:#f3c45c; }.machine-health:focus-visible { outline:none; }.machine-health:focus-visible rect { stroke-width:3; }
@keyframes selection-flow { to { stroke-dashoffset:-64; } }
@media(prefers-reduced-motion:reduce) { .flow-selection { animation:none; } }
</style>
