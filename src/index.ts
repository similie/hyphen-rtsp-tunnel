import type { HyphenModule } from "@similie/hyphen-command-server-types";
import {
  RtspTunnelGateway,
  S3StorageAdapter,
  LocalStorageAdapter,
  StorageWorker,
  SqsNotifier,
  NoopNotifier,
  type Notifier,
} from "./services/index.js";

function buildNotifierFromEnv(): Notifier {
  // Not implementing SQS yet — just leaving the slot.
  // Example rule later:
  if (process.env.SQS_QUEUE_URL && process.env.AWS_REGION)
    return new SqsNotifier();

  return new NoopNotifier();
}

const moduleImpl: HyphenModule = {
  name: "rtsp-tunnel",
  version: "1.0.0",
  async init(ctx) {
    ctx.log("[rtsp-tunnel] init");
    ctx.ellipsies.pgManager.datasource;
    // --- choose storage adapter by env ---
    const mode = process.env.STORAGE_MODE ?? "local";
    const storage =
      mode === "s3"
        ? new S3StorageAdapter(
            process.env.S3_BUCKET ?? "",
            process.env.S3_PREFIX ?? "hyphen/rtsp",
          )
        : new LocalStorageAdapter();

    const gateway = new RtspTunnelGateway(ctx);
    const storageWorker = new StorageWorker(ctx, gateway.events, storage);

    const notifier = buildNotifierFromEnv();
    await notifier.init(ctx);
    // event -> notifier (does nothing if NoopNotifier)
    gateway.events.on("snapshot:stored", async (e) => {
      try {
        ctx.log("[rtsp-tunnel] snapshot stored event", { event: e });
        await notifier.send("snapshot:stored", e);
      } catch (err: any) {
        ctx.log("[rtsp-tunnel] notifier error (stored)", err);
      }
    });

    gateway.events.on("snapshot:failed", async (e) => {
      try {
        ctx.log("[rtsp-tunnel] snapshot failed event", { event: e });
        await notifier.send("snapshot:failed", e);
      } catch (err: any) {
        ctx.log("[rtsp-tunnel] notifier error (failed)", err);
      }
    });

    const startAll = async () => {
      // leader gating
      if (ctx.leader && !ctx.leader.amLeader()) {
        ctx.log("[rtsp-tunnel] not leader; gateway not started");
        return;
      }

      // IMPORTANT: start worker first so we never miss captured events
      storageWorker.start();
      await gateway.start();
    };

    const stopAll = async () => {
      await gateway.stop();
      await storageWorker.stop();
    };

    // // Leader hooks (if present)
    if (ctx.leader) {
      ctx.leader.on("elected", async () => {
        ctx.log("[rtsp-tunnel] leader elected; starting gateway+worker");
        await startAll();
      });

      ctx.leader.on("revoked", async () => {
        ctx.log("[rtsp-tunnel] leader revoked; stopping gateway+worker");
        await stopAll();
      });

      ctx.leader.on("error", (err: any) => {
        ctx.log("[rtsp-tunnel] leader error", err?.message ?? err);
        // do not stop automatically; your choice
      });
    }

    // Start now (leader or single-node)
    await startAll();

    return {
      shutdown: async () => {
        ctx.log("[rtsp-tunnel] shutdown");
        await stopAll();
      },
    };
  },
};

export default moduleImpl;
