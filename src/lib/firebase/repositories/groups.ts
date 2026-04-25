import {
  addDoc,
  arrayRemove,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  audioSettingsSchema,
  DEFAULT_AUDIO_SETTINGS,
  DISPLAY_NAME_MAX_LENGTH,
  groupBodySchema,
  type AudioSettings,
  type CreateGroupInput,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

const groupsRef = collection(firestore, "groups").withConverter(
  zodConverter(groupBodySchema, "groups"),
);

export function groupDocRef(gid: string) {
  return doc(groupsRef, gid);
}

export async function createGroup(
  input: CreateGroupInput & { ownerDisplayName?: string | null },
): Promise<string> {
  try {
    const ownerDisplayName = input.ownerDisplayName?.trim();
    // Phase 4.7: memberDisplayNames にはオーナー自身の entry を初期登録する（displayName が取れれば）。
    //           空の場合は後続の updateDisplayName / propagateDisplayNameToGroups で backfill される。
    const memberDisplayNames: Record<string, string> = ownerDisplayName
      ? { [input.ownerUid]: ownerDisplayName }
      : {};
    const ref = await addDoc(groupsRef, {
      name: input.name,
      ownerUids: [input.ownerUid],
      organizerUids: [input.ownerUid],
      memberUids: [input.ownerUid],
      memberDisplayNames,
      audioSettings: DEFAULT_AUDIO_SETTINGS,
      createdAt: serverTimestamp(),
      joinCodeId: null,
    });
    logger.info("group create ok", { gid: ref.id });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function getGroup(gid: string): Promise<GroupDoc> {
  try {
    const snap = await getDoc(groupDocRef(gid));
    if (!snap.exists()) {
      throw new AppError(`group not found: ${gid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

/**
 * `users/{uid}.groupIds` から逆引きで自分の group 一覧を取得する。
 * `where("memberUids", "array-contains", uid)` ではなく逆引きを使うことで、
 * rule の list 評価で個別 doc read を許可する形に揃える。
 *
 * 一部の gid が rule で拒否される drift 状態に備え、`Promise.allSettled` で
 * rejected を warn ログに出して呼び出し側に skip させる。
 */
export async function listMyGroups(groupIds: string[]): Promise<{
  groups: GroupDoc[];
  failedGids: string[];
}> {
  if (groupIds.length === 0) return { groups: [], failedGids: [] };
  const settled = await Promise.allSettled(groupIds.map((gid) => getGroup(gid)));
  const groups: GroupDoc[] = [];
  const failedGids: string[] = [];
  settled.forEach((r, i) => {
    const gid = groupIds[i];
    if (r.status === "fulfilled") {
      groups.push(r.value);
    } else {
      failedGids.push(gid);
      const reason = r.reason;
      const code =
        reason && typeof reason === "object" && "code" in reason
          ? (reason as { code: string }).code
          : "unknown";
      logger.warn("listMyGroups skipped gid", { gid, code });
    }
  });
  groups.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  return { groups, failedGids };
}

export async function updateGroupName(gid: string, name: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { name });
    logger.info("group rename ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

/**
 * group のロール配列（ownerUids / organizerUids / memberUids）を一括更新する。
 * 呼び出し側で整合性を保った配列を組み立ててから渡す（オーナーは organizer/member にも含める等）。
 * Rule 側で ownerUids.size() >= 1 や invariant が検証される。
 */
export async function updateGroupRoles(
  gid: string,
  patch: { ownerUids?: string[]; organizerUids?: string[]; memberUids?: string[] },
): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), patch);
    logger.info("group roles updated", { gid, patchKeys: Object.keys(patch) });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ロール更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

/**
 * self-leave：自分を memberUids / organizerUids / ownerUids の 3 配列から同時に外す。
 * rule 側は「自分が ownerUids に含まれない」状態での self-leave のみ許可するため、
 * owner が残る想定では本関数は呼ばない（service 側で事前に降格させる）。
 *
 * Phase 4.7: `memberDisplayNames` マップからも自分の entry を同時に削除する。
 */
export async function removeMemberSelf(gid: string, uid: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), {
      memberUids: arrayRemove(uid),
      organizerUids: arrayRemove(uid),
      ownerUids: arrayRemove(uid),
      [`memberDisplayNames.${uid}`]: deleteField(),
    });
    logger.info("group remove member ok", { gid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル脱退に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid, uid });
    throw wrapped;
  }
}

/**
 * Phase 4.7: サインイン中のユーザーが自分の `memberDisplayNames[uid]` を書き込む。
 * `updateDisplayName` からの propagate と join flow の両方で利用する。
 * Rule 側は map の `auth.uid` キーのみ変更を許可（他フィールドは immutable）。
 */
export async function setMemberDisplayName(
  gid: string,
  uid: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  try {
    await updateDoc(groupDocRef(gid), {
      [`memberDisplayNames.${uid}`]: trimmed,
    });
    logger.info("group member displayName set ok", { gid, uid });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "メンバー表示名の更新に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, gid, uid });
    throw wrapped;
  }
}

/**
 * Phase 4.9: 音声通知設定を group 単位で更新する。
 *   - object 一括上書き（dot-path にしない）— Phase 4.10 で SoundId 切替時に
 *     未参照キーが残るのを避けるため
 *   - rule 側は audioSettings の field-level validation を行わない（organizer 信頼）。
 *     application 層の zod が最終ライン。
 */
export async function updateAudioSettings(
  gid: string,
  settings: AudioSettings,
): Promise<void> {
  const parsed = audioSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new AppError(
      "サウンド設定の値が不正です",
      "validation/audio-settings-invalid",
    );
  }
  try {
    await updateDoc(groupDocRef(gid), { audioSettings: parsed.data });
    logger.info("group audio settings updated", {
      gid,
      enabled: parsed.data.enabled,
      volume: parsed.data.volume,
    });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "サウンド設定の更新に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

export async function deleteGroup(gid: string): Promise<void> {
  try {
    await deleteDoc(groupDocRef(gid));
    logger.info("group delete ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}
