// storage-s3.ts
import type { StorageAdapter, StoreInput, StoreResult } from "./storage.js";
import fs from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { envTrim, safeSegment } from "./config.js";

export class S3StorageAdapter implements StorageAdapter {
  name = "s3";
  private readonly s3: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly prefix: string = "hyphen/rtsp",
    s3Client?: S3Client,
    private readonly deleteOnMove: boolean = true,
  ) {
    // Prefer service-specific region, then generic, then default.
    const region =
      envTrim("AWS_S3_REGION") ?? envTrim("AWS_REGION") ?? "ap-southeast-1";

    this.s3 = s3Client ?? new S3Client({ region });
    if (!bucket) throw new Error("S3StorageAdapter requires bucket");
  }

  async store(input: StoreInput): Promise<StoreResult> {
    const fileName = path.basename(input.localPath);
    const day =
      input.day ?? new Date(input.capturedAt).toISOString().slice(0, 10); // "2025-12-28"
    const keyParts = [
      safeSegment(this.prefix),
      safeSegment(input.deviceId),
      day,
      fileName,
    ].filter(Boolean);

    const key = keyParts.join("/");
    console.log("Uploading to S3 with key:", key);
    const body = fs.createReadStream(input.localPath);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "image/jpeg",
      }),
    );

    if (this.deleteOnMove) {
      fs.unlinkSync(input.localPath);
    }

    return {
      storage: "s3",
      storedUri: `s3://${this.bucket}/${key}`,
    };
  }
}
