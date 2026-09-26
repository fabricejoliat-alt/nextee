export type AutosaveStatus = "clean" | "dirty" | "saving" | "error";

export type AutosaveSnapshot = {
  status: AutosaveStatus;
  revision: number;
  acknowledgedRevision: number;
  error: unknown | null;
};

type PendingValue<T> = {
  revision: number;
  value: T;
};

export class VersionedAutosaveQueue<T> {
  private readonly save: (value: T, revision: number) => Promise<void>;
  private readonly onChange?: (snapshot: AutosaveSnapshot) => void;
  private revision = 0;
  private acknowledgedRevision = 0;
  private pending: PendingValue<T> | null = null;
  private running: Promise<void> | null = null;
  private lastError: unknown | null = null;

  constructor(
    save: (value: T, revision: number) => Promise<void>,
    onChange?: (snapshot: AutosaveSnapshot) => void,
  ) {
    this.save = save;
    this.onChange = onChange;
  }

  enqueue(value: T) {
    this.revision += 1;
    this.pending = { revision: this.revision, value };
    this.lastError = null;
    this.emit();
    return this.revision;
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.pending) return Promise.resolve();

    this.running = this.drain().finally(() => {
      this.running = null;
      this.emit();
    });
    this.emit();
    return this.running;
  }

  getSnapshot(): AutosaveSnapshot {
    let status: AutosaveStatus = "clean";
    if (this.lastError) status = "error";
    else if (this.running) status = "saving";
    else if (this.pending || this.acknowledgedRevision < this.revision) status = "dirty";

    return {
      status,
      revision: this.revision,
      acknowledgedRevision: this.acknowledgedRevision,
      error: this.lastError,
    };
  }

  hasPendingChanges() {
    return this.pending !== null || this.acknowledgedRevision < this.revision;
  }

  private async drain() {
    while (this.pending) {
      const current = this.pending;
      this.pending = null;
      this.lastError = null;
      this.emit();

      try {
        await this.save(current.value, current.revision);
        this.acknowledgedRevision = Math.max(this.acknowledgedRevision, current.revision);
      } catch (error) {
        // A newer snapshot supersedes the failed one. Otherwise retain the failed
        // snapshot so an explicit retry or the browser's `online` event can save it.
        if (!this.pending || this.pending.revision < current.revision) {
          this.pending = current;
        }
        this.lastError = error;
        this.emit();
        throw error;
      }

      this.emit();
    }
  }

  private emit() {
    this.onChange?.(this.getSnapshot());
  }
}
