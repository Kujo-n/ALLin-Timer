"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * グローバルヘッダ（layout.tsx の `<header>`、ブランド「ALLin-PokerTimer」と同じ高さ）に
 * ページ固有のタイトル（例: トーナメント名）を中央表示するための仕組み。
 *
 * 利用側は `usePageTitle("Tournament Name")` をマウント中に呼ぶだけでよい。
 * unmount 時に自動的に title を null に戻す（他ページに遷移したときの残留を防ぐ）。
 *
 * Phase 4.14 追加要望: トーナメント受付 dashboard でトーナメント名を上部ヘッダの
 * 中央に出すため導入。
 */

interface PageTitleState {
  title: string | null;
  setTitle: (title: string | null) => void;
}

const Ctx = createContext<PageTitleState>({
  title: null,
  setTitle: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitleState] = useState<string | null>(null);
  // setTitle 参照を安定させて、消費側 effect の deps に乗せても余計な再実行を起こさない。
  const setTitle = useCallback((next: string | null) => {
    setTitleState(next);
  }, []);
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>;
}

/**
 * 呼び出すと、その間だけグローバルヘッダのタイトル slot に `title` が表示される。
 * `null` を渡すと表示されない（クリア用途）。
 */
export function usePageTitle(title: string | null): void {
  const { setTitle } = useContext(Ctx);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}

/** layout.tsx のヘッダ中央に置く slot。title 未設定なら何も描画しない。 */
export function PageTitleSlot() {
  const { title } = useContext(Ctx);
  if (!title) return null;
  return (
    <h1 className="truncate text-sm font-semibold sm:text-base" title={title}>
      {title}
    </h1>
  );
}
