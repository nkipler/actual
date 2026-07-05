import {
  coerceError,
  ERROR_CODES,
  fromTransferableError,
  getStableErrorCode,
  postWithFallback,
  rehydrateError,
  toTransferableError,
} from './transferable-error';

// Mimics Emscripten's `ErrnoError`: a non-`Error` object whose properties
// include a function, which makes `postMessage` throw `DataCloneError`.
function createErrnoLikeError() {
  return {
    name: 'ErrnoError',
    message: 'FS error',
    errno: 44,
    setErrno(errno: number) {
      return errno;
    },
  };
}

describe('toTransferableError', () => {
  it('serializes a non-cloneable error into a cloneable shape', () => {
    const transferable = toTransferableError(createErrnoLikeError());

    // The whole point: the serialized error survives structured cloning.
    expect(() => structuredClone(transferable)).not.toThrow();
    expect(transferable).toMatchObject({
      name: 'ErrnoError',
      message: 'FS error',
      code: 44,
    });
  });

  it('preserves message, reason, meta and stack of typed errors', () => {
    const error = Object.assign(new Error('PostError: unauthorized'), {
      type: 'PostError',
      reason: 'unauthorized',
      meta: { meta: 'extra' },
    });

    expect(toTransferableError(error)).toMatchObject({
      name: 'Error',
      type: 'PostError',
      message: 'PostError: unauthorized',
      reason: 'unauthorized',
      code: ERROR_CODES.INVALID_PASSWORD,
      meta: { meta: 'extra' },
    });
  });

  it('serializes the cause chain', () => {
    const error = new Error('Invalid JSON file.', {
      cause: 'json-parse-error',
    });

    expect(toTransferableError(error)).toMatchObject({
      message: 'Invalid JSON file.',
      cause: 'json-parse-error',
    });

    const nested = new Error('outer', { cause: error });
    expect(toTransferableError(nested)).toMatchObject({
      message: 'outer',
      cause: { message: 'Invalid JSON file.', cause: 'json-parse-error' },
    });
  });

  it('drops non-cloneable values from meta', () => {
    const error = Object.assign(new Error('boom'), {
      meta: { keep: 'me', fn: () => 'not-cloneable' },
    });

    const transferable = toTransferableError(error);
    expect(() => structuredClone(transferable)).not.toThrow();
    expect(transferable.meta).toEqual({ keep: 'me' });
  });

  it('handles thrown non-objects', () => {
    expect(toTransferableError('oops')).toEqual({
      name: 'Error',
      message: 'oops',
    });
  });
});

describe('getStableErrorCode', () => {
  it('maps semantic reasons to stable codes', () => {
    expect(getStableErrorCode('unauthorized')).toBe(
      ERROR_CODES.INVALID_PASSWORD,
    );
    expect(getStableErrorCode('token-expired')).toBe(
      ERROR_CODES.INVALID_PASSWORD,
    );
    expect(getStableErrorCode('network-failure')).toBe(ERROR_CODES.NETWORK);
    expect(getStableErrorCode('network')).toBe(ERROR_CODES.NETWORK);
    expect(getStableErrorCode('decrypt-failure')).toBe(
      ERROR_CODES.INVALID_FILE_KEY,
    );
    expect(getStableErrorCode('missing-key')).toBe(
      ERROR_CODES.INVALID_FILE_KEY,
    );
    expect(getStableErrorCode('budget-not-found')).toBe(ERROR_CODES.NOT_FOUND);
    expect(getStableErrorCode('some-other-reason')).toBeUndefined();
  });

  it('is applied to serialized errors via reason or exact message', () => {
    expect(
      toTransferableError(
        Object.assign(new Error('nope'), { reason: 'network-failure' }),
      ).code,
    ).toBe(ERROR_CODES.NETWORK);
    expect(toTransferableError(new Error('missing-key')).code).toBe(
      ERROR_CODES.INVALID_FILE_KEY,
    );
  });

  it('never overrides an explicit code', () => {
    const error = Object.assign(new Error('bank sync failed'), {
      code: 'ITEM_LOGIN_REQUIRED',
      reason: 'unauthorized',
    });
    expect(toTransferableError(error).code).toBe('ITEM_LOGIN_REQUIRED');
  });
});

describe('coerceError', () => {
  it('passes APIError objects through untouched', () => {
    const apiError = { type: 'APIError', message: 'No budget file is open' };
    expect(coerceError(apiError)).toBe(apiError);
  });

  it('wraps other errors as a ServerError with the serialized original as cause', () => {
    const coerced = coerceError(createErrnoLikeError());

    expect(() => structuredClone(coerced)).not.toThrow();
    expect(coerced).toMatchObject({
      type: 'ServerError',
      name: 'ErrnoError',
      message: 'FS error',
      code: 44,
      cause: { name: 'ErrnoError', message: 'FS error', code: 44 },
    });
  });
});

describe('rehydrateError', () => {
  it('rebuilds an Error carrying code, reason and stack', () => {
    const thrown = Object.assign(new Error('PostError: unauthorized'), {
      reason: 'unauthorized',
    });

    // Full wire round trip: serialize in the worker, structured-clone across
    // the boundary, rehydrate on the client.
    const received = rehydrateError(structuredClone(coerceError(thrown)));

    expect(received).toBeInstanceOf(Error);
    const error = received as Error & {
      type?: string;
      code?: string;
      reason?: string;
    };
    expect(error.message).toBe('PostError: unauthorized');
    expect(error.type).toBe('ServerError');
    expect(error.code).toBe(ERROR_CODES.INVALID_PASSWORD);
    expect(error.reason).toBe('unauthorized');
    expect(error.stack).toBe(thrown.stack);
  });

  it('rehydrates the cause chain into Error instances', () => {
    // Mirrors the dashboard-import contract relied on by the desktop client:
    // `error.cause` is the original thrown Error, whose own `cause` is a
    // string discriminator.
    const thrown = new Error('Invalid JSON file.', {
      cause: 'json-parse-error',
    });

    const received = rehydrateError(
      structuredClone(coerceError(thrown)),
    ) as Error;

    expect(received.cause).toBeInstanceOf(Error);
    const originalError = received.cause as Error;
    expect(originalError.message).toBe('Invalid JSON file.');
    expect(originalError.cause).toBe('json-parse-error');
  });

  it('keeps all fields own and enumerable like the historical plain object', () => {
    const received = fromTransferableError({
      name: 'Error',
      message: 'boom',
      code: 'NETWORK',
    });

    expect({ ...received }).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 'NETWORK',
    });
  });

  it('passes plain APIError objects through untouched', () => {
    const apiError = { type: 'APIError', message: 'nope' };
    expect(rehydrateError(apiError)).toBe(apiError);
  });
});

describe('postWithFallback', () => {
  function createStructuredClonePost() {
    const posted: unknown[] = [];
    return {
      posted,
      post(message: Record<string, unknown>) {
        // Real `postMessage` structured-clones the payload, so this throws
        // `DataCloneError` for non-cloneable messages just like a worker.
        posted.push(structuredClone(message));
      },
    };
  }

  it('posts cloneable messages as-is', () => {
    const { post, posted } = createStructuredClonePost();
    postWithFallback(post, { type: 'reply', id: '1', result: 42 }, false);
    expect(posted).toEqual([{ type: 'reply', id: '1', result: 42 }]);
  });

  it('falls back to a primitives-only error when the payload cannot be cloned', () => {
    const { post, posted } = createStructuredClonePost();
    postWithFallback(
      post,
      { type: 'error', id: '1', error: createErrnoLikeError() },
      false,
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'error',
      id: '1',
      error: {
        type: 'ServerError',
        name: 'ErrnoError',
        message: 'FS error',
        code: 44,
      },
    });
  });

  it('keeps the catchErrors reply shape in the fallback', () => {
    const { post, posted } = createStructuredClonePost();
    postWithFallback(
      post,
      {
        type: 'reply',
        id: '1',
        result: { error: createErrnoLikeError(), data: null },
        undoTag: 'undo-1',
      },
      true,
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: 'reply',
      id: '1',
      undoTag: 'undo-1',
      result: {
        data: null,
        error: { type: 'ServerError', message: 'FS error', code: 44 },
      },
    });
  });

  it('turns a non-cloneable success result into an error reply instead of hanging', () => {
    const { post, posted } = createStructuredClonePost();
    postWithFallback(
      post,
      { type: 'reply', id: '1', result: { fn: () => 'not-cloneable' } },
      false,
    );

    expect(posted).toHaveLength(1);
    const message = posted[0] as { type: string; error: { message: string } };
    expect(message.type).toBe('error');
    expect(typeof message.error.message).toBe('string');
  });
});
