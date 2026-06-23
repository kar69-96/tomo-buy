/**
 * Generic concurrency pool: N workers pull from a shared task queue.
 * Results preserve input order. Individual failures don't abort others.
 */
export async function concurrencyPool<TInput, TOutput>(
  tasks: TInput[],
  worker: (task: TInput, index: number) => Promise<TOutput>,
  concurrency: number,
): Promise<PromiseSettledResult<TOutput>[]> {
  if (tasks.length === 0) return [];

  const results: PromiseSettledResult<TOutput>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        const value = await worker(tasks[idx]!, idx);
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}
