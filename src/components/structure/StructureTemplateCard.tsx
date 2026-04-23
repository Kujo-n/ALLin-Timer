import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";

interface Props {
  template: StructureTemplateDoc;
  variant: "picker" | "library";
  canEdit?: boolean;
  canDelete?: boolean;
  onApply?: (t: StructureTemplateDoc) => void;
  onEdit?: (t: StructureTemplateDoc) => void;
  onDelete?: (t: StructureTemplateDoc) => void;
}

export function StructureTemplateCard({
  template: t,
  variant,
  canEdit,
  canDelete,
  onApply,
  onEdit,
  onDelete,
}: Props) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t.name}</CardTitle>
        {t.description ? <CardDescription>{t.description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="mt-auto space-y-2 text-xs text-muted-foreground">
        <div>
          初期 {t.initialStack.toLocaleString()} / {t.levels.length} レベル
        </div>
        <div>作成者: {t.createdByDisplayName}</div>
        <div className="flex flex-wrap gap-2 pt-2">
          {variant === "picker" && onApply ? (
            <Button size="sm" variant="outline" onClick={() => onApply(t)}>
              このテンプレを使う
            </Button>
          ) : null}
          {variant === "library" && canEdit && onEdit ? (
            <Button size="sm" variant="outline" onClick={() => onEdit(t)}>
              編集
            </Button>
          ) : null}
          {variant === "library" && canDelete && onDelete ? (
            <Button size="sm" variant="destructive" onClick={() => onDelete(t)}>
              削除
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
