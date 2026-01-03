export function envTrim(name: string): string | undefined {
  const v = process.env[name];
  const t = v?.trim();
  return t ? t : undefined; // converts "" -> undefined
}
export function safeSegment(s: string) {
  return (s || "unknown").replace(/[^a-zA-Z0-9._/-]/g, "_").slice(0, 128);
}
