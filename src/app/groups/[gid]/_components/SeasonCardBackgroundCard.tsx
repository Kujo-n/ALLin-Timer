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
 * Phase A.2: シーズン戦績カード背景画像の thin wrapper。
 * `group.seasonCardBackground` を `CardBackgroundCard` に流すだけの薄い shell。
 */
export function SeasonCardBackgroundCard({
  group,
  canEdit,
  onSaved,
  onError,
}: Props) {
  return (
    <CardBackgroundCard
      gid={group.id}
      kind="season"
      current={group.seasonCardBackground}
      canEdit={canEdit}
      onSaved={onSaved}
      onError={onError}
      dataTestIdPrefix="season-card-bg"
    />
  );
}
