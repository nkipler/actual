/**
 * Helpers to move errors across the worker/IPC boundary with full fidelity.
 *
 * Errors thrown by backend handlers are posted to the client with
 * `postMessage`, which structured-clones the payload. Structured cloning
 * drops custom properties from `Error` instances (like `reason` on
 * `PostError`) and throws `DataCloneError` when the payload holds a function
 * (for example Emscripten's `ErrnoError`, whose properties include methods).
 * When that happens inside the worker, the clone failure replaces the real
 * error and the client only sees a meaningless `DataCloneError`.
 *
 * To avoid both problems, outbound errors are serialized into plain,
 * always-cloneable objects (`toTransferableError`) before posting, and
 * rehydrated into `Error` instances (`fromTransferableError`) on the client.
 */

/**
 * Stable codes for the most common failures. These are part of the public
 * error contract: consumers can branch on `error.code` instead of matching
 * `error.message` text, and these values stay stable across releases.
 */
export const ERROR_CODES = {
  /** The server rejected the credentials (bad password, expired token). */
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  /** The server could not be reached. */
  NETWORK: 'NETWORK',
  /** The file could not be encrypted/decrypted with the available key. */
  INVALID_FILE_KEY: 'INVALID_FILE_KEY',
  /** The requested file/budget does not exist. */
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Semantic reasons already produced by handlers (`PostError`,
// `FileDownloadError`, the encryption module, …) mapped to their stable
// public code.
const REASON_CODES: Record<string, ErrorCode> = {
  unauthorized: ERROR_CODES.INVALID_PASSWORD,
  'token-expired': ERROR_CODES.INVALID_PASSWORD,
  'invalid-password': ERROR_CODES.INVALID_PASSWORD,
  network: ERROR_CODES.NETWORK,
  'network-failure': ERROR_CODES.NETWORK,
  'decrypt-failure': ERROR_CODES.INVALID_FILE_KEY,
  'encrypt-failure': ERROR_CODES.INVALID_FILE_KEY,
  'missing-key': ERROR_CODES.INVALID_FILE_KEY,
  'old-key-style': ERROR_CODES.INVALID_FILE_KEY,
  'file-not-found': ERROR_CODES.NOT_FOUND,
  'budget-not-found': ERROR_CODES.NOT_FOUND,
  'not-found': ERROR_CODES.NOT_FOUND,
};

export type TransferableError = {
  name: string;
  message: string;
  type?: string;
  code?: string | number;
  reason?: string;
  meta?: unknown;
  stack?: string;
  cause?: unknown;
};

/**
 * Map a semantic reason (or exact error message) produced by handlers to its
 * stable public code, if it has one.
 */
export function getStableErrorCode(
  reasonOrMessage: string,
): ErrorCode | undefined {
  return REASON_CODES[reasonOrMessage];
}

// `cause` chains are serialized recursively; bound the depth so a cyclic
// chain cannot hang the worker.
const MAX_CAUSE_DEPTH = 3;

function getErrorCode(
  err: Record<string, unknown>,
): string | number | undefined {
  if (typeof err.code === 'string' || typeof err.code === 'number') {
    return err.code;
  }
  // Emscripten/Node FS errors carry the errno instead of a code.
  if (typeof err.errno === 'string' || typeof err.errno === 'number') {
    return err.errno;
  }
  if (typeof err.reason === 'string' && REASON_CODES[err.reason]) {
    return REASON_CODES[err.reason];
  }
  // Some failures are thrown as bare `new Error('missing-key')`-style
  // messages; only exact matches map to a code.
  if (typeof err.message === 'string' && REASON_CODES[err.message]) {
    return REASON_CODES[err.message];
  }
  return undefined;
}

// Reduce an arbitrary value to something structured cloning is guaranteed to
// accept, dropping functions and other non-serializable bits.
function toCloneable(value: unknown): unknown {
  if (
    value == null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function serializeError(error: unknown, depth: number): TransferableError {
  if (error == null || typeof error !== 'object') {
    return { name: 'Error', message: String(error) };
  }

  const err = error as Record<string, unknown>;
  const transferable: TransferableError = {
    name: typeof err.name === 'string' ? err.name : 'Error',
    message:
      typeof err.message === 'string'
        ? err.message
        : typeof err.reason === 'string'
          ? err.reason
          : String(error),
  };

  if (typeof err.type === 'string') {
    transferable.type = err.type;
  }
  const code = getErrorCode(err);
  if (code !== undefined) {
    transferable.code = code;
  }
  if (typeof err.reason === 'string') {
    transferable.reason = err.reason;
  }
  if (typeof err.stack === 'string') {
    transferable.stack = err.stack;
  }
  if (err.meta !== undefined) {
    transferable.meta = toCloneable(err.meta);
  }
  if (err.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    transferable.cause =
      typeof err.cause === 'object' && err.cause !== null
        ? serializeError(err.cause, depth + 1)
        : toCloneable(err.cause);
  }

  return transferable;
}

/**
 * Serialize an error into a plain object that structured cloning always
 * accepts, preserving the message, semantic fields (`code`/`reason`/`meta`)
 * and the `cause` chain.
 */
export function toTransferableError(error: unknown): TransferableError {
  return serializeError(error, 0);
}

/**
 * Like {@link toTransferableError}, but reduced to primitive fields only.
 * The result can never fail to clone, so it is used as the last-resort
 * payload when posting a message fails.
 */
export function toMinimalTransferableError(error: unknown): TransferableError {
  const {
    meta: _meta,
    cause: _cause,
    ...primitives
  } = toTransferableError(error);
  return primitives;
}

export function isTransferableError(
  value: unknown,
): value is TransferableError {
  if (typeof value !== 'object' || value === null || value instanceof Error) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' && typeof candidate.message === 'string'
  );
}

/**
 * Rebuild an `Error` instance from its serialized form so client code can
 * rely on `instanceof Error`, `error.code`, and the `cause` chain. All fields
 * are defined as own enumerable properties because the historical wire format
 * was a plain object and consumers may spread or serialize the value.
 */
export function fromTransferableError(transferable: TransferableError): Error {
  const error = new Error(transferable.message);

  for (const [key, value] of Object.entries(transferable)) {
    if (value === undefined) {
      continue;
    }
    Object.defineProperty(error, key, {
      value:
        key === 'cause' && isTransferableError(value)
          ? fromTransferableError(value)
          : value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return error;
}

/**
 * Rehydrate a rejected error received from the worker. Serialized errors
 * become `Error` instances; anything else (like plain `APIError` objects) is
 * passed through untouched.
 */
export function rehydrateError(error: unknown): unknown {
  return isTransferableError(error) ? fromTransferableError(error) : error;
}

/**
 * Coerce an error thrown by a handler into the shape posted to the client.
 * `APIError`s pass through as-is; everything else becomes a `ServerError`
 * carrying the serialized original error as `cause` (mirroring the historical
 * shape, where `cause` held the thrown error) plus its semantic fields
 * (`code`/`reason`) at the top level.
 */
export function coerceError(error: unknown): Record<string, unknown> {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>).type === 'APIError'
  ) {
    return error as Record<string, unknown>;
  }

  const transferable = toTransferableError(error);
  return {
    type: 'ServerError',
    name: transferable.name,
    message: transferable.message,
    ...(transferable.code !== undefined ? { code: transferable.code } : {}),
    ...(transferable.reason !== undefined
      ? { reason: transferable.reason }
      : {}),
    ...(transferable.stack !== undefined ? { stack: transferable.stack } : {}),
    cause: transferable,
  };
}

/**
 * Post a message to the client, falling back to a primitives-only error when
 * the payload cannot be structured-cloned. This guarantees a clone failure
 * (`DataCloneError`) can never mask the original error, and that the client
 * promise always settles.
 */
export function postWithFallback(
  post: (message: Record<string, unknown>) => void,
  message: Record<string, unknown>,
  catchErrors: boolean,
): void {
  try {
    post(message);
  } catch (cloneError) {
    const result = message.result as Record<string, unknown> | undefined;
    const originalError =
      message.error !== undefined
        ? message.error
        : catchErrors
          ? result?.error
          : undefined;

    const error = {
      type: 'ServerError',
      ...toMinimalTransferableError(
        originalError !== undefined ? originalError : cloneError,
      ),
    };

    if (catchErrors) {
      post({ ...message, error: undefined, result: { error, data: null } });
    } else {
      post({ type: 'error', id: message.id, error });
    }
  }
}
