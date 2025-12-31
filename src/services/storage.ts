// storage.ts
import path from "node:path";
import fs from "node:fs";

export type StoreInput = {
  localPath: string;
  deviceId: string;
  payloadId: string | null;
  capturedAt: string; // ISO
  day?: string; // YYYY-MM-DD
};

export type StoreResult = {
  storage: string; // "local" | "s3" | ...
  storedUri: string; // file path or s3 uri
  deleteLocal?: boolean;
};

export interface StorageAdapter {
  name: string;
  store(input: StoreInput): Promise<StoreResult>;
}

// -------- Default: keep local file in place (no-op) --------
export class LocalStorageAdapter implements StorageAdapter {
  name = "local";
  async store(input: StoreInput): Promise<StoreResult> {
    return {
      storage: "local",
      storedUri: `file://${input.localPath}`,
      deleteLocal: false,
    };
  }
}

// -------- Optional: move/copy to a new root folder --------
export class LocalMoveStorageAdapter implements StorageAdapter {
  name = "local-move";
  constructor(
    private readonly rootDir: string,
    private readonly mode: "copy" | "move" = "move",
  ) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  async store(input: StoreInput): Promise<StoreResult> {
    const safeDev = input.deviceId;
    const sub = input.payloadId ? path.join(safeDev, input.payloadId) : safeDev;
    const destDir = path.join(this.rootDir, sub);
    fs.mkdirSync(destDir, { recursive: true });

    const filename = path.basename(input.localPath);
    const destPath = path.join(destDir, filename);

    if (this.mode === "move") {
      fs.renameSync(input.localPath, destPath);
    } else {
      fs.copyFileSync(input.localPath, destPath);
    }

    return { storage: this.name, storedUri: `file://${destPath}` };
  }
}
