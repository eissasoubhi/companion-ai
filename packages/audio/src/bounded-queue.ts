export interface QueuePushResult<T> {
  readonly accepted: true;
  readonly dropped?: T | undefined;
}

/**
 * Keeps latency bounded by discarding the oldest queued item when capture is
 * faster than the consumer. For a live assistant, preserving recent audio is
 * preferable to building an ever-growing delayed transcript backlog.
 */
export class BoundedQueue<T> {
  readonly #capacity: number;
  readonly #items: T[] = [];
  #droppedCount = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Queue capacity must be a positive integer.');
    }
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#items.length;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get droppedCount(): number {
    return this.#droppedCount;
  }

  push(item: T): QueuePushResult<T> {
    let dropped: T | undefined;
    if (this.#items.length >= this.#capacity) {
      dropped = this.#items.shift();
      this.#droppedCount += 1;
    }
    this.#items.push(item);
    return dropped === undefined ? { accepted: true } : { accepted: true, dropped };
  }

  shift(): T | undefined {
    return this.#items.shift();
  }

  clear(): void {
    this.#items.length = 0;
  }
}
