export interface WorkItem<T> {
  readonly value: T;
  readonly index: number;
}

export type WorkFn<T> = (item: WorkItem<T>) => Promise<void>;

export interface QueueOptions {
  readonly concurrency?: number;
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  worker: WorkFn<T>,
  options: QueueOptions = {}
): Promise<void> {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let cursor = 0;
  let active = 0;
  let rejectFn: ((error: unknown) => void) | null = null;

  const done = new Promise<void>((resolve, reject) => {
    rejectFn = reject;
    const maybeStartNext = () => {
      if (cursor >= items.length) {
        if (active === 0) {
          resolve();
        }
        return;
      }

      while (active < concurrency && cursor < items.length) {
        const index = cursor++;
        const value = items[index];
        active += 1;

        worker({ value, index })
          .catch((error) => {
            if (rejectFn) {
              rejectFn(error);
            }
          })
          .finally(() => {
            active -= 1;
            maybeStartNext();
          });
      }
    };

    maybeStartNext();
  });

  await done;
}
