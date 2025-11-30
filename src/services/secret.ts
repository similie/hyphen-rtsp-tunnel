import crypto from "crypto";
export interface SignedMessage {
  payload?: string; // JSON string of payload if un-encrypted, OR
  encrypted?: string; // base64 of encrypted payload
  signature: string; // base64 of signature of plaintext payload
}

// Helper to generate random nonce and timestamp
export const generateNonceAndTimestamp = () => {
  const nonce = crypto.randomBytes(16).toString("hex"); // 128-bit random
  const timestamp = Math.floor(Date.now() / 1000); // UNIX time in seconds
  return { nonce, timestamp };
};
export async function createSignedPayload(
  privateKeyPEM: string,
  devicePublicKeyPEM: string,
  payload: any,
  encrypt: boolean = false,
): Promise<SignedMessage> {
  // 1) Serialize payload
  const payloadJson = JSON.stringify(payload);

  // 2) Sign payload using a trusted key (could be server’s private key or device private key)
  const signer = crypto.createSign("sha256");
  signer.update(payloadJson);
  signer.end();
  const signatureBase64 = signer.sign(privateKeyPEM, "base64");

  if (!encrypt) {
    return {
      payload: payloadJson,
      signature: signatureBase64,
    };
  }

  // 3) Optionally encrypt the payload so only the device can read
  let encryptedBase64: string | undefined = undefined;
  try {
    const buffer = Buffer.from(payloadJson, "utf8");
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: devicePublicKeyPEM,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      buffer,
    );
    encryptedBase64 = encryptedBuffer.toString("base64");
  } catch (e) {
    console.warn(
      "Payload too large for direct RSA encrypt, skipping encryption:",
      e,
    );
    // If too large for RSA publicEncrypt with this key, fallback to sending plaintext + signature
  }

  // Build message to device
  if (encryptedBase64) {
    return {
      encrypted: encryptedBase64,
      signature: signatureBase64,
    };
  } else {
    return {
      payload: payloadJson,
      signature: signatureBase64,
    };
  }
}

export class EnvCrypt {
  private readonly _algorithm = "aes-256-ctr";
  private readonly _secretKey: string;
  private _iv: string;
  constructor(iv: string) {
    this._iv = iv;
    this._secretKey =
      process.env.ENV_SECRET_KEY || "6241caa2f4b730f7edcb3e115c0948d5";
  }

  public get convertIv() {
    return Buffer.from(this.iv, "hex");
  }

  private get algorithm() {
    return this._algorithm;
  }

  private get iv() {
    return this._iv;
  }

  static cipherIv(value: number = 16): string {
    return crypto.randomBytes(value).toString("hex");
  }

  private get secretKey() {
    return this._secretKey;
  }

  public encrypt(text: any): string {
    const iv = this.convertIv;
    const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return encrypted.toString("hex");
  }

  public decrypt = (hash: string) => {
    if (!hash) {
      throw new Error("A String Value is Required");
    }

    const decipher = crypto.createDecipheriv(
      this.algorithm,
      this.secretKey,
      this.convertIv, // Buffer.from(hash.iv, "hex")
    );

    const decrpyted = Buffer.concat([
      decipher.update(Buffer.from(hash, "hex")),
      decipher.final(),
    ]);

    return decrpyted.toString();
  };
}
