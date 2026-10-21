/**
 * Typed storage errors.
 *
 * Callers (pages/services) can distinguish quota exhaustion (recoverable by
 * pruning old sessions) from corruption (do not silently overwrite) and plain
 * write failures (retry/notify).
 */

export class StorageError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, key?: string, cause?: unknown, recoverable?: boolean }} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'StorageError'
    this.code = options.code || 'STORAGE_ERROR'
    this.key = options.key
    this.cause = options.cause
    this.recoverable = options.recoverable === true
  }
}

export class StorageQuotaError extends StorageError {
  /**
   * @param {string} message
   * @param {{ key?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: 'QUOTA_EXCEEDED', recoverable: true })
    this.name = 'StorageQuotaError'
  }
}

export class StorageWriteError extends StorageError {
  /**
   * @param {string} message
   * @param {{ code?: string, key?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'WRITE_FAILED' })
    this.name = 'StorageWriteError'
  }
}

export class StorageCorruptionError extends StorageError {
  /**
   * @param {string} message
   * @param {{ key?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: 'CORRUPT_DATA' })
    this.name = 'StorageCorruptionError'
  }
}

export class StorageValidationError extends StorageError {
  /**
   * @param {string} message
   * @param {{ code?: string, field?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code || 'INVALID_ARGUMENT' })
    this.name = 'StorageValidationError'
    this.field = options.field
  }
}

/**
 * Identify quota-style failures across uni-app/WeChat/App error shapes.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isQuotaError(error) {
  const message = String(
    (error && (error.errMsg || error.message)) || error || ''
  )
  return /quota|exceed|storage.*full|full.*storage|limit.*size|存储空间|超出|满了/i.test(message)
}
