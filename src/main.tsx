import { Plugin, BasesView, QueryController, ViewOption, TFile } from "obsidian";
import { render } from "preact";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback } from "preact/hooks";

const DEBUG = false;

function log(msg: string): void {
  if (DEBUG) console.debug(`[spread] ${msg}`);
}

const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n?/;

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, link, alias) => alias || link)
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^(\s*[-*_]){3,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp",
  "mp3", "wav", "ogg", "flac", "m4a",
  "mp4", "webm", "mkv", "avi", "mov",
  "pdf", "zip", "tar", "gz", "7z", "rar",
  "exe", "dll", "so", "dylib",
  "woff", "woff2", "ttf", "otf", "eot",
]);

const CARD_MIN_WIDTH = 250;
const CARD_GAP = 12;
const HEADER_HEIGHT = 39;
const PREVIEW_PADDING = 24;
const LINE_HEIGHT = 20;
const CARD_BORDER = 2;

interface ProcessedEntry {
  file: TFile;
  preview: string;
  lineCount: number;
  height: number;
}

interface VirtualRow {
  entries: ProcessedEntry[];
  height: number;
}

interface SpreadCardsProps {
  rows: VirtualRow[];
  scrollEl: HTMLElement;
  showFileName: boolean;
  monoFont: boolean;
  onOpenFile: (path: string) => void;
}

function SpreadCards({ rows, scrollEl, showFileName, monoFont, onOpenFile }: SpreadCardsProps) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => rows[i].height,
    overscan: 3,
  });

  const handleKeyDown = useCallback((e: KeyboardEvent, path: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenFile(path);
    }
  }, [onOpenFile]);

  const handleClick = useCallback((e: MouseEvent, path: string) => {
    e.preventDefault();
    onOpenFile(path);
  }, [onOpenFile]);

  return (
    <div
      class="spread-virtual-content"
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      <div
        class="spread-virtual-rows"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)`,
        }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index];
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              class="spread-row"
              style={{ height: row.height }}
            >
              {row.entries.map((entry) => (
                <div key={entry.file.path} class="spread-card" style={{ height: row.height }}>
                  {showFileName && (
                    <div class="spread-card-header">
                      <a
                        class="internal-link"
                        href={entry.file.path}
                        onClick={(e) => handleClick(e as unknown as MouseEvent, entry.file.path)}
                        onKeyDown={(e) => handleKeyDown(e as unknown as KeyboardEvent, entry.file.path)}
                      >
                        {entry.file.basename}
                      </a>
                    </div>
                  )}
                  <div class={`spread-card-preview ${monoFont ? "spread-card-mono" : ""}`}>
                    {entry.preview}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState() {
  return <div class="spread-empty">No files to display</div>;
}

class SpreadView extends BasesView {
  type = "spread-view";
  private scrollEl: HTMLElement;
  private containerEl: HTMLElement;
  private mountEl: HTMLElement;

  private previewLines = 5;
  private showFileName = true;
  private stripFrontmatter = true;
  private monoFont = false;

  private renderTimeout: number | null = null;
  private resizeTimeout: number | null = null;
  private lastRenderHash = "";
  private resizeObserver: ResizeObserver | null = null;
  private processedEntries: ProcessedEntry[] = [];

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({ cls: "spread-view-container" });
    this.mountEl = this.containerEl.createDiv();
  }

  static getViewOptions(): ViewOption[] {
    return [
      {
        displayName: "Preview",
        type: "group",
        items: [
          { displayName: "Lines to show", type: "slider", key: "previewLines", min: 1, max: 20, step: 1, default: 5 },
          { displayName: "Show file name", type: "toggle", key: "showFileName", default: true },
          { displayName: "Strip frontmatter", type: "toggle", key: "stripFrontmatter", default: true },
          { displayName: "Monospace font", type: "toggle", key: "monoFont", default: false },
        ],
      },
    ];
  }

  onload(): void {
    log("onload called");
    this.loadConfig();
    this.setupResizeObserver();
    void this.renderView();
  }

  onunload(): void {
    if (this.renderTimeout !== null) {
      window.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    if (this.resizeTimeout !== null) {
      window.clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.processedEntries = [];
    this.lastRenderHash = "";
    render(null, this.mountEl);
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.processedEntries.length === 0) return;
      if (this.resizeTimeout !== null) return;
      this.resizeTimeout = window.setTimeout(() => {
        this.resizeTimeout = null;
        this.rerenderWithCurrentEntries();
      }, 100);
    });
    this.resizeObserver.observe(this.containerEl);
  }

  private rerenderWithCurrentEntries(): void {
    const containerWidth = this.containerEl.clientWidth || 800;
    const rows = this.groupIntoRows(this.processedEntries, containerWidth);
    render(
      <SpreadCards
        rows={rows}
        scrollEl={this.scrollEl}
        showFileName={this.showFileName}
        monoFont={this.monoFont}
        onOpenFile={(path) => void this.app.workspace.openLinkText("", path, false)}
      />,
      this.mountEl
    );
  }

  onDataUpdated(): void {
    log(`onDataUpdated: ${this.data?.data?.length ?? 0} entries`);
    this.loadConfig();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderTimeout !== null) return;
    this.renderTimeout = window.setTimeout(() => {
      this.renderTimeout = null;
      void this.renderView();
    }, 250);
  }

  private loadConfig(): void {
    if (!this.config) return;
    const lines = this.config.get("previewLines");
    if (typeof lines === "number") this.previewLines = Math.max(1, Math.min(20, lines));
    const fileName = this.config.get("showFileName");
    if (typeof fileName === "boolean") this.showFileName = fileName;
    const frontmatter = this.config.get("stripFrontmatter");
    if (typeof frontmatter === "boolean") this.stripFrontmatter = frontmatter;
    const mono = this.config.get("monoFont");
    if (typeof mono === "boolean") this.monoFont = mono;
  }

  private computeCardHeight(lineCount: number): number {
    const headerHeight = this.showFileName ? HEADER_HEIGHT : 0;
    const contentLines = Math.min(lineCount, this.previewLines);
    return headerHeight + PREVIEW_PADDING + contentLines * LINE_HEIGHT + CARD_BORDER;
  }

  private async getPreview(file: TFile): Promise<string> {
    const ext = file.extension.toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return `[${ext} file]`;

    try {
      let content = await this.app.vault.read(file);
      if (this.stripFrontmatter) content = content.replace(FRONTMATTER_REGEX, "");
      if (ext === "md" || ext === "markdown") content = stripMarkdown(content);

      const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).slice(0, this.previewLines);
      return lines.join("\n") || "[empty]";
    } catch {
      return "[unable to read]";
    }
  }

  private async preprocessEntries(entries: { file?: TFile | null }[]): Promise<ProcessedEntry[]> {
    const valid = entries.filter((e): e is { file: TFile } => e.file instanceof TFile);
    const previews = await Promise.all(valid.map((e) => this.getPreview(e.file)));
    return valid.map((entry, i) => {
      const preview = previews[i];
      const lineCount = preview.split("\n").length;
      return { file: entry.file, preview, lineCount, height: this.computeCardHeight(lineCount) };
    });
  }

  private groupIntoRows(entries: ProcessedEntry[], containerWidth: number): VirtualRow[] {
    const cardsPerRow = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
    const rows: VirtualRow[] = [];
    for (let i = 0; i < entries.length; i += cardsPerRow) {
      const rowEntries = entries.slice(i, i + cardsPerRow);
      rows.push({ entries: rowEntries, height: Math.max(...rowEntries.map((e) => e.height)) });
    }
    return rows;
  }

  private computeHash(entries: { file?: TFile | null }[]): string {
    if (!entries.length) return "";
    const first = entries[0]?.file?.path ?? "";
    const mid = entries[Math.floor(entries.length / 2)]?.file?.path ?? "";
    const last = entries[entries.length - 1]?.file?.path ?? "";
    return `${entries.length}|${first}|${mid}|${last}`;
  }

  private async renderView(): Promise<void> {
    if (!this.data) return;

    const entries = this.data.data ?? [];
    const hash = this.computeHash(entries);
    if (hash === this.lastRenderHash) {
      log("render: skipped (hash unchanged)");
      return;
    }
    this.lastRenderHash = hash;

    const t0 = performance.now();
    log(`render: starting ${entries.length} entries`);

    if (entries.length === 0) {
      render(<EmptyState />, this.mountEl);
      return;
    }

    this.processedEntries = await this.preprocessEntries(entries);
    const containerWidth = this.containerEl.clientWidth || 800;
    const rows = this.groupIntoRows(this.processedEntries, containerWidth);

    log(`render: ${this.processedEntries.length} entries → ${rows.length} rows`);

    render(
      <SpreadCards
        rows={rows}
        scrollEl={this.scrollEl}
        showFileName={this.showFileName}
        monoFont={this.monoFont}
        onOpenFile={(path) => void this.app.workspace.openLinkText("", path, false)}
      />,
      this.mountEl
    );

    log(`render: COMPLETE in ${(performance.now() - t0).toFixed(0)}ms`);
  }
}

export default class SpreadPlugin extends Plugin {
  async onload() {
    this.registerBasesView("spread-view", {
      name: "Spread",
      icon: "file-text",
      factory: (controller, containerEl) => new SpreadView(controller, containerEl),
      options: () => SpreadView.getViewOptions(),
    });
  }

  onunload() {}
}
