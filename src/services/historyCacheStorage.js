export function createHistoryCacheStorage(indexedDB = globalThis.indexedDB) {
  let opening
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('IndexedDB unavailable')); return }
      const request = indexedDB.open('equipment_shift_history_v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('blocks', { keyPath: 'key' })
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('历史缓存被其他页面阻塞'))
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); opening = null }
        resolve(request.result)
      }
    })
    return opening
  }
  async function transaction(mode, action) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blocks', mode)
      let result
      const request = action(tx.objectStore('blocks'))
      if (request) request.onsuccess = () => { result = request.result }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('缓存事务已取消'))
    })
  }
  return {
    get: key => transaction('readonly', store => store.get(key)),
    put: value => transaction('readwrite', store => store.put(value)),
    prune: shiftStart => transaction('readwrite', store => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (cursor.value.shiftStart !== shiftStart) cursor.delete()
        cursor.continue()
      }
    }),
  }
}
