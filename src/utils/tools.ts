import CryptoJS from "crypto-js";
import { v4 } from "uuid";
import { type UUID as _UUID } from "@similie/ellipsies";
export type UUID = _UUID;

export type MQTTFunctionalResponse = {
  value: any;
  key: string;
  id: string;
  request: string;
};

export const generateUniqueId = (numBytes: number = 16): string => {
  const wordArray = CryptoJS.lib.WordArray.random(numBytes);
  // Convert the WordArray to a hexadecimal string
  return wordArray.toString(CryptoJS.enc.Hex);
};

export const generateUniqueUUID = () => {
  return v4() as UUID;
};

export const isUUID = (value: string | UUID) => {
  const regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
  return regex.test(value);
};

export const mqttMessageIdentity = (
  payload: Buffer<ArrayBufferLike>,
): string => {
  try {
    const value = JSON.parse(payload.toString());
    value._uid = generateUniqueUUID();
    return JSON.stringify(value);
  } catch {
    return payload.toString();
  }
};
