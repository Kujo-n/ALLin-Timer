import { redirect } from "next/navigation";

/**
 * PRD 02 polish (タブ化): サウンド設定はサークル詳細「設定」タブ内 Card に統合された。
 * 旧 URL `/groups/[gid]/audio-settings` は `/groups/[gid]?tab=settings` に thin redirect する。
 *
 * `?from=tournament` / `?from=live` + `?tid=<token>` クエリは保持し、redirect 先の
 * `AudioSettingsCard` がそのまま「← 戻る」リンクと保存後 navigation に解釈する。
 * `tid` は `^[A-Za-z0-9_-]+$` でバリデートし、不正値は drop（旧 audio-settings-client の契約と同等）。
 */
export default async function AudioSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ gid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gid } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams();
  query.set("tab", "settings");
  const from = sp.from;
  if (typeof from === "string" && (from === "tournament" || from === "live")) {
    query.set("from", from);
  }
  const tid = sp.tid;
  if (typeof tid === "string" && /^[A-Za-z0-9_-]+$/.test(tid)) {
    query.set("tid", tid);
  }
  redirect(`/groups/${gid}?${query.toString()}`);
}
