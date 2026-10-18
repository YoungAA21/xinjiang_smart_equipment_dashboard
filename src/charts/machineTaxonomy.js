export const machineCategories = [
  { id: 'ZJ17', name: 'ZJ17', models: ['ZJ17'] },
  { id: 'ZB25', name: 'ZB25主机', models: ['YB25'] },
  { id: 'ZB25-AUX', name: 'ZB25辅机', models: ['YB55', 'YB65', 'YB95'] },
]

export const machineCategoryId = value => {
  const id = String(value || '').normalize('NFKC').replace(/\s/g, '').toUpperCase()
  if (['ZJ17', 'ZJ117'].includes(id)) return 'ZJ17'
  if (['ZB25', 'ZB25主机', 'YB25'].includes(id)) return 'ZB25'
  if (['ZB25-AUX', 'ZB25辅机', 'YB55', 'YB65', 'YB95'].includes(id)) return 'ZB25-AUX'
  return ''
}
export const modelsForMachine = machine => machineCategories.find(item => item.id === machineCategoryId(machine))?.models || []
export const machineCategoryName = machine => machineCategories.find(item => item.id === machineCategoryId(machine))?.name || machine
export function machineModel(machine, model) {
  const models = modelsForMachine(machine)
  const candidate = String(model || machine || '').trim().toUpperCase()
  return models.includes(candidate) ? candidate : models[0] || ''
}

export const locationHierarchyLabel = (location = {}) => `${machineCategoryName(location.machine)} · ${location.model || machineModel(location.machine)} · ${location.name || ''}`
