import type { SnapshotStoredEvent, SnapshotFailedEvent } from "./events.js";
import type { ModuleContext } from "@similie/hyphen-command-server-types";
export type NotifierEventMap = {
  "snapshot:stored": SnapshotStoredEvent;
  "snapshot:failed": SnapshotFailedEvent;
};

export interface Notifier {
  /** If false, callers may skip work (optional optimization). */
  readonly enabled: boolean;
  init(ctx: ModuleContext): Promise<void> | void;
  /** Generic send hook. Implementations can switch on eventName. */
  send<K extends keyof NotifierEventMap>(
    eventName: K,
    payload: NotifierEventMap[K],
  ): Promise<void>;
}

export class NoopNotifier implements Notifier {
  readonly enabled = false;
  private ctx: ModuleContext | null = null;
  init(ctx: ModuleContext) {
    this.ctx = ctx;
  }
  async send<K extends keyof NotifierEventMap>(
    _eventName: K,
    _payload: NotifierEventMap[K],
  ): Promise<void> {
    // intentionally no-op
    this.ctx?.log(_eventName, _payload);
  }
}
