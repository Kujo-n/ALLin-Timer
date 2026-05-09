import {
  CalendarClock,
  FileStack,
  Home,
  LayoutGrid,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavContext = {
  signedIn: boolean;
  currentGroupId: string | null;
};

type NavItem = {
  /** 静的 path、または context から動的に解決する関数（null を返すと隠れる） */
  href: string | ((ctx: NavContext) => string | null);
  label: string;
  icon: LucideIcon;
  /** 認証必須項目（未ログインでは隠す） */
  authOnly?: boolean;
  /** 追加の表示可否判定（false なら隠す） */
  visible?: (ctx: NavContext) => boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/groups", label: "サークル一覧", icon: Users, authOnly: true },
  { href: "/tournaments", label: "トーナメント一覧", icon: CalendarClock, authOnly: true },
  { href: "/structures", label: "ストラクチャ", icon: LayoutGrid, authOnly: true },
  { href: "/templates", label: "テンプレート", icon: FileStack, authOnly: true },
  // PRD 02 polish (タブ化) で「サウンド設定」エントリを廃止。
  //   サークル詳細画面「設定」タブ内 `AudioSettingsCard` に集約済み。サークル単位の設定であり、
  //   サイドバーの top-level entry を維持するメリットが薄いため重複を解消。
  //   旧 path `/groups/{gid}/audio-settings` は thin redirect で互換性維持。
  { href: "/settings", label: "アカウント設定", icon: Settings, authOnly: true },
];

export function resolveNavItems(items: NavItem[], ctx: NavContext): Array<NavItem & { href: string }> {
  const resolved: Array<NavItem & { href: string }> = [];
  for (const item of items) {
    if (item.authOnly && !ctx.signedIn) continue;
    if (item.visible && !item.visible(ctx)) continue;
    const href = typeof item.href === "function" ? item.href(ctx) : item.href;
    if (!href) continue;
    resolved.push({ ...item, href });
  }
  return resolved;
}
