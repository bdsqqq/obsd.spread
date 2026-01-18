import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
  Plugin: class {},
  BasesView: class {
    constructor(_controller: unknown) {}
  },
  TFile: class {},
}));

import {
  stripMarkdown,
  groupIntoRows,
  computeHash,
  CARD_MIN_WIDTH,
  CARD_GAP,
  type ProcessedEntry,
} from "./main";

describe("stripMarkdown", () => {
  it("removes headings", () => {
    expect(stripMarkdown("# Heading")).toBe("Heading");
    expect(stripMarkdown("### Third level")).toBe("Third level");
  });

  it("removes bold and italic", () => {
    expect(stripMarkdown("**bold** and *italic*")).toBe("bold and italic");
    expect(stripMarkdown("__also bold__ and _also italic_")).toBe("also bold and also italic");
  });

  it("removes strikethrough", () => {
    expect(stripMarkdown("~~deleted~~")).toBe("deleted");
  });

  it("removes inline code", () => {
    expect(stripMarkdown("`code`")).toBe("code");
  });

  it("extracts link text from markdown links", () => {
    expect(stripMarkdown("[link text](https://example.com)")).toBe("link text");
  });

  it("removes images entirely", () => {
    expect(stripMarkdown("![alt text](image.png)")).toBe("");
  });

  it("handles wikilinks with aliases", () => {
    expect(stripMarkdown("[[note]]")).toBe("note");
    expect(stripMarkdown("[[note|alias]]")).toBe("alias");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("removes list markers", () => {
    expect(stripMarkdown("- item")).toBe("item");
    expect(stripMarkdown("* item")).toBe("item");
    expect(stripMarkdown("1. item")).toBe("item");
  });

  it("collapses multiple newlines", () => {
    expect(stripMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("groupIntoRows", () => {
  const mockEntry = (path: string, height: number): ProcessedEntry =>
    ({ file: { path, basename: path } as ProcessedEntry["file"], preview: "", lineCount: 1, height });

  it("returns empty array for empty input", () => {
    expect(groupIntoRows([], 800)).toEqual([]);
  });

  it("groups entries into rows based on container width", () => {
    const entries = [mockEntry("a", 100), mockEntry("b", 100), mockEntry("c", 100)];
    const rows = groupIntoRows(entries, 800);
    const cardsPerRow = Math.floor((800 + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP));
    expect(rows.length).toBe(Math.ceil(3 / cardsPerRow));
  });

  it("uses max height of entries in row", () => {
    const entries = [mockEntry("a", 100), mockEntry("b", 200), mockEntry("c", 150)];
    const rows = groupIntoRows(entries, 2000);
    expect(rows[0].height).toBe(200);
  });

  it("handles single entry", () => {
    const entries = [mockEntry("a", 100)];
    const rows = groupIntoRows(entries, 800);
    expect(rows.length).toBe(1);
    expect(rows[0].entries.length).toBe(1);
  });

  it("handles narrow container (1 card per row)", () => {
    const entries = [mockEntry("a", 100), mockEntry("b", 100)];
    const rows = groupIntoRows(entries, CARD_MIN_WIDTH);
    expect(rows.length).toBe(2);
  });
});

describe("computeHash", () => {
  it("returns empty string for empty array", () => {
    expect(computeHash([])).toBe("");
  });

  it("includes count and paths", () => {
    const entries = [{ file: { path: "a.md" } }, { file: { path: "b.md" } }, { file: { path: "c.md" } }];
    const hash = computeHash(entries);
    expect(hash).toBe("3|a.md|b.md|c.md");
  });

  it("handles null/undefined files gracefully", () => {
    const entries = [{ file: null }, { file: { path: "b.md" } }];
    expect(computeHash(entries)).toBe("2||b.md|b.md");
  });

  it("samples first, middle, last for large arrays", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ file: { path: `${i}.md` } }));
    const hash = computeHash(entries);
    expect(hash).toBe("100|0.md|50.md|99.md");
  });
});
