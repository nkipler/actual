export type TransferableError = {
  type: string;
  message?: string;
  // Stable, machine-readable failure code (e.g. 'network-failure',
  // 'invalid-password', 'budget-not-found'). Sourced from the error's
  // `reason`/`code` and guaranteed to survive the boundary.
  code?: string;
  name?: string;
  stack?: string;
  meta?: unknown;
  cause?: unknown;
};

function getField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

function getStringField(error: unknown, field: string): string | undefined {
  const value = getField(error, field);
  return typeof value === 'string' ? value : undefined;
}

// Internal errors carry their machine-readable slug on `reason` (PostError,
// SyncError, …) or `code` (BankSyncError, Node system errors); `errno` covers
// Emscripten filesystem errors.
function getErrorCode(error: unknown): string | undefined {
  const code =
    getField(error, 'reason') ??
    getField(error, 'code') ??
    getField(error, 'errno');

  if (typeof code === 'string') {
    return code;
  }
  if (typeof code === 'number') {
    return String(code);
  }
  return undefined;
}

export function coerceError(error: unknown): TransferableError {
  const code = getErrorCode(error);

  if (getField(error, 'type') === 'APIError') {
    const apiError = error as TransferableError;
    return code == null ? apiError : { ...apiError, code };
  }

  return {
    type: 'ServerError',
    message: getStringField(error, 'message'),
    code,
    name: getStringField(error, 'name'),
    cause: error,
  };
}

// A reduced shape that is always structured-cloneable: `cause` (the original
// error) and `meta` are dropped, everything kept is a plain string.
export function toCloneableError(error: TransferableError): TransferableError {
  return {
    type: error.type,
    message: error.message,
    code: error.code,
    name: getStringField(error.cause, 'name') ?? error.name,
    stack: getStringField(error.cause, 'stack') ?? error.stack,
  };
}

// Post an error reply, falling back to the reduced cloneable shape if the
// structured clone fails. Without this, an error holding a non-cloneable
// value (e.g. an Emscripten ErrnoError, which carries methods) makes
// `postMessage` throw a DataCloneError in the worker — and the consumer sees
// that clone failure instead of the real cause.
export function postError(
  post: (message: unknown) => void,
  buildMessage: (error: TransferableError) => unknown,
  error: TransferableError,
): void {
  try {
    post(buildMessage(error));
  } catch {
    post(buildMessage(toCloneableError(error)));
  }
}
