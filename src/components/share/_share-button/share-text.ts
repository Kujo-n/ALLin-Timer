/**
 * Phase D: Web Share API の `text` フィールドを純関数で組み立てる。
 *
 *  - PII を含むが SNS 投稿前提で OK（サークルメンバーが自分の判断で共有する）
 *  - 全角 / 半角混在で 140 字程度を上限（X 280 chars と LINE preview を考慮）
 *  - 表示名 / トーナメント名 / サークル名が空のときはフォールバック文字列
 */
const SHARE_TEXT_MAX = 140;

export function truncateForShare(s: string, max = SHARE_TEXT_MAX): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function formatWinnerShareText(input: {
  tournamentName: string;
  winnerName: string;
  participants: number;
}): string {
  const winner = input.winnerName.trim() || "—";
  const tname = input.tournamentName.trim() || "トーナメント";
  return truncateForShare(
    `${tname} の優勝者は ${winner} です（参加 ${input.participants} 人） #ALLinPokerTimer`,
  );
}

export function formatSeasonShareText(input: {
  groupName: string;
  top1Name: string;
  top1Points: number;
}): string {
  const top1 = input.top1Name.trim() || "—";
  const gname = input.groupName.trim() || "サークル";
  return truncateForShare(
    `${gname} シーズン首位 ${top1} ${input.top1Points.toFixed(2)} pt #ALLinPokerTimer`,
  );
}
