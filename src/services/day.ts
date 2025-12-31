export function sanitizeTzOffsetHours(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // sanity bounds (common tz offsets)
  if (n < -12 || n > 14) return null;
  return n;
}

export function dayFromCapturedAt(
  capturedAtIso: string,
  tzOffsetHours?: number | null,
): string {
  const d = new Date(capturedAtIso);
  if (Number.isNaN(d.getTime()))
    throw new Error(`Invalid capturedAt ${capturedAtIso}`);

  const hasOffset = process.env.USE_DEVICE_TZ_OFFSET === "1";

  const off =
    hasOffset &&
    typeof tzOffsetHours === "number" &&
    Number.isFinite(tzOffsetHours)
      ? tzOffsetHours
      : 0;
  const shifted = new Date(d.getTime() + Math.round(off * 3600 * 1000));

  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
