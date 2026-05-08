"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_SEATS_PER_TABLE,
  MIN_SEATS_PER_TABLE,
  SEASON_POINTS_BASE_MAX_LENGTH,
} from "@/lib/limits";
import {
  calcSeasonPoints,
  DEFAULT_SEASON_POINTS_RULE,
  type SeasonPointsRule,
} from "@/lib/services/season-points";

/**
 * Phase E: 参加人数別プレビュー表で表示する代表値。
 * baseline が 24 を超えるケースは無いため（max=10）、24 まであれば代表値として十分。
 */
const PREVIEW_PARTICIPANTS = [6, 8, 12, 16, 24] as const;

function fmt2(n: number): string {
  return n.toFixed(2);
}

function fmtFactor(participants: number, baseline: number): string {
  if (baseline < 1) return "—";
  return Math.sqrt(participants / baseline).toFixed(2);
}

/**
 * Phase E: サークル詳細画面の「シーズンポイント計算ルール」カード。
 *   - 全メンバー閲覧: 計算式 + 基本点リスト + 参加人数別プレビュー表
 *   - owner / organizer のみ「編集する」「既定値に戻す」ボタン
 *   - 編集モーダルは draft 値で即時プレビュー再計算（draft が一時的 invalid な場合は
 *     最後の有効値にフォールバックして表示空白を防ぐ）
 */
export function SeasonPointsRuleCard({
  rule,
  isOrganizer,
  working,
  onSave,
  onReset,
}: {
  rule: SeasonPointsRule | null;
  isOrganizer: boolean;
  working: boolean;
  onSave: (next: SeasonPointsRule) => void;
  onReset: () => void;
}) {
  const effective = rule ?? DEFAULT_SEASON_POINTS_RULE;
  const isCustom = rule !== null;
  const [editing, setEditing] = useState(false);
  // 編集モーダル open 時の初期値は effective（現行 rule）。close 時に reset するため key に依存させない。
  const [draftBase, setDraftBase] = useState<string[]>(() =>
    effective.base.map((v) => String(v)),
  );
  const [draftBaseline, setDraftBaseline] = useState<string>(() =>
    String(effective.baseline),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // モーダル open のたびに effective から draft を初期化
  useEffect(() => {
    if (editing) {
      setDraftBase(effective.base.map((v) => String(v)));
      setDraftBaseline(String(effective.baseline));
      setValidationError(null);
    }
    // open 時のみ初期化したいので effective 依存を入れない（lint 例外）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /** draft からプレビュー用 rule を派生。invalid 値は effective にフォールバック。 */
  const draftRule: SeasonPointsRule = useMemo(() => {
    const base = draftBase.map((s) => Number(s));
    const baseline = Number(draftBaseline);
    const safeBase =
      base.length >= 1 && base.every((v) => Number.isFinite(v) && v >= 0)
        ? base
        : effective.base;
    const safeBaseline =
      Number.isInteger(baseline) &&
      baseline >= MIN_SEATS_PER_TABLE &&
      baseline <= MAX_SEATS_PER_TABLE
        ? baseline
        : effective.baseline;
    return { base: safeBase, baseline: safeBaseline };
  }, [draftBase, draftBaseline, effective.base, effective.baseline]);

  function handleSave() {
    const base = draftBase.map((s) => Number(s));
    const baseline = Number(draftBaseline);
    if (base.length < 1 || base.length > SEASON_POINTS_BASE_MAX_LENGTH) {
      setValidationError(
        `基本点は 1 件以上 ${SEASON_POINTS_BASE_MAX_LENGTH} 件以下で指定してください`,
      );
      return;
    }
    if (base.some((v) => !Number.isFinite(v) || v < 0)) {
      setValidationError("基本点は 0 以上の数値で指定してください");
      return;
    }
    if (
      !Number.isInteger(baseline) ||
      baseline < MIN_SEATS_PER_TABLE ||
      baseline > MAX_SEATS_PER_TABLE
    ) {
      setValidationError(
        `baseline は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      );
      return;
    }
    setValidationError(null);
    onSave({ base, baseline });
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>シーズンポイント計算ルール</CardTitle>
        <CardDescription>
          {isCustom
            ? "このサークル独自のルールが適用されています。"
            : "既定値が適用されています。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="rounded-md border p-3 text-sm">
          <p className="font-mono">
            付与ポイント = 基本点(順位) × √(参加人数 ÷ {effective.baseline})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            参加人数が baseline = {effective.baseline} 人のとき係数 1.00。
            人数が多いほど係数が増え、付与ポイントも大きくなります。
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold">基本点（順位ごと）</h3>
          <ul className="grid grid-cols-3 gap-1 text-sm sm:grid-cols-5">
            {effective.base.map((v, i) => (
              <li
                key={i}
                className="rounded bg-muted px-2 py-1"
                aria-label={`${i + 1}位の基本点 ${v}pt`}
              >
                <span className="font-mono">{i + 1} 位</span> = {v} pt
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            baseline（係数 1.0 となる人数）: {effective.baseline} 人
          </p>
        </section>

        <PreviewTable rule={effective} />

        {isOrganizer ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setEditing(true)}
              disabled={working}
            >
              編集する
            </Button>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>シーズンポイント計算ルールを編集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1 text-sm">
            <p className="rounded-md border p-3 font-mono">
              付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)
            </p>

            <section>
              <h3 className="mb-2 text-sm font-semibold">基本点（順位ごと）</h3>
              <div className="space-y-2">
                {draftBase.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Label
                      htmlFor={`spr-base-${i}`}
                      className="w-12 shrink-0 text-sm"
                    >
                      {i + 1} 位
                    </Label>
                    <Input
                      id={`spr-base-${i}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      value={v}
                      onChange={(e) => {
                        const next = [...draftBase];
                        next[i] = e.target.value;
                        setDraftBase(next);
                      }}
                      className="w-24"
                      aria-label={`${i + 1}位の基本点`}
                    />
                    <span className="text-xs text-muted-foreground">pt</span>
                    {draftBase.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraftBase(draftBase.filter((_, j) => j !== i));
                        }}
                        aria-label={`${i + 1}位を削除`}
                      >
                        行を削除
                      </Button>
                    ) : null}
                  </div>
                ))}
                {draftBase.length < SEASON_POINTS_BASE_MAX_LENGTH ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraftBase([...draftBase, "0"])}
                  >
                    行を追加（最大 {SEASON_POINTS_BASE_MAX_LENGTH} 行）
                  </Button>
                ) : null}
              </div>
            </section>

            <section className="flex items-center gap-2">
              <Label htmlFor="spr-baseline" className="text-sm">
                baseline（係数 1.0 となる人数）
              </Label>
              <Input
                id="spr-baseline"
                type="number"
                inputMode="numeric"
                min={MIN_SEATS_PER_TABLE}
                max={MAX_SEATS_PER_TABLE}
                step={1}
                value={draftBaseline}
                onChange={(e) => setDraftBaseline(e.target.value)}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">
                人 ({MIN_SEATS_PER_TABLE}〜{MAX_SEATS_PER_TABLE})
              </span>
            </section>

            <PreviewTable
              rule={draftRule}
              title="プレビュー（入力中の値で計算）"
            />

            <p className="text-xs text-muted-foreground">
              次回終了するトーナメントから新ルールが適用されます。
              過去の累計値（totalPoints）は変更されません。
            </p>

            {validationError ? (
              <p className="text-sm text-destructive" role="alert">
                {validationError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onReset();
                setEditing(false);
              }}
              disabled={working}
            >
              既定値に戻す
            </Button>
            <Button
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={working}
            >
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={working}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * 参加人数別プレビュー表。閲覧時は effective、編集時は draftRule を渡す。
 * `calcSeasonPoints(rank, p, rule)` を直接呼ぶことで、UI で表示される値が
 * finishTournament tx 内で実際に保存される値と完全一致する（独自再計算しない）。
 */
function PreviewTable({
  rule,
  title,
}: {
  rule: SeasonPointsRule;
  title?: string;
}) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">
        {title ?? "参加人数別の付与ポイント目安"}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 text-left">順位</th>
              {PREVIEW_PARTICIPANTS.map((p) => (
                <th key={p} className="py-1 text-right">
                  <div>{p} 人</div>
                  <div className="text-muted-foreground">
                    ×{fmtFactor(p, rule.baseline)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rule.base.map((_, i) => {
              const rank = i + 1;
              return (
                <tr key={rank} className="border-b">
                  <td className="py-1">{rank} 位</td>
                  {PREVIEW_PARTICIPANTS.map((p) => (
                    <td key={p} className="py-1 text-right font-mono">
                      {fmt2(calcSeasonPoints(rank, p, rule))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ※ 同じ順位でも参加人数が違うと付与ポイントが変わります（人数が多いほど係数が増える）。
      </p>
    </section>
  );
}
