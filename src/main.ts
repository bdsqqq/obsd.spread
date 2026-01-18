import { Plugin, BasesView, QueryController, ViewOption, TFile, App } from "obsidian";
import { Virtualizer, elementScroll } from "@tanstack/virtual-core";

const LOG_PATH = ".spread-debug.log";
let logBuffer: string[] = [];

async function initLog(app: App): Promise<void> {
  const timestamp = new Date().toISOString();
  logBuffer = [`=== spread plugin started ${timestamp} ===\n`];
  try {
    await app.vault.adapter.write(LOG_PATH, logBuffer.join(""));
  } catch (e) {
    console.error("spread: failed to init log", e);
  }
}

async function log(app: App, msg: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
  try {
    await app.vault.adapter.write(LOG_PATH, logBuffer.join(""));
  } catch {
    // ignore write errors
  }
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
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match: string, link: string, alias: string) => alias || link)
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

// virtualization constants
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
  index: number;
  entries: ProcessedEntry[];
  height: number;
}

class SpreadView extends BasesView {
  type = "spread-view";
  private scrollEl: HTMLElement;
  private containerEl: HTMLElement;
  private cardsEl: HTMLElement;
  private rowsEl: HTMLElement | null = null;

  private previewLines = 5;
  private showFileName = true;
  private stripFrontmatter = true;
  private monoFont = false;

  private renderTimeout: number | null = null;
  private lastRenderHash = "";

  private virtualizer: Virtualizer<HTMLElement, VirtualRow> | null = null;
  private rows: VirtualRow[] = [];
  private processedEntries: ProcessedEntry[] = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({ cls: "spread-view-container" });
    this.cardsEl = this.containerEl.createDiv({ cls: "spread-virtual-content" });
  }

  static getViewOptions(): ViewOption[] {
    return [
      {
        displayName: "Preview",
        type: "group",
        items: [
          {
            displayName: "Lines to show",
            type: "slider",
            key: "previewLines",
            min: 1,
            max: 20,
            step: 1,
            default: 5,
          },
          {
            displayName: "Show file name",
            type: "toggle",
            key: "showFileName",
            default: true,
          },
          {
            displayName: "Strip frontmatter",
            type: "toggle",
            key: "stripFrontmatter",
            default: true,
          },
          {
            displayName: "Monospace font",
            type: "toggle",
            key: "monoFont",
            default: false,
          },
        ],
      },
    ];
  }

  onload(): void {
    void initLog(this.app);
    void log(this.app, "onload called");
    this.loadConfig();
    this.setupResizeObserver();
    void this.render();
  }

  onunload(): void {
    if (this.renderTimeout !== null) {
      window.clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.cardsEl.empty();
  }

  onDataUpdated(): void {
    const entryCount = this.data?.data?.length ?? 0;
    void log(this.app, `onDataUpdated: ${entryCount} entries`);
    this.loadConfig();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderTimeout !== null) return;
    this.renderTimeout = window.setTimeout(() => {
      this.renderTimeout = null;
      void this.render();
    }, 250);
  }

  private loadConfig(): void {
    if (!this.config) return;

    const lines = this.config.get("previewLines");
    if (typeof lines === "number") {
      this.previewLines = Math.max(1, Math.min(20, lines));
    }

    const fileName = this.config.get("showFileName");
    if (typeof fileName === "boolean") {
      this.showFileName = fileName;
    }

    const frontmatter = this.config.get("stripFrontmatter");
    if (typeof frontmatter === "boolean") {
      this.stripFrontmatter = frontmatter;
    }

    const mono = this.config.get("monoFont");
    if (typeof mono === "boolean") {
      this.monoFont = mono;
    }
  }

  private computeCardHeight(lineCount: number): number {
    const headerHeight = this.showFileName ? HEADER_HEIGHT : 0;
    const contentLines = Math.min(lineCount, this.previewLines);
    const previewHeight = PREVIEW_PADDING + (contentLines * LINE_HEIGHT);
    return headerHeight + previewHeight + CARD_BORDER;
  }

  private async preprocessEntries(entries: { file?: TFile | null }[]): Promise<ProcessedEntry[]> {
    const results: ProcessedEntry[] = [];
    for (const entry of entries) {
      if (!entry.file || !(entry.file instanceof TFile)) continue;
      const preview = await this.getPreview(entry.file);
      const lineCount = preview.split('\n').length;
      const height = this.computeCardHeight(lineCount);
      results.push({ file: entry.file, preview, lineCount, height });
    }
    return results;
  }

  private groupIntoRows(entries: ProcessedEntry[], containerWidth: number): VirtualRow[] {
    const cardsPerRow = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
    const rows: VirtualRow[] = [];
    
    for (let i = 0; i < entries.length; i += cardsPerRow) {
      const rowEntries = entries.slice(i, i + cardsPerRow);
      const rowHeight = Math.max(...rowEntries.map(e => e.height));
      rows.push({ index: rows.length, entries: rowEntries, height: rowHeight });
    }
    return rows;
  }

  private setupVirtualizer(scrollEl: HTMLElement, rows: VirtualRow[]): void {
    this.virtualizer = new Virtualizer({
      count: rows.length,
      getScrollElement: () => scrollEl,
      estimateSize: (index) => rows[index].height,
      overscan: 3,
      scrollToFn: elementScroll,
    });
    
    this.virtualizer.subscribe(() => this.renderVisibleRows());
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.processedEntries.length > 0) {
        const containerWidth = this.containerEl.clientWidth;
        this.rows = this.groupIntoRows(this.processedEntries, containerWidth);
        this.setupVirtualizer(this.scrollEl, this.rows);
      }
    });
    this.resizeObserver.observe(this.containerEl);
  }

  private async render(): Promise<void> {
    if (!this.data) return;

    const entries = this.data.data ?? [];
    const hash = this.computeHash(entries);
    if (hash === this.lastRenderHash) {
      void log(this.app, `render: skipped, hash unchanged (${entries.length} entries)`);
      return;
    }
    this.lastRenderHash = hash;

    const t0 = performance.now();
    void log(this.app, `render: starting ${entries.length} entries`);

    this.cardsEl.empty();

    if (entries.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "spread-empty";
      emptyEl.textContent = "No files to display";
      this.cardsEl.appendChild(emptyEl);
      return;
    }

    this.processedEntries = await this.preprocessEntries(entries);
    void log(this.app, `render: preprocessed ${this.processedEntries.length} entries`);

    const containerWidth = this.containerEl.clientWidth || 800;
    this.rows = this.groupIntoRows(this.processedEntries, containerWidth);
    void log(this.app, `render: grouped into ${this.rows.length} rows`);

    this.rowsEl = this.cardsEl.createDiv({ cls: 'spread-virtual-rows' });
    this.setupVirtualizer(this.scrollEl, this.rows);
    this.renderVisibleRows();

    const total = performance.now() - t0;
    void log(this.app, `render: COMPLETE in ${total.toFixed(0)}ms`);
  }

  private renderVisibleRows(): void {
    if (!this.virtualizer || !this.rowsEl) return;

    const virtualRows = this.virtualizer.getVirtualItems();
    const totalSize = this.virtualizer.getTotalSize();

    this.cardsEl.style.height = `${totalSize}px`;

    const offset = virtualRows[0]?.start ?? 0;
    this.rowsEl.style.transform = `translateY(${offset}px)`;

    this.rowsEl.empty();
    for (const vRow of virtualRows) {
      const row = this.rows[vRow.index];
      const rowEl = this.createRowElement(row);
      rowEl.style.height = `${row.height}px`;
      this.rowsEl.appendChild(rowEl);
    }
  }

  private createRowElement(row: VirtualRow): HTMLElement {
    const rowEl = document.createElement('div');
    rowEl.className = 'spread-row';

    for (const entry of row.entries) {
      const cardEl = this.createCardSync(entry);
      cardEl.style.height = `${row.height}px`;
      rowEl.appendChild(cardEl);
    }
    return rowEl;
  }

  private createCardSync(entry: ProcessedEntry): HTMLElement {
    const cardEl = document.createElement("div");
    cardEl.className = "spread-card";

    if (this.showFileName) {
      const headerEl = document.createElement("div");
      headerEl.className = "spread-card-header";
      const linkEl = document.createElement("a");
      linkEl.className = "internal-link";
      linkEl.textContent = entry.file.basename;
      linkEl.href = entry.file.path;
      linkEl.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        void this.app.workspace.openLinkText("", entry.file.path, false);
      });
      headerEl.appendChild(linkEl);
      cardEl.appendChild(headerEl);
    }

    const previewEl = document.createElement("div");
    previewEl.className = "spread-card-preview";
    if (this.monoFont) {
      previewEl.classList.add("spread-card-mono");
    }
    previewEl.textContent = entry.preview;
    cardEl.appendChild(previewEl);

    return cardEl;
  }

  private computeHash(entries: { file?: TFile | null }[]): string {
    if (!entries.length) return "";
    const first = entries[0]?.file?.path ?? "";
    const mid = entries[Math.floor(entries.length / 2)]?.file?.path ?? "";
    const last = entries[entries.length - 1]?.file?.path ?? "";
    return `${entries.length}|${first}|${mid}|${last}`;
  }

  private async getPreview(file: TFile): Promise<string> {
    const ext = file.extension.toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return `[${ext} file]`;
    }

    try {
      let content = await this.app.vault.read(file);

      if (this.stripFrontmatter) {
        content = content.replace(FRONTMATTER_REGEX, "");
      }

      const isMarkdown = ext === "md" || ext === "markdown";
      if (isMarkdown) {
        content = stripMarkdown(content);
      }

      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, this.previewLines);
      return lines.join("\n") || "[empty]";
    } catch {
      return "[unable to read]";
    }
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
