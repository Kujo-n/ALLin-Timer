"use client";

import { useEffect, useState } from "react";

/**
 * Phase D: Web Share API での画像 (File) 共有が可能かを CSR mount 後に判定する hook。
 *
 *  - SSR では常に "loading" を返す（hydration mismatch 防止のため、初回 render は
 *    必ず "loading" 状態にする）。
 *  - CSR mount 後、`navigator.canShare?.({ files: [<1×1 PNG dummy file>] })` で判定。
 *  - 結果は state に保持し、失敗（DOMException 等）はすべて false 扱い。
 */
export type CanShareState = boolean | "loading";

export function useCanShareImage(): CanShareState {
  const [state, setState] = useState<CanShareState>("loading");

  useEffect(() => {
    try {
      if (
        typeof navigator === "undefined" ||
        typeof navigator.canShare !== "function"
      ) {
        setState(false);
        return;
      }
      // 毎回新規 File を生成する（Safari は再利用 File で false を返すケースが報告されている）
      const dummy = new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
        "probe.png",
        { type: "image/png" },
      );
      setState(navigator.canShare({ files: [dummy] }));
    } catch {
      setState(false);
    }
  }, []);

  return state;
}
