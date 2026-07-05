// @ts-strict-ignore
import { captureException } from '#platform/exceptions';
import { logger } from '#platform/server/log';
import { APIError } from '#server/errors';
import { isMutating, runHandler } from '#server/mutators';
import { coerceError, postWithFallback } from '#shared/transferable-error';

import type * as T from './index-types';

export const init: T.Init = function (_socketName, handlers) {
  process.parentPort.on('message', ({ data }) => {
    const { id, name, args, undoTag, catchErrors } = data;

    // Post via `postWithFallback` so a payload that cannot be
    // structured-cloned never masks the original result/error with a
    // `DataCloneError` thrown inside the backend process.
    const post = message => process.parentPort.postMessage(message);

    if (handlers[name]) {
      runHandler(handlers[name], args, { undoTag, name }).then(
        result => {
          if (catchErrors) {
            result = { data: result, error: null };
          }

          postWithFallback(
            post,
            {
              type: 'reply',
              id,
              result,
              mutated:
                isMutating(handlers[name]) &&
                name !== 'undo' &&
                name !== 'redo',
              undoTag,
            },
            catchErrors,
          );
        },
        nativeError => {
          const error = coerceError(nativeError);

          if (name.startsWith('api/')) {
            // The API is newer and does automatically forward
            // errors
            postWithFallback(post, { type: 'reply', id, error }, false);
          } else if (catchErrors) {
            postWithFallback(
              post,
              {
                type: 'reply',
                id,
                result: { error, data: null },
              },
              catchErrors,
            );
          } else {
            postWithFallback(post, { type: 'error', id, error }, false);
          }

          if (error.type === 'ServerError' && name !== 'api/load-budget') {
            captureException(nativeError);
          }

          if (!catchErrors) {
            // Notify the frontend that something bad happend
            send('server-error');
          }
        },
      );
    } else {
      logger.error('Unknown server method: ' + name);
      captureException(new Error('Unknown server method: ' + name));
      const unknownMethodError = APIError('Unknown server method: ' + name);

      if (catchErrors) {
        process.parentPort.postMessage({
          type: 'reply',
          id,
          result: { error: unknownMethodError, data: null },
        });
      } else {
        process.parentPort.postMessage({
          type: 'error',
          id,
          error: unknownMethodError,
        });
      }
    }
  });
};

export const getNumClients: T.GetNumClients = function () {
  return 0;
};

export const send: T.Send = function (name, args) {
  process.parentPort.postMessage({ type: 'push', name, args });
};

export const resetEvents: T.ResetEvents = function () {
  // resetEvents is used in tests to mock the server
};
