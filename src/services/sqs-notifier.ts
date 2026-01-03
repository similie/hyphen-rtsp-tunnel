import {
  SQSClient,
  SendMessageCommand,
  type SendMessageCommandInput,
} from "@aws-sdk/client-sqs";
import type { ModuleContext } from "@similie/hyphen-command-server-types";
import type { Notifier, NotifierEventMap } from "./notifier.js";

type AnyEvent = NotifierEventMap[keyof NotifierEventMap];

/**
 * Env:
 *  - SQS_QUEUE_URL (required)
 *  - AWS_REGION (required)
 *
 * Credentials:
 *  - resolved automatically by AWS SDK (env / instance role / task role / etc.)
 */
export class SqsNotifier implements Notifier {
  public readonly enabled: boolean;

  private sqs: SQSClient | null = null;
  private queueUrl: string | null = null;
  private isFifo = false;

  private ctx: ModuleContext | null = null;

  constructor() {
    const queueUrl = process.env.SQS_QUEUE_URL?.trim();
    const region = process.env.AWS_REGION?.trim();

    if (!queueUrl || !region) {
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.queueUrl = queueUrl;
    this.isFifo = queueUrl.endsWith(".fifo");

    this.sqs = new SQSClient({ region });
  }

  init(ctx: ModuleContext) {
    this.ctx = ctx;
    if (!this.enabled) {
      return this.ctx.log(
        "[rtsp-tunnel][sqs] disabled (missing SQS_QUEUE_URL or AWS_REGION)",
      );
    }

    this.ctx.log("[rtsp-tunnel][sqs] enabled queue=", {
      queueUrl: this.queueUrl,
    });
  }

  async shutdown(): Promise<void> {
    // AWS SDK v3 clients have destroy() to close sockets
    try {
      this.sqs?.destroy();
    } catch {}
    this.sqs = null;
  }

  async send<K extends keyof NotifierEventMap>(
    eventName: K,
    payload: NotifierEventMap[K],
  ): Promise<void> {
    // this.ctx?.log("[rtsp-tunnel][sqs] send called", { eventName, payload });
    if (!this.enabled || !this.sqs || !this.queueUrl) return;

    // Build a consistent message envelope
    const msg = this.buildMessage(eventName, payload);

    const params: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(msg),
    };

    // FIFO-safe handling
    if (this.isFifo) {
      params.MessageDeduplicationId = msg.deduplicationId;
      params.MessageGroupId = msg.groupId;
    }

    try {
      await this.sqs.send(new SendMessageCommand(params));
      this.ctx?.log("[rtsp-tunnel][sqs] sent", {
        eventName,
        groupId: msg.groupId,
      });
    } catch (err: any) {
      this.ctx?.log("[rtsp-tunnel][sqs] send failed", {
        eventName,
        error: err?.message ?? err,
      });
      throw err;
    }
  }

  // ----------------- internals -----------------

  private buildMessage(eventName: keyof NotifierEventMap, payload: AnyEvent) {
    // Prefer payloadId for grouping, then deviceId.
    const groupId =
      (payload as any).payloadId || (payload as any).deviceId || "hyphen";

    // Dedup: prefer payloadId if present; otherwise sessionId; otherwise a stable fallback.
    // (SQS FIFO requires <= 128 chars; we keep it simple.)
    const deduplicationId =
      (payload as any).payloadId ||
      (payload as any).sessionId ||
      `${(payload as any).deviceId || "unknown"}:${eventName}:${
        (payload as any).capturedAt || (payload as any).at || ""
      }`;

    // For stored snapshots, include storedUri if your storage worker attaches it.
    // For now, it may be undefined and that’s fine.
    const storedUri = (payload as any).storedUri;

    return {
      version: 1,
      source: "hyphen-rtsp-tunnel",
      event: eventName,
      capturedAt: (payload as any).capturedAt || null,
      at: (payload as any).at || null,

      deviceId: (payload as any).deviceId || "unknown",
      payloadId: (payload as any).payloadId ?? null,
      sessionId: (payload as any).sessionId || null,
      remote: (payload as any).remote || null,

      // file paths/uris
      localPath: (payload as any).localPath || null,
      storedUri: storedUri || null,

      // failure details (for snapshot:failed)
      stage: (payload as any).stage || null,
      error: (payload as any).error || null,

      // FIFO helpers
      groupId,
      deduplicationId,
    };
  }
}
