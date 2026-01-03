import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import { RtspTunnelEvents } from "./events.js";
import { DeviceAuth } from "./device-auth.js";
import {
  type ModuleContext,
  RedisCache,
} from "@similie/hyphen-command-server-types";
import { sanitizeTzOffsetHours } from "./day.js";
type Session = {
  id: string;
  ws: WebSocket;
  remote: string;

  deviceId: string;
  helloAt: number | null;
  payloadId: string | null;
  // auth handshake
  nonceB64: string | null;
  authed: boolean;

  // capture state
  captureActive: boolean;
  proxySock: net.Socket | null;
  ffmpeg: ChildProcess | null;
  tzOffsetHours: number | null;
  helloTimer: NodeJS.Timeout | null;
  closed: boolean;
  cleanup: (why: string) => void;
};

export type RtspTunnelTunnelParams = {
  camUser: string;
  camPass: string;
  rtspPath: string;
};

export class RtspTunnelGateway {
  private readonly ctx: ModuleContext;
  public readonly events = new RtspTunnelEvents();
  // ---- config (env-driven, generic) ----
  private readonly wsPort = Number(process.env.WS_PORT ?? "7443");
  private readonly proxyPort = Number(process.env.PROXY_PORT ?? "8554");

  private readonly wsTls = (process.env.WS_TLS ?? "0") === "1";
  private readonly tlsCert = process.env.TLS_CERT ?? "";
  private readonly tlsKey = process.env.TLS_KEY ?? "";

  private readonly camUser = process.env.CAM_USER ?? "admin";
  private readonly camPass = process.env.CAM_PASS ?? "";
  private readonly rtspPath = process.env.RTSP_PATH ?? "/stream2";

  private readonly outDir =
    process.env.OUT_DIR ??
    path.join(os.tmpdir(), "hyphen-rtsp-tunnel", "snapshots");

  private readonly autoCapture = (process.env.AUTO_CAPTURE ?? "1") === "1";
  private readonly requireAuth = (process.env.REQUIRE_AUTH ?? "0") === "1";

  private readonly helloWaitMs = Number(process.env.HELLO_WAIT_MS ?? "2000");
  private readonly captureTimeoutMs = Number(
    process.env.CAPTURE_TIMEOUT_MS ?? "45000",
  );

  // ---- runtime ----
  private server: http.Server | https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private proxyServer: net.Server | null = null;
  private auth: DeviceAuth;
  private sessions = new Map<string, Session>();
  //   private sensors = new Map<string, any>();
  private globalCaptureInFlight = false;
  private globalCaptureSessionId: string | null = null;

  private started = false;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.auth = new DeviceAuth(ctx as any);
  }

  private deviceSensorsKey(identity: string) {
    return `rtsp-tunnel:device-sensors:${identity}`;
  }

  private deviceIdKey(identity: string) {
    return `rtsp-tunnel:device-id:${identity}`;
  }

  private async pullDevice(identity: string) {
    const key = this.deviceIdKey(identity);
    const stored = await RedisCache.get<any>(key);
    if (stored) {
      return stored;
    }
    const device = await this.auth.device(identity);
    await RedisCache.set(key, device);
    return device || {};
  }

  async pullDeviceTimezoneOffsetHours(
    identity: string,
  ): Promise<number | null> {
    const device = await this.pullDevice(identity);
    const { tzOffsetHours = null } = device || {};
    return sanitizeTzOffsetHours(tzOffsetHours);
  }

  async pullDeviceSensorMeta(identity: string) {
    const key = this.deviceSensorsKey(identity);
    const stored = await RedisCache.get<any>(key);
    if (stored) {
      return stored;
    }
    const { values } = await this.auth.deviceSensors(identity);
    await RedisCache.set(key, values);
    return values;
    //
  }

  async start() {
    if (this.started) return;
    this.started = true;

    fs.mkdirSync(this.outDir, { recursive: true });

    // Create HTTP or HTTPS server
    this.server = this.wsTls ? this.makeHttpsServer() : http.createServer();

    // WS server
    this.wss = new WebSocketServer({
      server: this.server,
      maxPayload: 8 * 1024 * 1024,
    });

    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));

    await new Promise<void>((resolve) => {
      this.server!.listen(this.wsPort, "0.0.0.0", () => resolve());
    });

    // Local TCP proxy
    this.proxyServer = net.createServer((sock) => this.onProxyConnection(sock));
    await new Promise<void>((resolve) => {
      this.proxyServer!.listen(this.proxyPort, "127.0.0.1", () => resolve());
    });

    this.ctx.log(
      `[rtsp-tunnel] gateway started wsPort=${this.wsPort} tls=${
        this.wsTls ? "on" : "off"
      } proxyPort=${this.proxyPort}`,
    );
  }

  async stop() {
    if (!this.started) return;
    this.started = false;

    // Clean sessions
    for (const s of this.sessions.values()) {
      try {
        s.cleanup("gateway_stop");
      } catch {}
    }
    this.sessions.clear();

    // Close proxy
    if (this.proxyServer) {
      await new Promise<void>((resolve) =>
        this.proxyServer!.close(() => resolve()),
      );
      this.proxyServer = null;
    }

    // Close wss + server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    this.globalCaptureInFlight = false;
    this.globalCaptureSessionId = null;

    this.ctx.log("[rtsp-tunnel] gateway stopped");
  }

  // ------------------- internals -------------------

  private makeHttpsServer() {
    if (!this.tlsCert || !this.tlsKey) {
      throw new Error("WS_TLS=1 requires TLS_CERT and TLS_KEY");
    }
    return https.createServer({
      cert: fs.readFileSync(this.tlsCert),
      key: fs.readFileSync(this.tlsKey),
    });
  }

  private newSessionId() {
    return crypto.randomBytes(8).toString("hex");
  }

  private safeDeviceId(id: string) {
    return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "unknown";
  }

  private mkOutFile(deviceId: string) {
    const dir = path.join(this.outDir, this.safeDeviceId(deviceId));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(
      dir,
      `snap-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
    );
  }

  private isWsOpen(ws: WebSocket) {
    return ws.readyState === WebSocket.OPEN;
  }

  private sendOpen(ws: WebSocket) {
    // OPEN signal only; device uses build-flag camera host/port.
    try {
      ws.send(Buffer.from([3]));
    } catch {}
  }

  private sendClose(ws: WebSocket) {
    try {
      ws.send(Buffer.from([4]));
    } catch {}
  }

  private sendText(ws: WebSocket, s: string) {
    try {
      ws.send(s);
    } catch {}
  }

  private makeNonceB64() {
    return crypto.randomBytes(24).toString("base64");
  }

  // ---- AUTH HOOK (stub) ----
  // Later: use ctx + ellipsies/models to load public key by deviceId and verify signature.
  private async verifyAuth(
    deviceId: string,
    nonceB64: string,
    sigB64: string,
  ): Promise<boolean> {
    return this.auth.verify(deviceId, nonceB64, sigB64);
  }

  private async pullCameraProfile(identity: string): Promise<any> {
    const sensorMeta = (await this.pullDeviceSensorMeta(identity)) || {};
    if (!sensorMeta || !Object.keys(sensorMeta).length) {
      return null;
    }

    for (const s in sensorMeta) {
      const meta = sensorMeta[s]?.meta || {};
      if (!meta) {
        continue;
      }
      const keys = Object.keys(meta);
      if (
        keys.includes("RTSP_PATH") ||
        keys.includes("CAM_USER") ||
        keys.includes("CAM_PASS")
      ) {
        return meta;
      }
    }

    return null;
  }

  private async buildTunnelParams(
    identity: string,
  ): Promise<RtspTunnelTunnelParams> {
    const cmProfile = await this.pullCameraProfile(identity);
    // console.log("[rtsp-tunnel] buildTunnelParams cmProfile=", { cmProfile });
    const defProfile = {
      camUser: cmProfile.CAM_USER || this.camUser,
      camPass: cmProfile.CAM_PASS || this.camPass,
      rtspPath: cmProfile.RTSP_PATH || this.rtspPath,
    };
    return defProfile;
  }

  private async captureOnce(
    session: Session,
    params: RtspTunnelTunnelParams,
  ): Promise<string> {
    if (!this.camPass) throw new Error("CAM_PASS is required");
    if (!this.isWsOpen(session.ws)) throw new Error("WS not open");
    if (session.captureActive)
      throw new Error("Session capture already active");
    if (this.globalCaptureInFlight)
      throw new Error("Global capture already in progress");

    if (this.requireAuth && !session.authed)
      throw new Error("Not authenticated");

    this.globalCaptureInFlight = true;
    this.globalCaptureSessionId = session.id;
    session.captureActive = true;

    const outFile = this.mkOutFile(session.deviceId);

    const rtspUrl = `rtsp://${encodeURIComponent(
      params.camUser,
    )}:${encodeURIComponent(params.camPass)}@127.0.0.1:${this.proxyPort}${
      params.rtspPath
    }`;
    // console.log("[rtsp-tunnel] captureOnce rtspUrl=", { rtspUrl });
    const code = await new Promise<number>((resolve) => {
      const ff = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-rtsp_transport",
          "tcp",
          "-i",
          rtspUrl,

          "-an", // no audio
          "-frames:v",
          "1",
          "-q:v",
          "3",

          "-update",
          "1", // <-- single image output
          outFile,
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
      );

      session.ffmpeg = ff;

      const timer = setTimeout(() => {
        try {
          ff.kill("SIGKILL");
        } catch {}
      }, this.captureTimeoutMs);

      ff.on("close", (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });

      ff.on("error", () => {
        clearTimeout(timer);
        resolve(1);
      });
    });

    session.captureActive = false;
    session.ffmpeg = null;

    this.globalCaptureInFlight = false;
    this.globalCaptureSessionId = null;

    if (code !== 0) {
      if (this.isWsOpen(session.ws)) this.sendClose(session.ws);
      throw new Error(`ffmpeg failed (exit ${code})`);
    }

    if (!fs.existsSync(outFile))
      throw new Error("ffmpeg success but file not found");

    return outFile;
  }

  private maybeAutoCapture(session: Session) {
    if (!this.autoCapture) return;
    if (!this.isWsOpen(session.ws)) return;
    if (session.captureActive) return;
    if (this.globalCaptureInFlight) return;

    if (session.deviceId === "unknown") return;
    if (this.requireAuth && !session.authed) return;

    (async () => {
      try {
        this.ctx.log("[rtsp-tunnel] auto capture start", {
          device: session.deviceId,
          session: session.remote,
        });
        const params = await this.buildTunnelParams(session.deviceId);
        const file = await this.captureOnce(session, params);

        const capturedAt = new Date().toISOString();

        this.events.emitCaptured({
          sessionId: session.id,
          deviceId: session.deviceId,
          payloadId: session.payloadId,
          remote: session.remote,
          localPath: file,
          capturedAt,
          tzOffsetHours: session.tzOffsetHours ?? null,
        });
        this.ctx.log("[rtsp-tunnel] auto capture saved", file);

        // snapshot-window behavior
        try {
          session.ws.close();
        } catch {}
      } catch (e: any) {
        this.ctx.log("[rtsp-tunnel] auto capture error", e?.message ?? e);
        try {
          session.ws.close();
        } catch {}

        this.events.emitFailed({
          sessionId: session.id,
          deviceId: session.deviceId,
          payloadId: session.payloadId,
          remote: session.remote,
          stage: "capture",
          error: e?.message ?? "unknown error",
        });
      }
    })();
  }

  private parseHello(
    msg: string,
  ): { payloadId: string | null; deviceId: string } | null {
    const parts = msg.trim().split(/\s+/);
    if (parts.length < 2) return null;

    if ((parts[0] || "").toUpperCase() !== "HELLO") return null;

    // HELLO <deviceId>
    if (parts.length === 2) {
      ``;
      return { payloadId: null, deviceId: parts[1] || "" };
    }

    // HELLO <payloadId> <deviceId>
    return { payloadId: parts[1] || null, deviceId: parts[2] || "" };
  }

  private onConnection(ws: WebSocket, req: any) {
    const remote = req?.socket?.remoteAddress ?? "unknown";
    const id = this.newSessionId();

    const session: Session = {
      id,
      ws,
      remote,

      deviceId: "unknown",
      helloAt: null,
      payloadId: null,
      nonceB64: null,
      authed: false,

      captureActive: false,
      proxySock: null,
      ffmpeg: null,
      tzOffsetHours: null,
      helloTimer: null,
      closed: false,
      cleanup: () => {},
    };

    this.sessions.set(id, session);
    this.ctx.log("[rtsp-tunnel] device connected", { remote, id: `sid=${id}` });

    // READY hook
    this.sendText(ws, "READY");

    const cleanup = (why: string) => {
      if (session.closed) return;
      session.closed = true;

      if (session.helloTimer) {
        clearTimeout(session.helloTimer);
        session.helloTimer = null;
      }

      if (session.ffmpeg) {
        try {
          session.ffmpeg.kill("SIGKILL");
        } catch {}
        session.ffmpeg = null;
      }

      if (session.proxySock) {
        try {
          session.proxySock.destroy();
        } catch {}
        session.proxySock = null;
      }

      if (
        this.globalCaptureInFlight &&
        this.globalCaptureSessionId === session.id
      ) {
        this.globalCaptureInFlight = false;
        this.globalCaptureSessionId = null;
      }

      if (this.isWsOpen(ws)) this.sendClose(ws);

      this.sessions.delete(session.id);
      this.ctx.log("[rtsp-tunnel] session cleaned", {
        device: session.deviceId,
        remote,
        sid: id,
        why: why,
      });
    };

    session.cleanup = cleanup;

    ws.on("close", () => cleanup("ws_close"));
    ws.on("error", () => cleanup("ws_error"));

    ws.on("message", async (data, isBinary) => {
      // TEXT
      if (!isBinary) {
        const s = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const msg = s.trim();

        if (msg.toUpperCase().startsWith("HELLO ")) {
          const parsed = this.parseHello(msg);
          if (!parsed) {
            return this.sendText(ws, "HELLO_FAIL invalid_format");
          }

          session.payloadId = parsed.payloadId;
          session.deviceId = this.safeDeviceId(parsed.deviceId);
          session.helloAt = Date.now();
          session.tzOffsetHours = await this.pullDeviceTimezoneOffsetHours(
            session.deviceId,
          );
          this.ctx.log("[rtsp-tunnel] HELLO", {
            device: session.deviceId,
            tz: session.tzOffsetHours,
            remote,
            sid: id,
          });

          session.nonceB64 = this.makeNonceB64();
          this.sendText(ws, `CHAL ${session.nonceB64}`);

          if (!this.requireAuth) {
            session.authed = true;
            this.sendText(ws, "AUTH_OK");
            this.maybeAutoCapture(session);
          }
          return;
        }

        if (msg.toUpperCase().startsWith("AUTH ")) {
          const parts = msg.split(/\s+/);
          const devId = this.safeDeviceId(parts[1] ?? "unknown");
          const sigB64 = parts[2] ?? "";

          if (!session.nonceB64) {
            this.sendText(ws, "AUTH_FAIL no_chal");
            return;
          }

          if (session.deviceId !== "unknown" && devId !== session.deviceId) {
            this.sendText(ws, "AUTH_FAIL device_mismatch");
            return;
          }

          if (session.deviceId === "unknown") session.deviceId = devId;

          const ok = await this.verifyAuth(
            session.deviceId,
            session.nonceB64,
            sigB64,
          );
          if (!ok) {
            session.authed = false;
            this.sendText(ws, "AUTH_FAIL verify_failed");
            if (this.requireAuth) {
              try {
                ws.close();
              } catch {}
            }
            return;
          }

          session.authed = true;
          this.sendText(ws, "AUTH_OK");
          this.maybeAutoCapture(session);
          return;
        }

        return;
      }

      // BINARY
      const b = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
      if (b.length < 1) return;

      const t = b[0];
      if (t === 2) {
        if (session.proxySock && !session.proxySock.destroyed) {
          session.proxySock.write(b.subarray(1));
        }
      }
    });

    session.helloTimer = setTimeout(() => {
      if (!this.isWsOpen(ws)) return;
      if (session.deviceId !== "unknown") return;

      this.ctx.log("[rtsp-tunnel] no HELLO; closing", { remote, sid: id });
      try {
        ws.close();
      } catch {}
    }, this.helloWaitMs);
  }

  private onProxyConnection(ffSock: net.Socket) {
    this.ctx.log("[rtsp-tunnel] ffmpeg connected");

    const sid = this.globalCaptureSessionId;
    const session = sid ? this.sessions.get(sid) : null;

    if (!session || !session.captureActive || !this.isWsOpen(session.ws)) {
      this.ctx.log("[rtsp-tunnel] proxy reject: no active capture session");
      ffSock.destroy();
      return;
    }

    session.proxySock = ffSock;

    // Tell device to OPEN its camera connection
    this.sendOpen(session.ws);

    // ffmpeg -> device (type=1)
    ffSock.on("data", (chunk) => {
      if (!this.isWsOpen(session.ws)) return;
      session.ws.send(Buffer.concat([Buffer.from([1]), chunk]));
    });

    const cleanup = () => {
      if (session.proxySock === ffSock) session.proxySock = null;
      try {
        ffSock.destroy();
      } catch {}
      try {
        if (this.isWsOpen(session.ws)) this.sendClose(session.ws);
      } catch {}
      this.ctx.log("[rtsp-tunnel] proxy session ended", {
        device: session.deviceId,
        sid: session.id,
      });
    };

    ffSock.on("close", cleanup);
    ffSock.on("error", cleanup);
  }
}
