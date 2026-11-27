export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** Runs tasks one at a time in call order, even if a task rejects. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
