import type * as Connection from './index';

// The real `postMessage` structured-clones the payload, which throws
// `DataCloneError` for objects holding functions. Reproduce that here so the
// tests exercise the exact failure mode seen in the browser worker.
function createServerChannel() {
  const posted: Array<Record<string, unknown>> = [];
  const messageListeners: Array<(event: { data: unknown }) => void> = [];

  return {
    posted,
    dispatch(data: unknown) {
      messageListeners.forEach(listener => listener({ data }));
    },
    addEventListener(
      _event: string,
      listener: (event: { data: unknown }) => void,
    ) {
      messageListeners.push(listener);
    },
    postMessage(message: Record<string, unknown>) {
      posted.push(structuredClone(message));
    },
  };
}

// Mimics Emscripten's `ErrnoError` (e.g. from a failing dataDir): its
// properties include a function, so it cannot be structured-cloned.
function createErrnoLikeError() {
  return {
    name: 'ErrnoError',
    message: 'FS error: EPERM',
    errno: 63,
    setErrno(errno: number) {
      return errno;
    },
  };
}

async function initConnection(handlers: Record<string, unknown>) {
  // The module resolves the worker global scope at load time.
  vi.stubGlobal('self', globalThis);
  const connection: typeof Connection = await import('./index');

  const channel = createServerChannel();
  connection.init(
    channel as unknown as Parameters<typeof Connection.init>[0],
    handlers as Parameters<typeof Connection.init>[1],
  );
  // Stop the reconnect interval right away.
  channel.dispatch({ name: 'client-connected-to-backend' });
  return channel;
}

async function waitForMessage(
  channel: { posted: Array<Record<string, unknown>> },
  predicate: (message: Record<string, unknown>) => boolean,
) {
  return vi.waitFor(() => {
    const message = channel.posted.find(predicate);
    expect(message).toBeDefined();
    return message as Record<string, unknown>;
  });
}

describe('web server connection', () => {
  it('surfaces the real error when the thrown error cannot be cloned', async () => {
    const channel = await initConnection({
      'test-throw': async () => {
        throw createErrnoLikeError();
      },
    });

    channel.dispatch({ id: 'req-1', name: 'test-throw', catchErrors: false });

    const message = await waitForMessage(channel, m => m.type === 'error');
    const error = message.error as Record<string, unknown>;

    // The client must see the original failure, not a DataCloneError from
    // the failed postMessage.
    expect(error.name).toBe('ErrnoError');
    expect(error.message).toBe('FS error: EPERM');
    expect(error.code).toBe(63);
    expect(error.type).toBe('ServerError');
  });

  it('surfaces the real error for catchErrors sends too', async () => {
    const channel = await initConnection({
      'test-throw': async () => {
        throw createErrnoLikeError();
      },
    });

    channel.dispatch({ id: 'req-2', name: 'test-throw', catchErrors: true });

    const message = await waitForMessage(
      channel,
      m => m.type === 'reply' && m.id === 'req-2',
    );
    const result = message.result as { error: Record<string, unknown> };

    expect(result.error.message).toBe('FS error: EPERM');
    expect(result.error.code).toBe(63);
  });

  it('attaches stable codes to semantic failures', async () => {
    const channel = await initConnection({
      'test-unauthorized': async () => {
        throw Object.assign(new Error('PostError: unauthorized'), {
          reason: 'unauthorized',
        });
      },
    });

    channel.dispatch({
      id: 'req-3',
      name: 'test-unauthorized',
      catchErrors: false,
    });

    const message = await waitForMessage(channel, m => m.type === 'error');
    const error = message.error as Record<string, unknown>;

    expect(error.message).toBe('PostError: unauthorized');
    expect(error.code).toBe('INVALID_PASSWORD');
    expect(error.reason).toBe('unauthorized');
  });

  it('replies with an error instead of hanging when a success result cannot be cloned', async () => {
    const channel = await initConnection({
      'test-bad-result': async () => {
        return { fn: () => 'not-cloneable' };
      },
    });

    channel.dispatch({
      id: 'req-4',
      name: 'test-bad-result',
      catchErrors: false,
    });

    const message = await waitForMessage(channel, m => m.type === 'error');
    const error = message.error as Record<string, unknown>;

    expect(message.id).toBe('req-4');
    expect(typeof error.message).toBe('string');
  });
});
