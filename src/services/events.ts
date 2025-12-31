// events.ts
import { EventEmitter } from "node:events";

export type SnapshotCapturedEvent = {
  sessionId: string;
  deviceId: string;
  payloadId: string | null;
  remote: string;
  localPath: string;
  capturedAt: string; // ISO
  tzOffsetHours?: number | null;
};

export type SnapshotStoredEvent = SnapshotCapturedEvent & {
  storage: string;
  storedUri: string;
  day?: string;
};

export type SnapshotFailedEvent = {
  sessionId: string;
  deviceId: string;
  payloadId: string | null;
  remote: string;
  stage: "hello" | "auth" | "capture" | "proxy" | "unknown" | "store";
  error: string;
};

export class RtspTunnelEvents extends EventEmitter {
  emitCaptured(e: SnapshotCapturedEvent) {
    this.emit("snapshot:captured", e);
  }
  emitStored(e: SnapshotStoredEvent) {
    this.emit("snapshot:stored", e);
  }
  emitFailed(e: SnapshotFailedEvent) {
    this.emit("snapshot:failed", e);
  }
}
