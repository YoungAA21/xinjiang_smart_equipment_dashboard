// Status groups remain configured but are not measurement detail tabs.
export const pointLayoutLocations = locations => locations.filter(location =>
  !/^(CH(?:双包)?剔除状态|高低速指示|小包外观(?:剔除状态)?)$/i.test(String(location.name || '').replace(/\s/g, '')))

export function detailTabLocations(locations, ids) {
  const eligible = pointLayoutLocations(locations)
  if (!Array.isArray(ids)) return eligible
  return ids.map(id => eligible.find(location => location.id === id)).filter(Boolean)
}
