import { collection, doc } from "firebase/firestore";

import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { playerBodySchema } from "@/lib/firebase/schemas/player";
import { tableBodySchema } from "@/lib/firebase/schemas/table";
import { tournamentBodySchema } from "@/lib/firebase/schemas/tournament";

/**
 * `tournaments` 系 collection の converter 付き ref factory の単一真実源。
 *
 * architect-refactor 20260801 (finding-6) で導入。それ以前は同一実装が分散していた:
 *
 * | ref | 定義箇所 |
 * | --- | --- |
 * | tournaments | `repositories/tournaments.ts` / `tx-helpers.ts` / `seating/orchestrator.ts` |
 * | players | `repositories/players.ts` / `seating/orchestrator.ts` |
 * | tables | `repositories/tables.ts` / `seating/orchestrator.ts` |
 *
 * `tx-helpers.ts` のコメント自身が「orchestrator.ts / repositories/tournaments.ts で
 * 重複していた実装と**一致させる**」と述べており、重複を認識したうえで手動同期に
 * 頼っている状態だった。`zodConverter` の第 2 引数（エラーメッセージ用のパス文字列）を
 * 変えたときの同期漏れを構造的に防ぐため、ここに集約する。
 *
 * `groups` / `seasonStats` / `seasonHistory` / `structures` などは定義が 1 箇所しかなく
 * 重複していないため、それぞれの repository に置いたままにする（YAGNI）。
 *
 * すべて関数として公開する（module-level const にしない）。import 時ではなく呼出時に
 * `collection()` を評価することで、`vi.mock("firebase/firestore")` を使う単体テストで
 * mock の適用タイミングに依存しなくなるため。`collection()` 自体は軽量。
 */

export function tournamentsCollectionRef() {
  return collection(firestore, "tournaments").withConverter(
    zodConverter(tournamentBodySchema, "tournaments"),
  );
}

export function tournamentDocRef(tid: string) {
  return doc(tournamentsCollectionRef(), tid);
}

export function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}

export function tablesRef(tid: string) {
  return collection(firestore, "tournaments", tid, "tables").withConverter(
    zodConverter(tableBodySchema, `tournaments/${tid}/tables`),
  );
}
