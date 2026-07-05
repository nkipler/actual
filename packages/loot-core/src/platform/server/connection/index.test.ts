import { beforeAll, describe, expect, test, vi } from 'vitest';

import { APIError, PostError } from '#server/errors';

// The global test setup mocks the client connection; this test exercises the
// real web client/server pair across a fake worker channel.
vi.unmock('#platform/client/connection');

type MessageListener = (event: { data: unknown }) => void;

// Minimal in-memory stand-in for the worker channel. `structuredClone`
// mirrors the serialization `postMessage` performs, including throwing a
// DataCloneError for non-cloneable values (functions, methods, ...).
function createFakeWorkerChannel() {
  const serverListeners: MessageListener[] = [];

  const clientSocket = {
    onmessage: null as MessageListener | null,
    // client -> server
    postMessage(message: unknown) {
      const data = structuredClone(message);
      serverListeners.forEach(listener => listener({ data }));
    },
  };

  const serverChannel = {
    addEventListener(_event: string, listener: MessageListener) {
      serverListeners.push(listener);
    },
    // server -> client
    postMessage(message: unknown) {
      const data = structuredClone(message);
      clientSocket.onmessage?.({ data });
    },
  };

  return { clientSocket, serverChannel };
}

// Mimics Emscripten's ErrnoError: not an Error instance and carrying a
// method, which structured clone refuses to serialize.
function createNonCloneableError() {
  return {
    name: 'ErrnoError',
    message: 'FS error',
    errno: 44,
    setErrno(value: number) {
      this.errno = value;
    },
  };
}

const handlers = {
  'api/reject-with-reason': async () => {
    throw new PostError('network-failure');
  },
  'api/reject-non-cloneable': async () => {
    throw createNonCloneableError();
  },
  'api/reject-api-error': async () => {
    throw APIError('No budget file is open');
  },
  'reject-plain': async () => {
    throw new PostError('unauthorized');
  },
};

let send: (name: string, args?: unknown) => Promise<unknown>;
let sendCatch: (name: string, args?: unknown) => Promise<unknown>;

beforeAll(async () => {
  // The web server connection resolves its global object from `self`.
  Object.assign(globalThis, { self: globalThis });

  const serverConnection = await import('./index');
  const clientConnection = await import('#platform/client/connection');

  const { clientSocket, serverChannel } = createFakeWorkerChannel();
  serverConnection.init(
    serverChannel as unknown as Parameters<typeof serverConnection.init>[0],
    handlers as unknown as Parameters<typeof serverConnection.init>[1],
  );
  await clientConnection.init(
    clientSocket as unknown as Parameters<typeof clientConnection.init>[0],
  );

  send = clientConnection.send as typeof send;
  sendCatch = clientConnection.sendCatch as typeof sendCatch;
});

describe('worker boundary error serialization', () => {
  test('the machine-readable code survives to the client rejection', async () => {
    await expect(send('api/reject-with-reason')).rejects.toMatchObject({
      type: 'ServerError',
      message: 'PostError: network-failure',
      code: 'network-failure',
    });
  });

  test('the code also survives on sendCatch results', async () => {
    const result = await sendCatch('reject-plain');
    expect(result).toMatchObject({
      data: null,
      error: {
        type: 'ServerError',
        message: 'PostError: unauthorized',
        code: 'unauthorized',
      },
    });
  });

  test('APIError envelopes pass through unchanged', async () => {
    await expect(send('api/reject-api-error')).rejects.toEqual({
      type: 'APIError',
      message: 'No budget file is open',
    });
  });

  test('a non-cloneable error still surfaces its message and code instead of a DataCloneError', async () => {
    const rejection = send('api/reject-non-cloneable').then(
      () => {
        throw new Error('expected rejection');
      },
      error => error,
    );
    await expect(rejection).resolves.toMatchObject({
      type: 'ServerError',
      message: 'FS error',
      name: 'ErrnoError',
      code: '44',
    });
    // The non-cloneable original error must have been dropped
    await expect(rejection).resolves.not.toHaveProperty('cause');
  });
});
