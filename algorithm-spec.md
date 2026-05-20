# Sonder Blocks Export — Algorithm Spec

## Overview

The plugin exports the currently selected Figma node(s) as WordPress block markup, copied to the clipboard. Multiple selected nodes are exported as siblings in one output.

---

## Naming Conventions

Any Figma layer name can include two optional suffixes:

| Syntax | Purpose | Example |
|--------|---------|---------|
| `// classes` | CSS classes to inject into `className` | `section // bg-pc-700 relative` |
| `\|\| type` | Element type override | `Heading \|\| h1` |

For **image nodes**, the layer name before `//` is used as the image filename/alt text.

---

## Phase 1 — Classification

Each node is evaluated against the following rules in priority order. First match wins.

### Priority 1 — Explicit Name Match

Layer name (before `//` or `||`) exactly matches a known block identifier:

| Identifier | Block |
|-----------|-------|
| `section` | `sonder/section` |
| `container` | `sonder/container` |
| `div` | `sonder/div` |
| `columns` | `sonder/columns` |
| `column` | `sonder/column` |
| `grid` | `sonder/grid` |
| `grid-item` | `sonder/grid-item` |
| `button-new` | `sonder/button-new` |
| `icon` | `sonder/icon` |
| `bg-image` | `sonder/bg-image` |
| `youtube` | `sonder/youtube` |
| `vimeo` | `sonder/vimeo` |
| `list` | `sonder/list` |
| `list-item` | `sonder/list-item` |
| `heading` | `core/heading` |
| `paragraph` | `core/paragraph` |
| `spacer` | `core/spacer` |
| `divider` | `core/separator` |

### Priority 2 — Component Registry Match

Node is a Figma component instance. Lookup against a config-driven registry:

| Component name pattern | Block |
|----------------------|-------|
| `Button` | `sonder/button-new` |
| `Youtube player` | `sonder/youtube` (empty) |
| `icon-*` prefix | `sonder/icon` |
| `svg` prefix | `sonder/icon` |
| `Tag` | `core/paragraph` className=`tag` |
| `Tag` + layer says `button` | `sonder/button-new` |
| `jpg` or `png` prefix | `sonder/bg-image` (rasterized export) |
| Main Navigation, Logo, Search, Hamburger Menu | **Skip** |
| Unknown | HTML warning block (see Fallback) |

### Priority 3 — Structural Inference

Applied when no explicit name or component match is found. Rules fire in order:

| # | Condition | Block |
|---|-----------|-------|
| 3a | TEXT node, text style is a heading type | `core/heading` |
| 3b | TEXT node, text style is body/lead/intro | `core/paragraph` |
| 3c | Node has image fill, no children | `sonder/bg-image` |
| 3d | Node has image fill + children | `sonder/div` wrapper containing `sonder/bg-image` + children |
| 3e | Node has `maxWidth` bound to `Global/--container-width` | `sonder/container` |
| 3f | Horizontal auto-layout, children look like columns | `sonder/columns` |
| 3g | Direct child of a `columns` node | `sonder/column` (width derived from proportion) |
| 3h | Direct child of a `grid` node | `sonder/grid-item` |
| 3i | Frame contains single LINE child | `core/separator` |
| 3j | Vertical auto-layout, full-width | `sonder/section` |
| 3k | Any other auto-layout or frame | `sonder/div` |

### Priority 4 — Fallback

Emit a visible HTML warning block in the WP block editor:

```html
<!-- wp:html -->
<div style="background:#fff3cd;padding:12px;border-left:4px solid #f0a500;font-family:monospace;font-size:13px;">
  ⚠️ No block mapping found for: "NodeName"
</div>
<!-- /wp:html -->
```

---

## Auto-Layout → CSS Classes

All auto-layout nodes get flex classes derived from their layout direction:

| Layout | Classes |
|--------|---------|
| Horizontal | `flex` |
| Horizontal + wrap | `flex flex-wrap` |
| Vertical | `flex flex-col` |

### Gap Classes

| Condition | Output |
|-----------|--------|
| Gap bound to a variable | Variable name as class (e.g. `col-gap-lg`) |
| Gap is a raw number | Snap to nearest Tailwind `gap-{n}` |

---

## Column Width Detection

Applies to children of any horizontal auto-layout parent. Width is calculated as a fraction of the parent width, then snapped (±5% tolerance):

| Fraction | Class |
|----------|-------|
| ~1/1 | `w-full` |
| ~1/2 | `w-full md:w-1/2` |
| ~1/3 | `w-full md:w-1/2 lg:w-1/3` |
| ~2/3 | `w-full md:w-2/3` |
| ~1/4 | `w-full md:w-1/2 lg:w-1/4` |
| ~3/4 | `w-full md:w-3/4` |

Outside tolerance → flag for designer to use explicit `//` naming.

---

## Absolute Positioning

Triggered when `node.layoutPositioning === "ABSOLUTE"`.

1. Always inject `absolute` class
2. Calculate position values relative to parent:
   - `top` = `node.y`
   - `left` = `node.x`
   - `bottom` = `parent.height - (node.y + node.height)`
   - `right` = `parent.width - (node.x + node.width)`
3. Snap each value to nearest Tailwind spacing value (±3px tolerance)
4. If all four sides equal → `inset-{n}` (or `-inset-{n}` if negative)
5. If top=bottom AND left=right → `inset-x-{n} inset-y-{m}`
6. Otherwise → individual `top-{n} right-{n} bottom-{n} left-{n}`
7. If any side falls outside tolerance → inline style for that side
8. If node has children → always emit `sonder/div` wrapper

---

## Text Node Classification

### Style → Block Type

| Text style prefix | Block | Notes |
|------------------|-------|-------|
| `type/hero-lg`, `type/hero`, `type/hero-sm`, `type/h1`, `type/h2`–`type/h6` | `core/heading` | Level assigned dynamically |
| `type/lead`, `type/intro`, `type/body-*` | `core/paragraph` | Style name as class |
| `buttons/*` | Ignored | Inside component, not a standalone block |

### Heading Level Assignment (Dynamic Per Section)

1. Scan section for all heading-type text nodes
2. Collect unique styles, sort by font size (largest first)
3. Assign h2 to the largest, h3 to next, h4, h5, h6 in order
4. Style name (without `type/` prefix) always added as className

**Weight order:** `hero-lg → hero → hero-sm → h1 → h2 → h3 → h4 → h5 → h6`

**h1 is override-only** via `|| h1`. Any `||` tag overrides the dynamic level assignment.

---

## Color Mapping

Figma color style names → CSS class names:

1. Strip `brand/` prefix if present
2. Replace `/` with `-`

Examples:
- `brand/pc/700` → `pc-700` → `bg-pc-700` / `text-pc-700`
- `gray/300` → `gray-300`
- `text/500` → `text-500`

---

## Serialization Rules

| Block | Key attributes |
|-------|---------------|
| `sonder/section`, `sonder/div` | `customLabel` = layer name (stripped of `//` and `\|\|`) |
| `core/heading` | `level` from dynamic assignment or `\|\|` override, `className` from style + `//` |
| `core/paragraph` | `className` from style name + `//` |
| `sonder/button-new` | `content` from child text node's `characters` |
| `sonder/youtube` | Empty placeholder block |
| `core/spacer` | `height` from node height in px |
| `core/separator` | `className` from padding snap, `backgroundColor` from LINE stroke color style |
| `sonder/bg-image` | `mediaId` placeholder, base64 image data, filename from layer name |

`className` on any block = auto-generated classes + designer's `//` classes, merged in that order.

---

## Image Export

Settings (editable in plugin UI, with defaults):

| Setting | Default |
|---------|---------|
| Export images | On |
| Max size | 1920px (longest edge, proportional scale) |
| JPG quality | 80% |

### Format Decision

| Condition | Format |
|-----------|--------|
| Layer name has `png` prefix | PNG |
| Image has transparency | PNG |
| Everything else | JPG |

### Size Threshold

If total output exceeds ~500kb:
- Strip base64 images back to filename placeholders
- Show warning in plugin UI

---

## Phase 2 — Hierarchy Resolution

1. Read `figma.currentPage.selection`
2. For each selected node, walk the tree depth-first
3. Classify each node (Phase 1)
4. Self-closing blocks → extract attributes, stop descending
5. Container blocks → recurse into children, wrap output
6. Auto-insert `sonder/bg-image` before other children when image fill + children detected
7. All selected nodes exported as siblings in one output

---

## Editable Config

The following are data-driven and can be surfaced as a visual config UI:

- Block identifier → block name registry
- Component name → block mapping
- Color style → CSS class mapping
- Column fraction → responsive class mapping
- Tailwind spacing snap values
