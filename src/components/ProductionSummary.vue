<template>
  <section class="production-summary" aria-label="86号机台生产状态">
    <h2>86#机台</h2>
    <dl><div><dt>牌号</dt><dd>—</dd></div><div><dt>小盒产量</dt><dd>—</dd></div><div><dt>不合格数</dt><dd>—</dd></div><div><dt>NG 占比</dt><dd>—</dd></div></dl>
  </section>
</template>

<style scoped>
.production-summary { padding:12px 16px 9px; border-bottom:1px solid var(--line-border); }
.production-summary h2 { margin:0 0 10px; font-size:28px; font-weight:650; letter-spacing:1px; }.production-summary dl { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; margin:0; }.production-summary dt { font-size:14px; color:var(--line-soft); }.production-summary dd { margin:4px 0 0; font-size:25px; font-variant-numeric:tabular-nums; color:var(--line-text); line-height:1.1; }
@media(max-height:800px) { .production-summary { padding:9px 12px 7px; }.production-summary h2 { font-size:25px; margin-bottom:7px; }.production-summary dt { font-size:13px; }.production-summary dd { font-size:21px; } }
</style>
