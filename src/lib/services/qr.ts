function safeOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
}

export function buildJoinUrl(tid: string): string {
  return new URL(`/join/${tid}`, safeOrigin()).toString();
}

export function buildSpectateUrl(tid: string): string {
  return new URL(`/spectate/${tid}`, safeOrigin()).toString();
}
