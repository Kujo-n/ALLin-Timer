"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listAvailableSounds } from "@/lib/audio/sound-catalog";
import { unwrapOrFrom } from "@/lib/errors";
import { updateAudioSettings } from "@/lib/firebase/repositories/groups";
import {
  type AudioSettings,
  type GroupDoc,
  type MemberRole,
} from "@/lib/firebase/schemas/group";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";

interface AudioSettingsCardProps {
  /** タブ呼出側で fetch 済みの group。null の間は親が render しない前提（呼出側で gating）。 */
  group: GroupDoc;
  /** 現在ユーザの role。`useAudioPlayer` 経由で audio operator 判定に使う。 */
  role: MemberRole | null;
  /** 保存成功時のリロード（親の reload + refreshGroups を再走させる）。 */
  onSaved: () => Promise<void>;
  /** 保存失敗時のエラー通知（親の setError と接続）。 */
  onError: (message: string) => void;
}

/**
 * PRD 02 polish (タブ化) で `audio-settings/audio-settings-client.tsx` から
 * Card 化したサウンド設定エディタ。organizer / owner のみ表示する想定（呼出側で gating）。
 *
 * - `?from=tournament&tid=...` / `?from=live&tid=...` の戻り先契約は維持し、
 *   保存成功後に `router.push(backHref)` で当該画面へ遷移する。
 * - `?from=` 無し（サークル詳細から開いた場合）は遷移せず、Card 内に保存完了
 *   フィードバックを表示して同一画面に留まる。
 */
export function AudioSettingsCard({
  group,
  role,
  onSaved,
  onError,
}: AudioSettingsCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<AudioSettings>(group.audioSettings);
  const [working, setWorking] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // group の audioSettings が外側で変化した（reload / 他端末書込 onSnapshot 想定）かつ
  // 編集中でなければ追従する。working=true の間は上書きしない。
  useEffect(() => {
    if (!working) {
      setSettings(group.audioSettings);
    }
  }, [group.audioSettings, working]);

  // 戻り先: from=tournament なら受付（dashboard）、from=live なら全画面表示に戻す。
  // それ以外（サークル詳細から開いた場合）は null を返し、保存後に遷移しない。
  const back = useMemo(() => {
    const from = searchParams.get("from");
    const tid = searchParams.get("tid");
    const tidValid = !!tid && /^[A-Za-z0-9_-]+$/.test(tid);
    if (tidValid) {
      if (from === "tournament") {
        return { href: `/tournaments/${tid}`, label: "← トーナメント受付へ戻る" };
      }
      if (from === "live") {
        return { href: `/tournaments/${tid}/live`, label: "← 全画面表示へ戻る" };
      }
    }
    return null;
  }, [searchParams]);

  const player = useAudioPlayer({
    tournament: null,
    group,
    players: [],
    role,
  });

  const onSave = useCallback(async () => {
    setWorking(true);
    setSavedFlash(false);
    try {
      await updateAudioSettings(group.id, settings);
      await onSaved();
      if (back) {
        router.push(back.href);
      } else {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      }
    } catch (e) {
      const wrapped = unwrapOrFrom(
        e,
        "firestore/write_failed",
        "サウンド設定の更新に失敗しました",
      );
      onError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }, [group.id, settings, router, back, onSaved, onError]);

  const sounds = listAvailableSounds();

  return (
    <Card aria-label="audio-settings-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>サウンド設定</CardTitle>
            <CardDescription>
              ブラインド変更／優勝確定で音を鳴らします。設定はサークル全体に反映されます。
            </CardDescription>
          </div>
          {back ? (
            <Link href={back.href} className="text-sm text-muted-foreground">
              {back.label}
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span>通知音を有効にする</span>
        </label>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span>ブラインド変更時:</span>
              <select
                value={settings.levelUpSoundId}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, levelUpSoundId: e.target.value }))
                }
                className="rounded border px-2 py-1"
              >
                {sounds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void player.preview(settings.levelUpSoundId)}
            >
              試聴
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span>優勝確定時:</span>
              <select
                value={settings.winnerSoundId}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, winnerSoundId: e.target.value }))
                }
                className="rounded border px-2 py-1"
              >
                {sounds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void player.preview(settings.winnerSoundId)}
            >
              試聴
            </Button>
          </div>
        </div>

        <label className="block space-y-1 text-sm">
          <span>音量: {Math.round(settings.volume * 100)}%</span>
          <Input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) =>
              setSettings((s) => ({ ...s, volume: Number(e.target.value) }))
            }
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          {savedFlash ? (
            <span className="text-sm text-emerald-700" role="status">
              保存しました
            </span>
          ) : null}
          <Button onClick={() => void onSave()} disabled={working}>
            {working ? "保存中…" : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
