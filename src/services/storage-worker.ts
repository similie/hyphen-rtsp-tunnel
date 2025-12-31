// storage-worker.ts
import fs from "node:fs";
import type { RtspTunnelEvents, SnapshotCapturedEvent } from "./events.js";
import type { StorageAdapter } from "./storage.js";
import { dayFromCapturedAt } from "./day.js";
type CtxLike = { log: (...args: any[]) => void };

export class StorageWorker {
  private running = false;
  private inFlight = 0;
  private queue: SnapshotCapturedEvent[] = [];
  private onCapturedBound: ((e: SnapshotCapturedEvent) => void) | null = null;

  constructor(
    private readonly ctx: CtxLike,
    private readonly events: RtspTunnelEvents,
    private readonly storage: StorageAdapter,
    private readonly concurrency = Number(
      process.env.STORAGE_CONCURRENCY ?? "2",
    ),
    private readonly deleteAfterStore = (process.env.STORAGE_DELETE_LOCAL ??
      "1") === "1",
  ) {}

  start() {
    if (this.running) return;
    this.running = true;

    this.onCapturedBound = (e) => {
      // cheap enqueue; never await here
      this.queue.push(e);
      this.pump();
    };

    this.events.on("snapshot:captured", this.onCapturedBound);
    this.ctx.log(
      `[rtsp-tunnel] storage worker started storage=${this.storage.name} concurrency=${this.concurrency}`,
    );
  }

  async stop() {
    if (!this.running) return;
    this.running = false;

    if (this.onCapturedBound) {
      this.events.off("snapshot:captured", this.onCapturedBound);
      this.onCapturedBound = null;
    }

    // wait a short window for in-flight tasks (best effort)
    const start = Date.now();
    while (this.inFlight > 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    this.queue = [];
    this.ctx.log("[rtsp-tunnel] storage worker stopped");
  }

  private pump() {
    if (!this.running) return;

    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inFlight++;

      (async () => {
        try {
          const day = dayFromCapturedAt(
            job.capturedAt,
            job.tzOffsetHours ?? null,
          );
          const stored = await this.storage.store({
            localPath: job.localPath,
            deviceId: job.deviceId,
            payloadId: job.payloadId,
            capturedAt: job.capturedAt,
            day,
          });

          // delete local file by default (configurable), unless adapter says otherwise
          const shouldDelete =
            this.deleteAfterStore && (stored.deleteLocal ?? true);
          if (shouldDelete) {
            try {
              fs.unlinkSync(job.localPath);
            } catch {}
          }

          this.events.emitStored({
            ...job,
            storage: stored.storage,
            storedUri: stored.storedUri,
            day,
            tzOffsetHours: job.tzOffsetHours ?? null,
          });
        } catch (e: any) {
          this.events.emitFailed({
            sessionId: job.sessionId,
            deviceId: job.deviceId,
            payloadId: job.payloadId,
            remote: job.remote,
            stage: "store",
            error: e?.message ?? String(e),
          });
        } finally {
          this.inFlight--;
          this.pump();
        }
      })();
    }
  }
}
