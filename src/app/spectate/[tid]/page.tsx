import type { Viewport } from "next";

import { SpectateClient } from "./spectate-client";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Phase 2 (04-spectate-mode): 観戦モード公開された tournament の read-only ページ。
 *   - RequireAuth は使わない（PRD 設計）。spectate-client も useAuthUser を読まない。
 *   - 完全 unauthenticated 経路。tournaments/{tid}.spectateEnabled === true のときのみ
 *     subscribe が成立する（rule 側で OR 拡張済 — Phase 1）。
 *   - tournament が存在しない / spectateEnabled=false / toggle OFF（permission-denied）は
 *     spectate-client 側の guard ladder で graceful にハンドリング。
 */
export default async function SpectatePage({
  params,
}: {
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  return <SpectateClient tid={tid} />;
}
