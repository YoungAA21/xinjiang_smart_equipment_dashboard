// Display IDs are independent from existing data ownership identifiers.
export const productionLineTargets = {
  ZJ17: { machine: 'ZJ17', name: '卷接机' },
  YB25: { machine: 'ZB25', name: '小盒包装机' },
  YB55: { machine: 'YB55', name: '小盒透明纸包装机' },
  YB95: { machine: 'YB95', name: '条外透明纸包装机' },
}

export function productionLineTarget(id) {
  const target = Object.hasOwn(productionLineTargets, id) ? productionLineTargets[id] : null
  return target ? { path: '/monitor', query: { machine: target.machine } } : null
}
