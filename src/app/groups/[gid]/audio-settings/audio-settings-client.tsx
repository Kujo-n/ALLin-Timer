"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getGroup, updateAudioSettings } from "@/lib/firebase/repositories/groups";
import {
  DEFAULT_AUDIO_SETTINGS,
  deriveRole,
  type AudioSettings,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
import { logger } from "@/lib/logger";

export function AudioSettingsClient({ gid }: { gid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // role 判定 → member は redirect
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const g = await getGroup(gid);
        const role = deriveRole(g, user.uid);
        if (role !== "owner" && role !== "organizer") {
          router.replace(`/groups/${gid}`);
          return;
        }
        setGroup(g);
        setSettings(g.audioSettings);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code, gid });
        setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
  }, [gid, user, router]);

  const role = user && group ? deriveRole(group, user.uid) : null;

  const player = useAudioPlayer({
    tournament: null,
    group,
    players: [],
    role,
  });

  const onSave = useCallback(async () => {
    setWorking(true);
    setError(null);
    try {
      await updateAudioSettings(gid, settings);
      router.push(`/groups/${gid}`);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "サウンド設定の更新に失敗しました",
      );
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }, [gid, settings, router]);

  if (!user) return null;
  if (!group) {
    return (
      <main className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
        {error ?? "読込中…"}
      </main>
    );
  }

  const sounds = listAvailableSounds();

  return (
    <main className="mx-auto max-w-md space-y-6 p-8">
      <header>
        <Link href={`/groups/${gid}`} className="text-sm text-muted-foreground">
          ← サークルへ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">サウンド設定</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>通知音</CardTitle>
          <CardDescription>
            ブラインド変更／優勝確定で音を鳴らします。設定はサークル全体に反映されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings((s) => ({ ...s, enabled: e.target.checked }))
              }
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

          {!player.unlocked ? (
            <p className="text-xs text-muted-foreground">
              試聴ボタンを押すとブラウザのサウンド権限を有効にします。
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Link href={`/groups/${gid}`}>
              <Button variant="outline">キャンセル</Button>
            </Link>
            <Button onClick={() => void onSave()} disabled={working}>
              {working ? "保存中…" : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
