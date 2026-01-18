# obsd.spread

text file previews as cards in obsidian [bases](https://obsidian.md/blog/introducing-obsidian-bases/).

## why

bases shows images as card covers, but most of my vault is text. wanted to see content at a glance without opening each file.

also: my vault has 70k files. bases card views with 16k entries would hang for 69+ seconds creating DOM nodes. needed virtualization.

## install

```bash
cd /path/to/vault/.obsidian/plugins
git clone https://github.com/bdsqqq/obsd.spread.git
cd obsd.spread && npm install && npm run build
```

enable in settings → community plugins. open a base, configure view → "Spread".

## config

| option | default | why |
|--------|---------|-----|
| lines to show | 5 | more lines = taller cards, fewer per screen |
| strip frontmatter | true | yaml metadata is noise in previews |
| monospace font | false | useful for code-heavy vaults |

## internals

row-based virtualization via [@tanstack/virtual-core](https://tanstack.com/virtual).

why rows, not cards? cards have variable heights (based on line count). virtualizing individual cards in a masonry layout is complex — tanstack doesn't support it natively. virtualizing rows is simpler: group cards into rows, each row's height is its tallest card, virtualize the rows.

preprocessing reads all files once upfront. heights are computed from `headerHeight + min(lineCount, maxLines) * lineHeight`. no async during scroll.

## dev

```bash
npm run dev    # watch
npm run build  # prod
```

## license

MIT
