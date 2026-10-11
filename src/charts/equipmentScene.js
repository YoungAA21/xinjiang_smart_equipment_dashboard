// Keep the scene within the viewport width; extra devices add rows vertically.
export function equipmentSceneLayout(count, viewportWidth, viewportHeight) {
  const total = Math.max(1, count)
  const width = Math.max(1, viewportWidth)
  const columns = 3
  const rows = Math.ceil(total / columns)
  const cellWidth = width / columns
  const nodeWidth = Math.max(1, cellWidth - 24)
  const best = { columns, rows, width, height: rows * 540 + 60, scale: 1, nodeWidth }
  return { ...best, positions: Array.from({ length: count }, (_, index) => ({
    left: (index % columns) * cellWidth + (cellWidth - nodeWidth) / 2,
    top: 30 + Math.floor(index / best.columns) * 540,
  })) }
}
