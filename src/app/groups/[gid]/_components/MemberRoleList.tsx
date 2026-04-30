"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveRole, type GroupDoc, type MemberRole } from "@/lib/firebase/schemas/group";

export interface MemberLine {
  uid: string;
  /** 表示名（未登録 / UID 生値の場合は「名前未登録 (xxxx)」フォールバック）。 */
  displayName: string;
  /** 表示名の解決失敗フラグ（italics 表示等の UI 切替用）。 */
  missing: boolean;
}

function roleLabel(role: MemberRole): string {
  if (role === "owner") return "オーナー";
  if (role === "organizer") return "運営";
  return "一般";
}

function roleBadgeClassName(role: MemberRole): string {
  if (role === "owner") return "rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800";
  if (role === "organizer") return "rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800";
  return "rounded bg-muted px-2 py-0.5 text-xs";
}

interface MemberRoleListProps {
  group: GroupDoc;
  members: MemberLine[];
  /** ログイン中ユーザー uid。 */
  selfUid: string;
  /** 自分が owner か（owner のみ昇降格できる）。 */
  isOwner: boolean;
  /** 「他の操作中」フラグ。true なら全昇降格ボタン disabled。 */
  working: boolean;
  /** 各昇降格アクションの実行 callback。 */
  onPromoteOrganizer: (targetUid: string) => void;
  onPromoteOwner: (targetUid: string) => void;
  onDemoteToMember: (targetUid: string) => void;
  onDemoteOwner: (targetUid: string) => void;
}

/**
 * サークル詳細画面のメンバー一覧（3 階層ロール操作付き）。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` から分離。
 * 自分自身の行には操作ボタンを出さない（`isSelf` 判定）。最後の owner を保護するため
 * `onlyOwner` フラグで demoteOwner を disabled にする。
 */
export function MemberRoleList({
  group,
  members,
  selfUid,
  isOwner,
  working,
  onPromoteOrganizer,
  onPromoteOwner,
  onDemoteToMember,
  onDemoteOwner,
}: MemberRoleListProps) {
  const onlyOwner = group.ownerUids.length <= 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>メンバー</CardTitle>
        <CardDescription>
          ロールは「オーナー / 運営 / 一般」の 3 階層。オーナーのみ昇降格できます。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {members.map((m) => {
            const role = deriveRole(group, m.uid) ?? "member";
            const isSelf = m.uid === selfUid;
            const targetIsOwner = role === "owner";
            const targetIsOrganizer = role === "organizer";
            const targetIsMember = role === "member";
            return (
              <li
                key={m.uid}
                className="flex flex-wrap items-center gap-2 rounded border p-2"
              >
                <span
                  className={
                    m.missing
                      ? "flex-1 truncate italic text-muted-foreground"
                      : "flex-1 truncate"
                  }
                  title={m.missing ? `UID: ${m.uid}` : undefined}
                >
                  {m.displayName}
                </span>
                <span className={roleBadgeClassName(role)}>{roleLabel(role)}</span>
                {isSelf ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                    あなた
                  </span>
                ) : null}
                {isOwner && !isSelf ? (
                  <div className="flex flex-wrap gap-1">
                    {targetIsMember ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={working}
                        onClick={() => onPromoteOrganizer(m.uid)}
                      >
                        運営へ昇格
                      </Button>
                    ) : null}
                    {targetIsOrganizer ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working}
                          onClick={() => onPromoteOwner(m.uid)}
                        >
                          オーナーへ昇格
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working}
                          onClick={() => onDemoteToMember(m.uid)}
                        >
                          一般へ降格
                        </Button>
                      </>
                    ) : null}
                    {targetIsOwner ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={working || onlyOwner}
                        title={onlyOwner ? "最後のオーナーは降格できません" : undefined}
                        onClick={() => onDemoteOwner(m.uid)}
                      >
                        運営へ降格
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
