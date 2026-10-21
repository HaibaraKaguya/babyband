/**
 * Key/value storage port helpers.
 *
 * The repository depends on a tiny synchronous port (`get`/`set`/`remove`)
 * rather than on `uni` directly, so it can run under `node --test` with an
 * in-memory adapter and can be replaced by an App SQLite store later.
 */

/**
 * @typedef {import('../types/dataContracts.js').KeyValueStorage} KeyValueStorage
 */

/**
 * @param {unknown} adapter
 * @returns {KeyValueStorage}
 */
export function assertKeyValueStorage(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('storage adapter must be an object with get/set/remove')
  }
  for (const method of ['get', 'set', 'remove']) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`storage adapter is missing method "${method}"`)
    }
  }
  return adapter
}

/**
 * Wrap the synchronous uni-app storage API. `uni.getStorageSync` returns `''`
 * for a missing key; the repository treats that as absent.
 *
 * @param {any} uniLike
 * @returns {KeyValueStorage}
 */
export function createUniKeyValueStorage(uniLike) {
  if (!uniLike) {
    throw new TypeError('createUniKeyValueStorage requires the uni global')
  }
  return {
    get(key) {
      return uniLike.getStorageSync(key)
    },
    set(key, value) {
      uniLike.setStorageSync(key, value)
    },
    remove(key) {
      uniLike.removeStorageSync(key)
    }
  }
}
