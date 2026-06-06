"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type TabKey = "members" | "season" | "settings";

const GROUP_DETAIL_TAB_KEYS = ["members", "season", "settings"] as const;

export function isTabKey(value: string | null | undefined): value is TabKey {
  return (
    value !== null &&
    value !== undefined &&
    (GROUP_DETAIL_TAB_KEYS as readonly string[]).includes(value)
  );
}

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: readonly TabDef[] = [
  { key: "members", label: "メンバー" },
  { key: "season", label: "シーズン" },
  { key: "settings", label: "設定" },
];

interface GroupDetailTabsProps {
  activeTab: TabKey;
  onChange: (next: TabKey) => void;
  children: { [K in TabKey]: ReactNode };
}

/**
 * サークル詳細画面の 3 タブ切替ラッパ。
 *
 * PRD 02 polish (タブ化) で `group-detail-client.tsx` から分離。
 * 既存の `role="tablist"` パターン（login-client.tsx / join-client.tsx）を
 * mirror しつつ、3 タブ等幅 grid + tabpanel ロール付与で a11y を強化。
 * children は `{ members, season, settings }` の map で受け取り、
 * 非アクティブ panel は `hidden` 属性で DOM から外す（render は維持され state 保持）。
 */
export function GroupDetailTabs({ activeTab, onChange, children }: GroupDetailTabsProps) {
  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="サークル詳細"
        className="grid grid-cols-3 gap-1 border-b text-sm"
      >
        {TABS.map(({ key, label }) => {
          const selected = activeTab === key;
          return (
            <button
              key={key}
              id={`group-detail-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`group-detail-panel-${key}`}
              onClick={() => onChange(key)}
              className={cn(
                "border-b-2 px-3 py-2 transition-colors",
                selected
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {TABS.map(({ key }) => (
        <div
          key={key}
          id={`group-detail-panel-${key}`}
          role="tabpanel"
          aria-labelledby={`group-detail-tab-${key}`}
          hidden={activeTab !== key}
          className="space-y-6"
        >
          {children[key]}
        </div>
      ))}
    </div>
  );
}
