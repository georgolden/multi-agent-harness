export const ensureError = (err: unknown): Error => {
  if (err instanceof Error) return err;
  return new Error(String(err));
};

/**
 * Wraps a function in a try-catch block and returns a tuple with [error, result]
 * @param fn Function to wrap
 * @returns A function that returns [Error | null, ReturnType<typeof fn> | undefined]
 */
export const toErrorFirst = <T extends (...args: any[]) => any>(
  fn: T
): ((...args: Parameters<T>) => [Error | undefined, ReturnType<T> | undefined]) => {
  return (...args: Parameters<T>): [Error | undefined, ReturnType<T> | undefined] => {
    try {
      const result = fn(...args);
      return [undefined, result];
    } catch (error) {
      return [ensureError(error), undefined];
    }
  };
};

/**
 * Wraps an async function in a try-catch block and returns a tuple with [error, result]
 * @param fn Async function to wrap
 * @returns A function that returns Promise<[Error | null, Awaited<ReturnType<typeof fn>> | undefined]>
 */
export const toErrorFirstAsync = <T extends (...args: any[]) => Promise<any>>(
  fn: T
): ((...args: Parameters<T>) => Promise<[Error | undefined, Awaited<ReturnType<T>> | undefined]>) => {
  return async (...args: Parameters<T>): Promise<[Error | undefined, Awaited<ReturnType<T>> | undefined]> => {
    try {
      const result = await fn(...args);
      return [undefined, result];
    } catch (error) {
      return [ensureError(error), undefined];
    }
  };
};

export class ErrorResult<T> {
  error: Error | undefined;
  result: T | undefined;

  constructor({ error, result }: { error?: Error; result?: T }) {
    this.error = error || undefined;
    this.result = result || undefined;
  }
}

/**
 * Creates a wrapper that converts an async function to use the ErrorResult pattern
 * @param asyncFn Async function that returns T or Error
 * @returns A function that returns Promise<ErrorResult<T>> with appropriate error/result fields
 */
export const toSafeAsyncErrorResult = <T, Args extends any[]>(
  fn: (...args: Args) => T | Promise<T> | Error
): ((...args: Args) => Promise<ErrorResult<T>>) => {
  return async (...args: Args): Promise<ErrorResult<T>> => {
    const asyncErrFirst = toErrorFirstAsync(async (...args: Args) => Promise.resolve(fn(...args)));
    const [error, res] = await asyncErrFirst(...args);

    if (error) {
      console.error(error);
      return new ErrorResult({ error });
    }

    if (res?.constructor?.name === 'Error') {
      console.error(res);
      return new ErrorResult({ error: res as Error });
    }

    return new ErrorResult({ result: res as T });
  };
};

/**
 * Creates a wrapper that converts a sync function to use the ErrorResult pattern
 * @param syncFn Synchronous function that returns T or Error
 * @returns A function that returns ErrorResult<T> with appropriate error/result fields
 */
export const toSafeSyncErrorResult = <T, Args extends any[]>(
  syncFn: (...args: Args) => T | Error
): ((...args: Args) => ErrorResult<T>) => {
  return (...args: Args): ErrorResult<T> => {
    const syncErrFirst = toErrorFirst(syncFn);
    const [error, res] = syncErrFirst(...args);

    if (error) return new ErrorResult({ error });

    if (res instanceof Error) {
      return new ErrorResult({ error: res as Error });
    }

    return new ErrorResult({ result: res as T });
  };
};

export class ErrorWarnResult<T> extends ErrorResult<T> {
  warn: Error | undefined;

  constructor({ error, warn, result }: { error?: Error; warn?: Error; result?: T }) {
    super({ error, result });
    this.warn = warn || undefined;
  }
}

/**
 * Creates a wrapper that converts an async function to use the ErrorWarnResult pattern
 * @param asyncFn Async function that returns T or Error
 * @returns A function that returns Promise<ErrorWarnResult<T>> with appropriate error/warning/result fields
 */
export const toSafeAsyncErrorWarnResult = <T, Args extends any[]>(
  asyncFn: (...args: Args) => Promise<T | Error>
): ((...args: Args) => Promise<ErrorWarnResult<T>>) => {
  return async (...args: Args): Promise<ErrorWarnResult<T>> => {
    const asyncErrFirst = toErrorFirstAsync(asyncFn);
    const [error, res] = await asyncErrFirst(...args);

    if (error) return new ErrorWarnResult({ error });

    if (res instanceof Error) {
      return new ErrorWarnResult({ warn: res as Error });
    }

    return new ErrorWarnResult({ result: res as T });
  };
};

export const runSafe = async <T>(promise: Promise<T>): Promise<ErrorResult<T>> => {
  try {
    const result = await promise;
    return new ErrorResult({ result });
  } catch (err) {
    return new ErrorResult({ error: ensureError(err) });
  }
};
