import crypto from "node:crypto";
import type { DataSource } from "@similie/ellipsies";
import type { ModuleContext } from "@similie/hyphen-command-server-types";

export type AuthPayload = {
  deviceId: string;
  sigB64: string;
};

export class DeviceAuth {
  constructor(private readonly ctx: ModuleContext) {}

  public async deviceSensors(identity: string) {
    const query = `SELECT "s".* FROM "device" "d" JOIN "device_sensor" "ds" ON ("d"."id" = "ds"."device") JOIN "sensor" "s" ON ("s"."id" = "ds".sensor) WHERE "d"."identity" = $1;`;
    const results = await this.ds().query(query, [identity]);
    const values: Record<string, string> = {};
    for (const row of results) {
      values[row.key] = row;
    }
    return { results, values };
  }

  public async device(identity: string) {
    const repo = this.ds().getRepository("device");
    const results = await repo.findOne({ where: { identity } });
    return results;
  }

  private ds(): DataSource {
    const ds = this.ctx?.ellipsies?.pgManager?.datasource;
    if (!ds) {
      throw new Error("ctx.ellipsies.pgManager.datasource is missing");
    }
    return ds;
  }

  /**
   * Parse "AUTH <deviceId> <sigB64>"
   * Returns null if invalid.
   */
  parseAuthLine(line: string): AuthPayload | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;
    if ((parts[0] ?? "").toUpperCase() !== "AUTH") return null;

    const deviceId = (parts[1] ?? "").trim();
    const sigB64 = (parts[2] ?? "").trim();

    if (!deviceId || !sigB64) return null;
    return { deviceId, sigB64 };
  }

  /**
   * Lookup device certificate by identity and verify signature
   * over `${deviceId}.${nonceB64}` using RSA-SHA256.
   */
  async verify(
    deviceId: string,
    nonceB64: string,
    sigB64: string,
  ): Promise<boolean> {
    this.ctx.log("[rtsp-tunnel][auth] verify", { deviceId, nonceB64, sigB64 });
    // 1) Load certificate row by identity
    const repo = this.ds().getRepository("certificate");

    // identity in your schema is unique
    const row = await repo.findOne({ where: { identity: deviceId } });
    if (!row?.cert) {
      this.ctx.log("[rtsp-tunnel][auth] no cert for deviceId", {
        identity: deviceId,
      });
      return false;
    }

    // 2) Build canonical message
    const message = `${deviceId}.${nonceB64}`;
    this.ctx.log("[rtsp-tunnel][auth] message", { message });
    // 3) Verify signature
    let sig: Buffer;
    try {
      sig = Buffer.from(sigB64, "base64");
    } catch {
      this.ctx.log("[rtsp-tunnel][auth] bad base64 sig", {
        identity: deviceId,
      });
      return false;
    }

    try {
      // Node can accept X.509 cert PEM directly as the public key
      const ok = crypto.verify(
        "RSA-SHA256",
        Buffer.from(message, "utf8"),
        {
          key: row.cert,
        },
        sig,
      );

      if (!ok) {
        this.ctx.log("[rtsp-tunnel][auth] verify failed", {
          identity: deviceId,
        });
      }
      return ok;
    } catch (e: any) {
      this.ctx.log("[rtsp-tunnel][auth] verify error", {
        identity: deviceId,
        message: e?.message ?? e,
      });
      return false;
    }
  }
}
