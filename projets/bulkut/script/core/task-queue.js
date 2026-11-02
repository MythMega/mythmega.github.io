/**
 * Sequential task queue. The app intentionally uses a concurrency of one:
 * ffmpeg.wasm is single-threaded and GitHub Pages cannot serve the
 * cross-origin isolation headers needed by the multithreaded core.
 * @module core/task-queue
 */

export class TaskQueue {
  /** @type {Array<{ id: string, label: string, run: () => Promise<void>, resolve: () => void, reject: (error: unknown) => void }>} */
  #pending = [];
  #active = null;
  #activeCount = 0;
  /** @type {Set<(state: { busy: boolean, pending: number, activeLabel: string|null }) => void>} */
  #listeners = new Set();

  /** @param {{ concurrency?: number }} [options] */
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, concurrency);
  }

  /** @param {(state: { busy: boolean, pending: number, activeLabel: string|null }) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  get busy() {
    return this.#activeCount > 0 || this.#pending.length > 0;
  }

  get pendingCount() {
    return this.#pending.length;
  }

  snapshot() {
    return {
      busy: this.busy,
      pending: this.#pending.length,
      activeLabel: this.#active?.label ?? null,
    };
  }

  #emit() {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  /**
   * Queue a job. Resolves when the job has run.
   * @param {{ id: string, label: string, run: () => Promise<void> }} task
   * @returns {Promise<void>}
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.#pending.push({ ...task, resolve, reject });
      this.#emit();
      this.#pump();
    });
  }

  /**
   * Mark a job as finished *before* resolving its promise, so `queue.busy`
   * is already accurate when the caller resumes.
   * @param {{ id: string, label: string }} task
   */
  #finish(task) {
    this.#activeCount -= 1;
    if (this.#activeCount === 0) this.#active = null;
    this.#emit();
    this.#pump();
  }

  #pump() {
    while (this.#activeCount < this.concurrency && this.#pending.length > 0) {
      const task = this.#pending.shift();
      this.#activeCount += 1;
      this.#active = task;

      Promise.resolve()
        .then(task.run)
        .then(
          () => {
            this.#finish(task);
            task.resolve();
          },
          (error) => {
            this.#finish(task);
            task.reject(error);
          },
        );

      this.#emit();
    }
  }
}
