// Client-side autosave controller (framework-free so it can be unit tested).
//
// Rules:
// - One save request in flight at a time. The in-flight flag is released only
//   after the response is fully processed and the new version recorded, so a
//   follow-up save can never be sent with a stale baseVersion.
// - A failed save never discards content: the pending fields are marked dirty
//   again.
// - Network errors, 5xx and 401 retry automatically.
// - 409 (conflict), 404 (gone) and 403 halt saving: they cannot fix themselves.
// - 413/422 mean the current content was rejected. Saving pauses until the next
//   edit, which tries again. These never halt permanently.

export type SaveStatus =
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | "expired"
  | "conflict"
  | "gone"
  | "rejected";

export type AutosaveOptions = {
  docId: string;
  version: number;
  onStatus: (status: SaveStatus, detail?: string) => void;
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  retryMs?: number;
};

type SaveResponse = { version?: unknown; error?: { message?: string } };

export class Autosave {
  version: number;
  private content: unknown = null;
  private title = "";
  private dirtyContent = false;
  private dirtyTitle = false;
  private halted = false;
  private rerun = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private status: SaveStatus = "saved";
  private readonly opts: Required<Omit<AutosaveOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(opts: AutosaveOptions) {
    this.version = opts.version;
    this.opts = {
      debounceMs: 1500,
      retryMs: 10_000,
      ...opts,
      fetchImpl: opts.fetchImpl ?? ((...args) => fetch(...args)),
    };
  }

  /** True when nothing is pending and saving has not been halted. */
  get isClean() {
    return !this.dirtyContent && !this.dirtyTitle && !this.inFlight && !this.halted;
  }

  get isHalted() {
    return this.halted;
  }

  /** Records the latest editor content and schedules a save. */
  setContent(content: unknown) {
    this.content = content;
    this.markDirty("content");
  }

  /** Records the latest title and schedules a save. */
  setTitle(title: string) {
    this.title = title;
    this.markDirty("title");
  }

  /** Save now; resolves once any in-flight save and the pending save finish. */
  async flushNow(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight;
    await this.flush();
    if (this.inFlight) await this.inFlight;
    return this.isClean;
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private markDirty(field: "content" | "title") {
    if (this.halted) return;
    if (field === "content") this.dirtyContent = true;
    else this.dirtyTitle = true;
    if (this.status === "saved" || this.status === "rejected") this.setStatus("dirty");
    this.schedule(this.opts.debounceMs);
  }

  private setStatus(status: SaveStatus, detail?: string) {
    this.status = status;
    this.opts.onStatus(status, detail);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private flush(): Promise<void> {
    if (this.halted) return Promise.resolve();
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    if (!this.dirtyContent && !this.dirtyTitle) return Promise.resolve();

    this.inFlight = this.send().finally(() => {
      this.inFlight = null;
      if (this.rerun) {
        this.rerun = false;
        if (this.dirtyContent || this.dirtyTitle) this.schedule(0);
      }
    });
    return this.inFlight;
  }

  private async send() {
    const sendContent = this.dirtyContent;
    const sendTitle = this.dirtyTitle;
    this.dirtyContent = false;
    this.dirtyTitle = false;
    this.setStatus("saving");

    const body: Record<string, unknown> = { baseVersion: this.version };
    if (sendContent) body.content = this.content;
    if (sendTitle) body.title = this.title;

    let res: Response | null = null;
    let data: SaveResponse | null = null;
    try {
      res = await this.opts.fetchImpl(`/api/documents/${this.opts.docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = (await res.json()) as SaveResponse;
    } catch {
      data = null;
    }

    if (res?.ok && data && typeof data.version === "number") {
      this.version = data.version;
      if (this.dirtyContent || this.dirtyTitle) {
        this.setStatus("dirty");
        this.schedule(this.opts.debounceMs);
      } else {
        this.setStatus("saved");
      }
      return;
    }

    // Failure: nothing is discarded.
    if (sendContent) this.dirtyContent = true;
    if (sendTitle) this.dirtyTitle = true;

    if (!res || res.ok || res.status >= 500) {
      this.setStatus("error");
      this.schedule(this.opts.retryMs);
    } else if (res.status === 401) {
      this.setStatus("expired");
      this.schedule(this.opts.retryMs);
    } else if (res.status === 409) {
      this.halted = true;
      this.setStatus("conflict");
    } else if (res.status === 404) {
      this.halted = true;
      this.setStatus("gone");
    } else if (res.status === 403) {
      this.halted = true;
      this.setStatus("rejected", data?.error?.message ?? "This change is not allowed.");
    } else {
      // 413 / 422: rejected content. Wait for the next edit to try again.
      clearTimeout(this.timer);
      this.setStatus("rejected", data?.error?.message ?? "The server rejected this change.");
    }
  }
}
