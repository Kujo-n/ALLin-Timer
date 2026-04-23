import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";

import { StructureTemplateCard } from "./StructureTemplateCard";

const ts = Timestamp.fromMillis(1_700_000_000_000);

function makeTemplate(overrides: Partial<StructureTemplateDoc> = {}): StructureTemplateDoc {
  return {
    id: "t1",
    name: "標準 20min",
    description: "平均的な進行",
    initialStack: 10000,
    rebuyStack: null,
    addOnStack: null,
    lateEntryDeadlineLevel: 6,
    levels: [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
    ],
    createdByUid: "u-author",
    createdByDisplayName: "たろう",
    createdAt: ts,
    ...overrides,
  };
}

describe("StructureTemplateCard — library variant", () => {
  it("shows both 編集 and 削除 for owner (canEdit + canDelete)", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="library"
        canEdit
        canDelete
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "編集" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("shows only 削除 for admin (non-owner)", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="library"
        canEdit={false}
        canDelete
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
  });

  it("shows neither for non-owner / non-admin", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="library"
        canEdit={false}
        canDelete={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("does not render picker CTA even if onApply is provided", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="library"
        canEdit
        onApply={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "このテンプレを使う" })).not.toBeInTheDocument();
  });
});

describe("StructureTemplateCard — picker variant", () => {
  it("shows 'このテンプレを使う' and not library buttons", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="picker"
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "このテンプレを使う" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
  });

  it("renders creator name and level count", () => {
    render(
      <StructureTemplateCard
        template={makeTemplate()}
        variant="picker"
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/たろう/)).toBeInTheDocument();
    expect(screen.getByText(/2 レベル/)).toBeInTheDocument();
  });
});
