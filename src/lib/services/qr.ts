export function buildJoinUrl(tid: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return new URL(`/join/${tid}`, origin).toString();
}
