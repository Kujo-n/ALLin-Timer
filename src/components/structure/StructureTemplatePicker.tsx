"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StructureTemplateCard } from "@/components/structure/StructureTemplateCard";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { listStructureTemplates } from "@/lib/firebase/repositories/structureTemplates";
import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
import { logger } from "@/lib/logger";

interface Props {
  onSelect: (template: StructureTemplateDoc) => void;
}

/**
 * `/structures/new` に差し込む、Firestore 取得のテンプレート選択 UI。
 * 件数 0 なら `/templates/new` への誘導リンクのみ表示する。
 */
export function StructureTemplatePicker({ onSelect }: Props) {
  const [items, setItems] = useState<StructureTemplateDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listStructureTemplates();
        if (!cancelled) setItems(list);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "テンプレート取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(formatErrorForDisplay(wrapped));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">テンプレート読込中…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        テンプレートがありません。
        <Link href="/templates/new" className="underline">
          /templates/new
        </Link>
        {" で作成できます。"}
      </p>
    );
  }
  return (
    <section aria-label="テンプレート選択" className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">
        テンプレートから読み込む（任意）
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((t) => (
          <StructureTemplateCard key={t.id} template={t} variant="picker" onApply={onSelect} />
        ))}
      </div>
    </section>
  );
}
