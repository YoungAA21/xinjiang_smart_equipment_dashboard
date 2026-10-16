<script setup>
import { historyCacheStatus as status, historyWarmup } from '../services/historyWarmup.js'
</script>

<template>
  <div class="history-cache-status" role="status">
    <span :title="status.shift">{{ status.running ? '本班历史预热' : status.updatedAt ? '本班历史缓存' : '本班历史缓存待加载' }}<template v-if="status.total"> · {{ status.completed }} / {{ status.total }} 个测点</template></span>
    <span v-if="status.warning || status.errors.length" class="cache-warning" :title="[status.warning, ...status.errors].filter(Boolean).join('；')">{{ status.warning || `${status.errors.length} 项未完成，稍后重试` }}</span>
    <button v-if="!status.running && (status.errors.length || status.warning)" type="button" @click="historyWarmup.retry()">重试缓存</button>
  </div>
</template>

<style scoped>
.history-cache-status { display:flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--text-muted); font-size:12px; line-height:1.6; }
.cache-warning { color:var(--alarm-color-yellow, #c68733); }
button { padding:0; border:0; background:none; color:var(--text-main); font:inherit; text-decoration:underline; cursor:pointer; }
</style>
