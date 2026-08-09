const TRANSIENT_RPC_PATTERN = /fetch failed|unknown rpc error|http request failed|eai_again|enotfound|econnreset|etimedout|socket|network|dns|connection refused|service unavailable|gateway timeout/i

export class ExternalRpcBlockerError extends Error {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'ExternalRpcBlockerError'
    this.externalRpcBlocker = true
  }
}

export function isTransientRpcFailure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSIENT_RPC_PATTERN.test(message)
}

export function externalRpcBlocker(context, error) {
  const detail = error instanceof Error ? error.message : String(error)
  return new ExternalRpcBlockerError(`${context}: ${detail}`, { cause: error })
}

export function isExternalRpcBlocker(error) {
  return error instanceof ExternalRpcBlockerError || error?.externalRpcBlocker === true
}
