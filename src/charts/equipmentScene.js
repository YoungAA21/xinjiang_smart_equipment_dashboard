// Keep the scene within the viewport width; extra devices add rows vertically.
export function equipmentSceneLayout(count, viewportWidth, viewportHeight) {
  const total = Math.max(1, count)
  const width = Math.max(1, viewportWidth)
  const columns = 3
  const rows = Math.ceil(total / columns)
  const cellWidth = width / columns
  const nodeWidth = Math.max(1, cellWidth - 24)
  const rowPitch = Math.max(1, viewportHeight) / 3
  const nodeHeight = Math.max(1, rowPitch - 12)
  const best = { columns, rows, width, height: rows * rowPitch, scale: 1, nodeWidth, nodeHeight, rowPitch }
  return { ...best, positions: Array.from({ length: count }, (_, index) => ({
    left: (index % columns) * cellWidth + (cellWidth - nodeWidth) / 2,
    top: 6 + Math.floor(index / best.columns) * rowPitch,
  })) }
}
