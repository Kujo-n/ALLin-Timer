"use client";

/** 順位表 1 行分の最小形。SeasonStatsDoc / seasonHistory entry の双方が構造的に充足する。 */
export interface SeasonRankingRow {
  id: string;
  displayName: string;
  participations: number;
  wins: number;
  finalTables: number;
  totalPoints: number;
}

/**
 * シーズン順位表（presentational）。
 *
 * 現シーズンランキング画面 / 過去シーズン詳細 / サークル詳細シーズンタブの
 * 3 箇所で同一だった `<table>` を集約。並び順は呼出側で確定済みの前提
 * （`totalPoints desc`）。順位は配列 index + 1。
 */
export function SeasonRankingTable({ rows }: { rows: SeasonRankingRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th scope="col" className="py-2 text-left">
            順位
          </th>
          <th scope="col" className="py-2 text-left">
            表示名
          </th>
          <th scope="col" className="py-2 text-right">
            参加
          </th>
          <th scope="col" className="py-2 text-right">
            優勝
          </th>
          <th scope="col" className="py-2 text-right">
            FT
          </th>
          <th scope="col" className="py-2 text-right">
            累計ポイント
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} className="border-b">
            <td className="py-2">{i + 1}</td>
            <td className="py-2">{r.displayName}</td>
            <td className="py-2 text-right">{r.participations}</td>
            <td className="py-2 text-right">{r.wins}</td>
            <td className="py-2 text-right">{r.finalTables}</td>
            <td className="py-2 text-right font-semibold">
              {r.totalPoints.toFixed(2)} pt
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
