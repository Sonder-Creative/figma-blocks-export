# Sonder Blocks Export — Figma Setup Guide

This guide explains how to name and structure your Figma layers so the export plugin produces clean, predictable WordPress block output. The plugin reads layer names, text styles, and component types — so the names you give things matter.

---

## The Naming Syntax

Every layer name can carry three optional pieces of information, separated by special characters:

```
identifier // css-classes || element-override
```

| Part | What it does | Example |
|------|-------------|---------|
| `identifier` | Tells the plugin what block type to use | `section`, `column`, `heading` |
| `// css-classes` | Adds Tailwind CSS classes to the block | `// bg-pc-700 text-white` |
| `\|\| element-override` | Forces a specific block type regardless of content | `\|\| h1`, `\|\| png` |

**Examples:**

| Layer Name | What it produces |
|------------|-----------------|
| `section` | A plain section block |
| `section // h-screen` | A section block with the class `h-screen` |
| `column // w-full md:w-1/2` | A column block with custom width classes |
| `heading \|\| h1` | Forces an h1 heading regardless of text style |
| `Hero photo \|\| png` | An image block with alt text "Hero photo" |

---

## Page Structure

A typical section should follow this nesting order. The plugin understands this structure and maps it correctly.

```
section
  └── container
        └── columns
              ├── column
              │     ├── Heading        ← TEXT layer with a heading text style
              │     ├── Lead           ← TEXT layer with a paragraph text style
              │     └── Button Group
              │           └── Button   ← Button component
              └── column
                    └── Hero photo || png   ← Image layer with alt text
```

### Layout identifiers

| Layer Name | Block Output | Notes |
|------------|-------------|-------|
| `section` | `sonder/section` | Top-level section wrapper |
| `footer` | `sonder/section` with `tag: "footer"` | Use this name for the footer section only |
| `container` | `sonder/container` | Constrains content to the site container width |
| `columns` | `sonder/columns` | Horizontal column wrapper |
| `column` | `sonder/column` | Individual column — width is calculated from its proportion of the parent |
| `div` | `sonder/div` | Generic wrapper for anything that doesn't fit the above |
| `grid` | `sonder/grid` | Grid wrapper |
| `grid-item` | `sonder/grid-item` | Grid cell |
| `list` | `sonder/list` | List wrapper |
| `list-item` | `sonder/list-item` | List item |
| `spacer` | `core/spacer` | Blank vertical space block — height is taken from the layer height |
| `divider` | `core/separator` | Horizontal rule |

---

## Text Layers

The plugin uses your **Figma text styles** to determine heading levels and paragraph types. The text layer's name acts as a fallback identifier, but the style does the heavy lifting.

### Heading text styles

Apply one of these text styles to a TEXT layer and it will become a `core/heading` block. The plugin automatically assigns heading levels (h2–h6) based on visual weight — the largest heading style in a section becomes h2, the next becomes h3, and so on.

| Text Style Name | Notes |
|-----------------|-------|
| `type/hero-lg` | Heaviest — becomes h2 in most sections |
| `type/hero` | |
| `type/hero-sm` | |
| `type/h1` | |
| `type/h2` | |
| `type/h3` | |
| `type/h4` | |
| `type/h5` | |
| `type/h6` | |

To force a specific heading level regardless of weight, use the `||` override on the layer name:

```
My Heading Layer || h1
```

### Paragraph text styles

These text styles produce `core/paragraph` blocks.

| Text Style Name | Notes |
|-----------------|-------|
| `type/lead` | |
| `type/intro` | |
| `type/body-lg` | |
| `type/body` | |
| `type/body-sm` | |
| `type/body-xs` | |

### Naming a text layer explicitly

If you'd rather use the layer name (e.g. when no text style is applied), these names work:

| Layer Name | Block Output |
|------------|-------------|
| `heading` | `core/heading` (h2 by default) |
| `h1` – `h6` | `core/heading` at that specific level |
| `paragraph` | `core/paragraph` |

---

## Images & Backgrounds

### Image layers

Any frame with an image fill is exported automatically. The plugin picks the format based on the layer:

- **PNG** is used when the node or any fill has reduced opacity (transparency detected)
- **JPG** is used for fully opaque layers

**Everything before the `||` becomes the image's alt text**, which WordPress also uses to name the file on import. So write something descriptive.

#### Forcing a specific format

Use `|| png` or `|| jpg` at the end of the layer name to force a format, override the auto-detection, or export a whole group of layers as a single flattened image.

```
Hero photo of the team || png
Product shot on white background || jpg
```

| Layer Name | Alt text | Format |
|------------|----------|--------|
| `Hero photo of the team \|\| png` | "Hero photo of the team" | PNG (forced) |
| `Product shot on white \|\| jpg` | "Product shot on white" | JPG (forced) |
| A frame with a semi-transparent fill | *(layer name)* | PNG (auto) |
| A frame with a fully opaque image fill | *(layer name)* | JPG (auto) |

> **When to use `|| png` or `|| jpg`:** Mostly for whole-section flattened exports, or when you need to flip a transparent PNG to JPG or vice versa. For regular image frames with fills, the format is picked for you.

You can combine `//` classes and `||` on the same layer:

```
Full-width banner image // aspect-video || png
```

If the image fill has a **locked aspect ratio** (Fill/Crop scale mode in Figma), the aspect ratio class is preserved in the output.

### Background layers (absolute positioned)

Layers named `background` or `bg` that are set to **absolute positioning** in Figma are treated specially:

- They receive `absolute inset-0` (full-cover) when they fill the parent frame entirely.
- Their sibling layers automatically receive a `relative` class so stacking works correctly in HTML.
- If the background is only partially covering the parent (e.g. a decorative offset shape), the closest Tailwind position values (`top-`, `left-`, `right-`, `bottom-`) are calculated and applied.

```
section
  ├── background  ← absolute, fills section → gets "absolute inset-0"
  └── container   ← gets "relative" automatically
        └── columns
              └── ...
```

> **Important:** Only layers named exactly `background` or `bg` receive this treatment. Any other absolutely positioned layer is ignored.

---

## Buttons & Links

### Button components

Place a **Button** component from the library. The plugin reads the component's variant properties and maps them automatically.

| Figma Variant | Class output |
|---------------|-------------|
| Regular | `button` |
| Small | `button-sm` |
| Large | `button-lg` |
| Outline Regular | `button outlined` |
| Outline Small | `button-sm outlined` |
| Outline Large | `button-lg outlined` |

The button colour (primary/secondary/tertiary/quaternary) is derived from the fill colour token on the component.

### Button frames (non-component)

If you build a button as a regular frame rather than a component instance, name it `button`, `button-sm`, or `button-lg`. The plugin will:

1. Find the first text child and use it as the button label.
2. Look for a child layer named `icon-*` and wire it up as the button icon.
3. Apply the correct size class.

```
button
  ├── icon-arrow-right   ← becomes iconName + iconUrl
  └── Click me           ← becomes the button label (content)
```

Output:
```
<!-- wp:sonder/button-new {"content":"Click me","iconName":"icon-arrow-right","iconUrl":"#icon-arrow-right","className":"button icon-sm inline-flex items-center"} /-->
```

### Link frames

Name the frame `link` (instead of `button`) to produce the same output **without** the `button` size class — useful for text links styled outside the button system.

```
link // be:my-4
  ├── icon-chevron-right
  └── Read more
```

Output:
```
<!-- wp:sonder/button-new {"content":"Read more","iconName":"icon-chevron-right","iconUrl":"#icon-chevron-right","className":"be:my-4 icon-sm inline-flex items-center"} /-->
```

---

## Icons

### Icon blocks (standalone)

Name any layer with the prefix `icon-` and it becomes an empty `sonder/icon` block. The layer name becomes the class name.

| Layer Name | Block Output |
|------------|-------------|
| `icon-arrow-right` | `<!-- wp:sonder/icon {"className":"icon-arrow-right"} /-->` |
| `icon-close` | `<!-- wp:sonder/icon {"className":"icon-close"} /-->` |

### SVG layers

Name a layer with the prefix `svg` to produce a `sonder/svg` block.

---

## Components That Are Auto-Handled

These library components are recognised automatically — no special naming needed.

| Component Name | What happens |
|----------------|-------------|
| `Button` | Mapped to a button block (see above) |
| `Youtube player` | Mapped to a YouTube embed block |
| `Tag` | Mapped to a paragraph with the class `tag` |
| `icon-*` (component) | Mapped to an icon block |
| `svg*` (component) | Mapped to an SVG block |

### Components that are skipped entirely

These are handled programmatically by WordPress and are intentionally excluded from the export:

- Main Navigation
- Logo
- Logo No Tagline
- Search
- Hamburger Menu

---

## Adding CSS Classes to Any Block

You can attach Tailwind (or custom) classes to any block by adding `//` followed by the classes to the layer name.

```
column // w-full md:w-1/2 bg-gray-100
```

This works on any layer type — sections, containers, columns, images, etc.

Classes from the `//` syntax are always merged with any auto-generated classes (flex, gap, padding, etc.).

---

## Common Combinations & What They Produce

### Full-width hero section with background image

```
section // h-screen
  ├── background        ← frame with image fill, absolute positioning
  └── container
        └── columns
              └── column
                    ├── Heading       ← TEXT with type/hero-lg style
                    ├── Lead          ← TEXT with type/lead style
                    └── button-group
                          └── Button  ← Button component
```

### Two-column content section

```
section
  └── container
        └── columns
              ├── column // w-full md:w-1/2
              │     ├── Heading
              │     └── Lead
              └── column // w-full md:w-1/2
                    └── Feature image || png
```

### Footer

```
footer
  └── container
        └── columns
              ├── column
              │     └── Logo
              └── column
                    └── ...nav items...
```

---

## Things to Avoid

| What | Why |
|------|-----|
| Absolutely positioning layers that aren't named `bg` or `background` | The plugin ignores other absolute layers — they won't appear in the export |
| Multiline text in a single TEXT layer | Line breaks become `<br>` tags, which is correct, but avoid unintentional newlines at the start/end of a text node |
| Nesting columns inside columns without a `columns` wrapper | The plugin expects `columns → column` — skipping the wrapper will produce incorrect output |
| Leaving the alt text blank on a forced image (e.g. naming the layer just `\|\| png`) | WordPress uses the text before `\|\|` to name the imported file — always include a description |
| Using components not in the registry without a name identifier | Unknown components produce a visible warning block in WordPress |
