"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { logger } from "@/lib/logger";
import { formatTableLabel } from "@/lib/services/format-table-label";
import {
  diagnoseBalancingNeed,
  planTableBreak,
} from "@/lib/services/seating/engine";
import {
  applyBalancingOnce,
  applyManualBalancingMove,
} from "@/lib/services/seating/orchestrator";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  players: PlayerDoc[];
  tables: TableDoc[];
  seatsPerTable: number;
  onError?: (message: string) => void;
}

/**
 * Phase 5.x: バランシング指示カード（TDA 準拠）。
 *  - planTableBreak が成立すれば「指示完了」ボタンで自動適用（複数 player を bulk 移動）
 *  - そうでなく diagnoseBalancingNeed が non-null なら、source/dest 卓と移動先席を提示し
 *    PD と busted を除外した候補プレイヤーをボタン列で出す。運営者が dealer button 位置を
 *    見て BB 次プレイヤーをクリック → applyManualBalancingMove で 1 件移動
 *  - どちらも null（バランス済み）ならカード自体非表示
 *
 * 設計トレードオフ: engine の auto-pick（最小席番号）は TDA の「BB 次」を近似していたが、
 * 実 dealer button 位置を追跡しないため不正確になる場面があった。本カードは「卓と席までは
 * engine が決定、誰を動かすかは運営者の判断」のハイブリッド形にして TDA 準拠を担保する。
 */
export function BalancingInstructionCard({
  tid,
  uid,
  userGroupIds,
  players,
  tables,
  seatsPerTable,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  // M5 fix: 非同期 finally の setBusy が unmount 後に走らないように guard。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { breakPlan, diag } = useMemo(() => {
    const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
    const bp = planTableBreak(players, brokenTableNums, seatsPerTable);
    if (bp) {
      return { breakPlan: bp, diag: null };
    }
    const d = diagnoseBalancingNeed(players, brokenTableNums, seatsPerTable);
    return { breakPlan: null, diag: d };
  }, [players, tables, seatsPerTable]);

  if (!breakPlan && !diag) return null;

  async function handleBreak() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await applyBalancingOnce(
        tid,
        uid,
        userGroupIds,
        players,
        tables,
        seatsPerTable,
      );
      if (!result.applied) {
        // race で no-op された場合。次回 subscribe 発火で再評価される。
        logger.info("balancing instruction skipped (race)", { tid });
      }
    } catch (e) {
      // applyBalancingOnce は内部で warn 済み。UI 表示のみここで担当する。
      const err = unwrapOrFrom(e, "firestore/write_failed", "テーブル閉鎖に失敗しました");
      if (mounted.current) onError?.(formatErrorForDisplay(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function handleManualMove(playerId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await applyManualBalancingMove(
        tid,
        uid,
        userGroupIds,
        playerId,
        players,
        tables,
        seatsPerTable,
      );
      if (!result.applied) {
        // race / 候補外: 次回 onSnapshot 反映までボタン押下が silent no-op になるのを防ぐため
        // 運営者向けトーストを表示する（onError は本コンポーネントの汎用 feedback chan として流用）。
        logger.info("manual balancing move skipped (race)", { tid, playerId });
        if (mounted.current) {
          onError?.("バランシング状態が更新されました。再度ご確認ください。");
        }
      }
    } catch (e) {
      // applyManualBalancingMove は内部で warn 済み。UI 表示のみここで担当する。
      const err = unwrapOrFrom(e, "firestore/write_failed", "バランシング適用に失敗しました");
      if (mounted.current) onError?.(formatErrorForDisplay(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Card className="border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="text-base">⚠ 次のアクション</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {breakPlan ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              {`${formatTableLabel(
                tables.find((t) => t.tableNum === breakPlan.brokenTableNum) ?? {
                  tableNum: breakPlan.brokenTableNum,
                  label: null,
                },
              )} を閉鎖（${breakPlan.moves.length} 名移動）`}
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void handleBreak()}
              aria-label="balancing-apply-break"
            >
              {busy ? "適用中…" : "指示完了"}
            </Button>
          </div>
        ) : diag ? (
          <>
            <p className="text-sm">
              {`${formatTableLabel(
                tables.find((t) => t.tableNum === diag.sourceTableNum) ?? {
                  tableNum: diag.sourceTableNum,
                  label: null,
                },
              )} が ${diag.diff} 人多いです。`}
              <strong>BB の次プレイヤー</strong>
              {`を ${formatTableLabel(
                tables.find((t) => t.tableNum === diag.destTableNum) ?? {
                  tableNum: diag.destTableNum,
                  label: null,
                },
              )} / 席 ${diag.destSeatNum} へ移動してください。`}
            </p>
            <p className="text-xs text-muted-foreground">
              移動するプレイヤーを選択（PD は移動できません）
            </p>
            <div className="flex flex-wrap gap-2">
              {diag.candidatePlayerIds.map((pid) => {
                const p = players.find((q) => q.id === pid);
                if (!p) return null;
                const seatLabel = p.seatNum !== null ? `席 ${p.seatNum}` : "席?";
                return (
                  <Button
                    key={pid}
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleManualMove(pid)}
                    aria-label={`balancing-candidate-${pid}`}
                  >
                    {`${p.displayName}（${seatLabel}）`}
                  </Button>
                );
              })}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
