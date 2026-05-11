"use client";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

import { CardBackgroundCard } from "./CardBackgroundCard";

interface Props {
  group: GroupDoc;
  canEdit: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}

/**
 * Phase A.2: 優勝者カード背景画像の thin wrapper。
 * `group.winnerCardBackground` を `CardBackgroundCard` に流すだけの薄い shell。
 */
export function WinnerCardBackgroundCard({
  group,
  canEdit,
  onSaved,
  onError,
}: Props) {
  return (
    <CardBackgroundCard
      gid={group.id}
      kind="winner"
      current={group.winnerCardBackground}
      canEdit={canEdit}
      onSaved={onSaved}
      onError={onError}
      dataTestIdPrefix="winner-card-bg"
    />
  );
}
