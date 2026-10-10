<script setup>
import { canSwitchDataMode, isDemoMode, setDemoMode } from '../services/dataMode.js'
</script>

<template>
  <div v-if="canSwitchDataMode || isDemoMode" class="data-mode-control" :class="{ demo: isDemoMode }">
    <span>{{ isDemoMode ? '演示数据' : '后端数据' }}</span>
    <el-switch v-if="canSwitchDataMode" :model-value="isDemoMode" aria-label="使用演示数据" @change="setDemoMode" />
  </div>
</template>

<style scoped>
.data-mode-control { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; padding: 4px 10px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--control-muted); font-size: 15px; }
.data-mode-control.demo { color: var(--control-text); border-color: var(--control-border-active); background: var(--control-bg-active); }
</style>
