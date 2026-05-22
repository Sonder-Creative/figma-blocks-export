// ================================================================
// SONDER BLOCKS EXPORT — code.js
// Converts Figma selections to WordPress block markup.
// No build step required — plain JavaScript.
// ================================================================


// ================================================================
// SECTION 1: CONFIGURATION
// Edit these values as your design system evolves.
// ================================================================


/**
 * Explicit layer name → WordPress block type.
 * Key: layer name (before // or ||), case-insensitive.
 */
const BLOCK_IDENTIFIERS = {
  'section':    'sonder/section',
  'footer':     'sonder/section',
  'container':  'sonder/container',
  'div':        'sonder/div',
  'columns':    'sonder/columns',
  'column':     'sonder/column',
  'grid':       'sonder/grid',
  'grid-item':  'sonder/grid-item',
  'button-new': 'sonder/button-new',
  'icon':       'sonder/svg',
  'bg-image':   'sonder/bg-image',
  'youtube':    'sonder/youtube',
  'vimeo':      'sonder/vimeo',
  'list':       'sonder/list',
  'list-item':  'sonder/list-item',
  'heading':    'core/heading',
  'h1':         'core/heading',
  'h2':         'core/heading',
  'h3':         'core/heading',
  'h4':         'core/heading',
  'h5':         'core/heading',
  'h6':         'core/heading',
  'paragraph':  'core/paragraph',
  'spacer':     'core/spacer',
  'divider':    'core/separator',
};

/**
 * Figma component name → WordPress block.
 * match: exact string, or wildcard prefix ending in '*'
 * extraClass: optional extra class to add to className
 */
const COMPONENT_REGISTRY = [
  { match: 'Button',         block: 'sonder/button-new' },
  { match: 'Youtube player', block: 'sonder/youtube' },
  { match: 'icon-*',         block: 'sonder/icon' },
  { match: 'svg*',           block: 'sonder/svg'  },
  { match: 'Tag',            block: 'core/paragraph', extraClass: 'tag' },
];

/** Component names to skip entirely — handled programmatically in WP. */
const SKIP_COMPONENTS = [
  'Main Navigation', 'Logo No Tagline', 'Logo', 'Search', 'Hamburger Menu',
];

/**
 * Heading style weight order, heaviest to lightest.
 * Used to dynamically assign h2–h6 levels per section.
 */
const HEADING_WEIGHT_ORDER = [
  'hero-lg', 'hero', 'hero-sm', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
];

/** Text style names (without prefix) that map to core/paragraph. */
const PARAGRAPH_STYLE_NAMES = [
  'lead', 'intro', 'body-lg', 'body', 'body-sm', 'body-xs',
];

/** Text style names (without prefix) that map to core/heading. */
const HEADING_STYLE_NAMES = [
  'hero-lg', 'hero', 'hero-sm', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
];

/**
 * Tailwind spacing scale: pixel value → Tailwind class suffix.
 * e.g. 16 → '4' (used as inset-4, gap-4, top-4, etc.)
 */
const TAILWIND_SPACING = {
  0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
  12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
  36: '9', 40: '10', 44: '11', 48: '12', 56: '14', 64: '16', 80: '20',
  96: '24', 112: '28', 128: '32', 144: '36', 160: '40', 176: '44',
  192: '48', 208: '52', 224: '56', 240: '60', 256: '64', 288: '72',
  320: '80', 384: '96',
};

/** Pixel tolerance when snapping to Tailwind spacing values. */
const SNAP_TOLERANCE = 3;

/**
 * Column width fractions → responsive Tailwind class.
 * Ordered from largest to smallest ratio.
 */
const COLUMN_FRACTIONS = [
  { ratio: 1,     cls: 'w-full' },
  { ratio: 3/4,   cls: 'w-full md:w-3/4' },
  { ratio: 2/3,   cls: 'w-full md:w-2/3' },
  { ratio: 3/5,   cls: 'w-full md:w-3/5' },
  { ratio: 1/2,   cls: 'w-full md:w-1/2' },
  { ratio: 2/5,   cls: 'w-full md:w-2/5' },
  { ratio: 1/3,   cls: 'w-full md:w-1/2 lg:w-1/3' },
  { ratio: 1/4,   cls: 'w-full md:w-1/2 lg:w-1/4' },
  { ratio: 1/5,   cls: 'w-full md:w-1/5' },
];

/** Tolerance (as a ratio) for column fraction matching. */
const FRACTION_TOLERANCE = 0.05;

/**
 * Blocks that are self-closing (no inner HTML or children).
 * Format: <!-- wp:block /-->
 */
const SELF_CLOSING_BLOCKS = new Set([
  'sonder/button-new', 'sonder/youtube', 'sonder/vimeo', 'sonder/icon',
]);

/**
 * Blocks that have inner HTML content but no child blocks.
 * Format: <!-- wp:block --> [html] <!-- /wp:block -->
 */
const LEAF_BLOCKS = new Set([
  'core/heading', 'core/paragraph', 'sonder/svg',
  'core/spacer', 'core/separator', 'core/image',
]);

/** Max output size in bytes before base64 images are stripped. */
const SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

/** Pending image resize callbacks keyed by request ID. */
const pendingImageResizes = {};


// ================================================================
// SECTION 2: ASYNC UTILITIES
// ================================================================

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve
 * within `ms` milliseconds, it resolves to `fallback` instead.
 * Prevents async Figma API calls from hanging indefinitely.
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(function(resolve) {
      setTimeout(function() { resolve(fallback); }, ms);
    })
  ]);
}


// ================================================================
// SECTION 3: NAMING UTILITIES
// ================================================================

/**
 * Parses a Figma layer name into identifier, CSS classes, and type override.
 *
 * Syntax:  "identifier // css-classes || element-override"
 *
 * Examples:
 *   "section // bg-pc-700"         → { id: 'section',  classes: 'bg-pc-700', override: null }
 *   "Hero title || h1"             → { id: 'Hero title', classes: '',        override: 'h1' }
 *   "column // w-full md:w-1/2"    → { id: 'column',   classes: 'w-full md:w-1/2', override: null }
 *   "photo // opacity-20 || png"   → { id: 'photo',    classes: 'opacity-20', override: 'png' }
 */
function parseLayerName(name) {
  let raw = (name || '').trim();
  let classes = '';
  let override = null;

  // Extract || override first
  if (raw.includes('||')) {
    const idx = raw.indexOf('||');
    override = raw.slice(idx + 2).trim();
    raw = raw.slice(0, idx).trim();
  }

  // Extract // classes
  if (raw.includes('//')) {
    const idx = raw.indexOf('//');
    classes = raw.slice(idx + 2).trim();
    raw = raw.slice(0, idx).trim();
  }

  return { id: raw, classes, override };
}

/**
 * Checks if a component name matches a registry pattern.
 * Supports exact match or wildcard prefix ('icon-*').
 */
function matchesPattern(pattern, name) {
  if (!name) return false;
  if (pattern.endsWith('*')) {
    return name.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase());
  }
  return name.toLowerCase() === pattern.toLowerCase();
}


// ================================================================
// SECTION 3: COLOR UTILITIES
// ================================================================

/**
 * Returns a Tailwind opacity class for a node's opacity, or '' if fully opaque.
 * Figma opacity (0–1) is converted to a percentage and rounded to the nearest 10.
 * e.g. 0.21 → 'opacity-20', 0.35 → 'opacity-40', 1.0 → ''
 */
function getOpacityClass(node) {
  if (!('opacity' in node) || node.opacity >= 1) return '';
  const pct = node.opacity * 100;
  const rounded = Math.round(pct / 10) * 10;
  if (rounded >= 100) return '';
  return 'opacity-' + rounded;
}

/**
 * Returns an opacity class for an image node, checking both the layer opacity
 * and the opacity of the image fill itself (whichever is lower).
 */
function getImageOpacityClass(node) {
  // Layer-level opacity
  const layerOpacity = ('opacity' in node && node.opacity < 1) ? node.opacity : 1;

  // Fill-level opacity (Figma image fills can have their own opacity)
  let fillOpacity = 1;
  if ('fills' in node && node.fills && node.fills !== figma.mixed) {
    const imgFill = node.fills.find(f => f.type === 'IMAGE' && f.visible !== false);
    if (imgFill && typeof imgFill.opacity === 'number') {
      fillOpacity = imgFill.opacity;
    }
  }

  const effective = Math.min(layerOpacity, fillOpacity);
  if (effective >= 1) return '';
  const rounded = Math.round(effective * 100 / 10) * 10;
  if (rounded >= 100) return '';
  return 'opacity-' + rounded;
}

/**
 * Returns a Tailwind text-alignment class for a TEXT node, or ''.
 * Only meaningful on core/paragraph and core/heading blocks.
 */
function getTextAlignClass(node) {
  if (node.type !== 'TEXT') return '';
  const align = node.textAlignHorizontal;
  if (align === 'CENTER')    return 'text-center';
  if (align === 'RIGHT')     return 'text-right';
  if (align === 'JUSTIFIED') return 'text-justify';
  return '';
}

/**
 * Maps a node's named effect style to a Tailwind shadow class.
 * Matches against the last segment(s) of the style name, e.g.
 * "shadow/light/500" → 'shadow-light-500'
 * "shadow/500"       → 'shadow-500'
 * Returns '' if no drop shadow effect style is found.
 */
async function getDropShadowClass(node) {
  if (!('effectStyleId' in node) || !node.effectStyleId) return '';
  try {
    const style = await figma.getStyleByIdAsync(node.effectStyleId);
    if (!style || !style.name) return '';
    // Convert style name path to kebab class: "shadow/light/500" → "shadow-light-500"
    const cls = style.name.toLowerCase().replace(/\//g, '-').replace(/\s+/g, '-');
    return cls;
  } catch (e) {
    return '';
  }
}

/**
 * Converts a Figma color style name to a CSS token.
 *   'brand/pc/700' → 'pc-700'
 *   'gray/300'     → 'gray-300'
 *   'text/500'     → 'text-500'
 */
function colorStyleToToken(styleName) {
  let n = (styleName || '').trim();
  if (n.startsWith('brand/')) n = n.slice(6);
  return n.replace(/\//g, '-');
}

/**
 * Returns the background color class for a node's fill, or null.
 * e.g. 'bg-pc-700'
 * Not for TEXT nodes — their fillStyleId is text color, not background.
 */
async function getFillColorClass(node) {
  if (node.type === 'TEXT') return null;
  if (!node.fillStyleId) return null;
  try {
    const styleId = typeof node.fillStyleId === 'string'
      ? node.fillStyleId
      : (node.fillStyleId[0] || '');
    if (!styleId) return null;
    const style = await figma.getStyleByIdAsync(styleId);
    if (style) return 'bg-' + colorStyleToToken(style.name);
  } catch (e) {}
  return null;
}

/**
 * Returns the text color class for a TEXT node's fill style, or null.
 * e.g. 'text-pc-700', 'text-white'
 */
async function getTextColorClass(node) {
  if (node.type !== 'TEXT') return null;
  if (!node.fillStyleId || node.fillStyleId === figma.mixed) return null;
  try {
    const styleId = typeof node.fillStyleId === 'string'
      ? node.fillStyleId
      : (node.fillStyleId[0] || '');
    if (!styleId) return null;
    const style = await figma.getStyleByIdAsync(styleId);
    if (style) return 'text-' + colorStyleToToken(style.name);
  } catch (e) {}
  return null;
}

/**
 * Returns the border color token from a LINE node's stroke, or null.
 * e.g. 'gray-300' (used as backgroundColor on separators)
 */
async function getLineStrokeColorToken(node) {
  // Look for a LINE child first (divider container pattern)
  const lineChild = ('children' in node)
    ? node.children.find(c => c.type === 'LINE')
    : null;
  const target = lineChild || node;

  if (!target.strokeStyleId) return null;
  try {
    const style = await figma.getStyleByIdAsync(target.strokeStyleId);
    if (style) return colorStyleToToken(style.name);
  } catch (e) {}
  return null;
}


// ================================================================
// SECTION 4: TAILWIND SNAPPING
// ================================================================

/**
 * Snaps a pixel value to the nearest Tailwind spacing value.
 * Returns { cls: '4', negative: true } or null if outside tolerance.
 */
function snapToSpacing(px) {
  const abs = Math.abs(Math.round(px));
  const spacings = Object.keys(TAILWIND_SPACING).map(Number);
  let closest = 0;
  let minDiff = Infinity;

  for (const s of spacings) {
    const diff = Math.abs(abs - s);
    if (diff < minDiff) { minDiff = diff; closest = s; }
  }

  if (minDiff > SNAP_TOLERANCE) return null;
  return { cls: TAILWIND_SPACING[closest], negative: px < 0 };
}

/**
 * Converts a raw gap value (px) to a Tailwind gap class.
 * Returns 'gap-4' or null.
 */
function gapToTailwindClass(px) {
  const snapped = snapToSpacing(px);
  return snapped ? `gap-${snapped.cls}` : null;
}


// ================================================================
// SECTION 5: ABSOLUTE POSITIONING
// ================================================================

/**
 * Computes positioning classes for an absolutely positioned node,
 * relative to its parent's dimensions.
 *
 * Returns { classes: string[], inlineStyle: string }
 *
 * All four sides are calculated:
 *   top    = node.y
 *   left   = node.x
 *   bottom = parent.height - (node.y + node.height)
 *   right  = parent.width  - (node.x + node.width)
 *
 * Values are snapped to nearest Tailwind spacing.
 * Negative values (bleed outside parent) get a '-' prefix.
 * Values outside snap tolerance use inline style instead.
 */
/**
 * Snaps px to the nearest Tailwind spacing value, ignoring tolerance.
 * Always returns a result. Negative px → negative: true.
 */
function forceSnapToSpacing(px) {
  const abs = Math.abs(Math.round(px));
  const spacings = Object.keys(TAILWIND_SPACING).map(Number);
  let closest = 0;
  let minDiff = Infinity;
  for (const s of spacings) {
    const diff = Math.abs(abs - s);
    if (diff < minDiff) { minDiff = diff; closest = s; }
  }
  return { cls: TAILWIND_SPACING[closest], negative: px < 0 };
}

function getAbsolutePositionClasses(node, parent) {
  // If the node roughly matches the parent's size, it's a full-cover background.
  // Skip position math (which can produce garbage if x/y are out of bounds in Figma)
  // and just return absolute inset-0.
  const widthRatio  = node.width  / parent.width;
  const heightRatio = node.height / parent.height;
  if (widthRatio >= 0.9 && heightRatio >= 0.9) {
    return { classes: ['absolute', 'inset-0'], inlineStyle: '' };
  }

  const top    = Math.round(node.y);
  const left   = Math.round(node.x);
  const bottom = Math.round(parent.height - (node.y + node.height));
  const right  = Math.round(parent.width  - (node.x + node.width));

  const sides = { top, right, bottom, left };

  // Snap every side to nearest Tailwind value — always, no tolerance cutoff.
  // Negative values use the '-' prefix: e.g. -top-6, -inset-4.
  const snapped = {};
  for (const [side, px] of Object.entries(sides)) {
    snapped[side] = forceSnapToSpacing(px);
  }

  const classes = ['absolute'];

  // All four equal → inset-{n} or -inset-{n}
  const vals = Object.values(snapped);
  const allSame = vals.every(v => v.cls === vals[0].cls && v.negative === vals[0].negative);
  if (allSame) {
    const prefix = vals[0].negative ? '-' : '';
    classes.push(`${prefix}inset-${vals[0].cls}`);
    return { classes, inlineStyle: '' };
  }

  // Individual sides for everything else
  for (const [side, val] of Object.entries(snapped)) {
    classes.push(`${val.negative ? '-' : ''}${side}-${val.cls}`);
  }

  return { classes, inlineStyle: '' };
}


// ================================================================
// SECTION 6: AUTO-LAYOUT UTILITIES
// ================================================================

/**
 * Returns flex classes for an auto-layout node.
 * Returns [] if the node has no auto-layout.
 *
 * HORIZONTAL         → ['flex']
 * HORIZONTAL + wrap  → ['flex', 'flex-wrap']
 * VERTICAL           → ['flex', 'flex-col']
 *
 * Vertical containers whose children are naturally block-level in HTML
 * don't need flex at all — unless cross-axis alignment (center/end) is set.
 */

/**
 * Returns true when a vertical auto-layout is just natural block flow in HTML.
 * In this case, flex and gap should be skipped entirely.
 */
function isNaturalBlockFlow(node) {
  if (!('layoutMode' in node) || node.layoutMode !== 'VERTICAL') return false;
  if (node.layoutWrap === 'WRAP') return false;
  const counterAlign = node.counterAxisAlignItems;
  // items-center or items-end require flex to work
  return counterAlign !== 'CENTER' && counterAlign !== 'MAX';
}

function getFlexClasses(node) {
  if (!('layoutMode' in node) || !node.layoutMode || node.layoutMode === 'NONE') return [];

  const isVertical = node.layoutMode === 'VERTICAL';
  const wrap = node.layoutWrap === 'WRAP';

  const classes = ['flex'];
  if (isVertical) classes.push('flex-col');
  if (wrap) classes.push('flex-wrap');

  // Primary axis (main axis) → justify-*
  const PRIMARY_ALIGN = {
    'MIN':           'justify-start',
    'CENTER':        'justify-center',
    'MAX':           'justify-end',
    'SPACE_BETWEEN': 'justify-between',
  };
  // Counter axis (cross axis) → items-*
  const COUNTER_ALIGN = {
    'MIN':    'items-start',
    'CENTER': 'items-center',
    'MAX':    'items-end',
  };

  const justify = PRIMARY_ALIGN[node.primaryAxisAlignItems];
  const items   = COUNTER_ALIGN[node.counterAxisAlignItems];
  if (justify) classes.push(justify);
  if (items)   classes.push(items);

  return classes;
}

/**
 * Returns a gap class for an auto-layout node.
 * If the gap is bound to a Figma variable → use variable name as class (e.g. 'col-gap-lg').
 * Otherwise → snap to Tailwind (e.g. 'gap-6').
 * Returns '' if no gap is set.
 */
/**
 * Finds the active mode ID for a variable's collection by walking up the node tree.
 */
async function getActiveModeIdForNode(variable, node) {
  try {
    const collection = await withTimeout(
      figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId), 2000, null
    );
    if (collection) {
      let n = node;
      while (n) {
        if (n.explicitVariableModes && n.explicitVariableModes[variable.variableCollectionId]) {
          return n.explicitVariableModes[variable.variableCollectionId];
        }
        n = n.parent;
      }
      return collection.defaultModeId;
    }
  } catch (e) {}
  return Object.keys(variable.valuesByMode)[0];
}

/**
 * Resolves a bound variable on a node property, following alias chains,
 * and returns the final token (e.g. 'sp-lg', 'col-gap-lg').
 * Returns null if unresolvable.
 */
async function resolveVariableToken(node, propertyName) {
  if (!node.boundVariables || !node.boundVariables[propertyName]) return null;
  const alias = node.boundVariables[propertyName];
  const varId = alias.id || (Array.isArray(alias) && alias[0] ? alias[0].id : null);
  if (!varId) return null;
  try {
    let resolved = await withTimeout(figma.variables.getVariableByIdAsync(varId), 2000, null);
    if (!resolved) return null;
    for (let depth = 0; depth < 5; depth++) {
      const modeId = await getActiveModeIdForNode(resolved, node);
      const val = resolved.valuesByMode[modeId];
      if (val && val.type === 'VARIABLE_ALIAS' && val.id) {
        const next = await withTimeout(figma.variables.getVariableByIdAsync(val.id), 2000, null);
        if (next) { resolved = next; continue; }
      }
      break;
    }
    const parts = resolved.name.split('/');
    const token = parts[parts.length - 1].replace(/^--/, '');
    return (token && /^[a-z0-9:_-]+$/i.test(token)) ? token : null;
  } catch (e) {}
  return null;
}

/**
 * Builds a spacing class from a token and a CSS property prefix.
 * sp-* tokens get prefixed (e.g. pt-sp-lg).
 * Other tokens are used as-is (e.g. col-gap-lg already encodes its type).
 */
function spacingClass(prefix, token) {
  if (!token) return '';
  if (token.startsWith('sp-')) return prefix + token;
  return token; // already a complete class
}

async function getGapClass(node) {
  if (!('itemSpacing' in node)) return '';

  const isWrap = node.layoutWrap === 'WRAP';
  const isSpaceBetween = node.primaryAxisAlignItems === 'SPACE_BETWEEN';

  // Primary axis gap — skip if SPACE_BETWEEN (justify-between handles spacing)
  const primaryGap = isSpaceBetween ? 0 : (node.itemSpacing || 0);

  // Counter axis gap — only relevant when wrapping
  const counterGap = isWrap ? (node.counterAxisSpacing || 0) : 0;

  if (primaryGap === 0 && counterGap === 0) return '';

  // Same gap on both axes → gap-*
  if (primaryGap === counterGap) {
    const token = await resolveVariableToken(node, 'itemSpacing');
    if (token) return spacingClass('gap-', token);
    return gapToTailwindClass(primaryGap) || '';
  }

  // Only one axis has a gap — use undirected gap-* (simpler, direction is implied by flex layout)
  if (primaryGap > 0 && counterGap === 0) {
    const token = await resolveVariableToken(node, 'itemSpacing');
    if (token) return spacingClass('gap-', token);
    return gapToTailwindClass(primaryGap) || '';
  }

  if (counterGap > 0 && primaryGap === 0) {
    const token = await resolveVariableToken(node, 'counterAxisSpacing');
    if (token) return spacingClass('gap-y-', token);
    const snapped = gapToTailwindClass(counterGap);
    return snapped ? 'gap-y-' + snapped.replace('gap-', '') : '';
  }

  // Both axes have different non-zero gaps — use gap-x- and gap-y-
  const classes = [];
  const primaryToken = await resolveVariableToken(node, 'itemSpacing');
  const primaryCls = primaryToken ? spacingClass('gap-x-', primaryToken) : (gapToTailwindClass(primaryGap) ? 'gap-x-' + gapToTailwindClass(primaryGap).replace('gap-', '') : '');
  if (primaryCls) classes.push(primaryCls);

  const counterToken = await resolveVariableToken(node, 'counterAxisSpacing');
  const counterCls = counterToken ? spacingClass('gap-y-', counterToken) : (gapToTailwindClass(counterGap) ? 'gap-y-' + gapToTailwindClass(counterGap).replace('gap-', '') : '');
  if (counterCls) classes.push(counterCls);

  return classes.join(' ');
}

/**
 * Derives padding classes from bound spacing variables on a node.
 * Combines to p-, py-, px- shorthand where all sides share the same token.
 * Falls back to Tailwind pixel snap for unbound sides.
 */
/**
 * Derives margin classes from bound spacing variables on a node.
 * Combines to m-, my-, mx- shorthand where sides share the same token.
 */
async function getMarginClasses(node) {
  if (!('marginTop' in node)) return '';

  const tokens = {
    marginTop:    await resolveVariableToken(node, 'marginTop'),
    marginBottom: await resolveVariableToken(node, 'marginBottom'),
    marginLeft:   await resolveVariableToken(node, 'marginLeft'),
    marginRight:  await resolveVariableToken(node, 'marginRight'),
  };

  const t = tokens.marginTop, b = tokens.marginBottom,
        l = tokens.marginLeft,  r = tokens.marginRight;

  if (t && t === b && t === l && t === r) return spacingClass('m-', t);

  const classes = [];

  if (t && t === b) {
    classes.push(spacingClass('my-', t));
  } else {
    if (t) classes.push(spacingClass('mt-', t));
    if (b) classes.push(spacingClass('mb-', b));
  }

  if (l && l === r) {
    classes.push(spacingClass('mx-', l));
  } else {
    if (l) classes.push(spacingClass('ml-', l));
    if (r) classes.push(spacingClass('mr-', r));
  }

  return classes.join(' ');
}

async function getPaddingClasses(node) {
  if (!('paddingTop' in node)) return '';

  const SIDES = ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];
  const PREFIXES = { paddingTop: 'pt-', paddingBottom: 'pb-', paddingLeft: 'pl-', paddingRight: 'pr-' };

  const tokens = {};
  for (const side of SIDES) {
    tokens[side] = await resolveVariableToken(node, side);
  }

  const t = tokens.paddingTop, b = tokens.paddingBottom,
        l = tokens.paddingLeft,  r = tokens.paddingRight;

  // All four equal → p-TOKEN
  if (t && t === b && t === l && t === r) return spacingClass('p-', t);

  const classes = [];

  // Vertical pair
  if (t && t === b) {
    classes.push(spacingClass('py-', t));
  } else {
    if (t) classes.push(spacingClass('pt-', t));
    if (b) classes.push(spacingClass('pb-', b));
  }

  // Horizontal pair
  if (l && l === r) {
    classes.push(spacingClass('px-', l));
  } else {
    if (l) classes.push(spacingClass('pl-', l));
    if (r) classes.push(spacingClass('pr-', r));
  }

  return classes.join(' ');
}


/**
 * Returns a rounded-* class based on corner radius bound variables.
 * If all four corners share the same token, returns a single class.
 * Individual corners: rounded-tl-*, rounded-tr-*, rounded-bl-*, rounded-br-*
 */
async function getBorderRadiusClass(node) {
  if (!('cornerRadius' in node) && !('topLeftRadius' in node)) return '';

  // Try uniform cornerRadius first
  const uniformToken = await resolveVariableToken(node, 'cornerRadius');
  if (uniformToken) return uniformToken; // token IS the class (e.g. "rounded-lg")

  // No variable — check for pill/full radius by raw value
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 998) {
    return 'rounded-full';
  }

  // Try individual corners
  const CORNERS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
  const TW_CORNERS = {
    topLeftRadius: 'rounded-tl-',
    topRightRadius: 'rounded-tr-',
    bottomLeftRadius: 'rounded-bl-',
    bottomRightRadius: 'rounded-br-',
  };

  const tokens = {};
  for (const corner of CORNERS) {
    if (corner in node) {
      tokens[corner] = await resolveVariableToken(node, corner);
    }
  }

  const tl = tokens.topLeftRadius, tr = tokens.topRightRadius,
        bl = tokens.bottomLeftRadius, br = tokens.bottomRightRadius;

  // All four equal → use base token as-is
  if (tl && tl === tr && tl === bl && tl === br) return tl;

  const classes = [];
  for (const corner of CORNERS) {
    if (tokens[corner]) classes.push(TW_CORNERS[corner] + tokens[corner]);
  }
  return classes.join(' ');
}


// ================================================================
// SECTION 7: COLUMN WIDTH DETECTION
// ================================================================

/**
 * Returns a responsive width class based on a column's proportion of its parent.
 * e.g. 648 / 1344 ≈ 0.48 → 'w-full md:w-1/2'
 * Returns null if no clean fraction match is found.
 */
function getColumnWidthClass(nodeWidth, parentWidth) {
  if (!parentWidth || parentWidth === 0) return null;
  const ratio = nodeWidth / parentWidth;
  let best = null;
  let minDiff = Infinity;

  for (const f of COLUMN_FRACTIONS) {
    const diff = Math.abs(ratio - f.ratio);
    if (diff < minDiff) { minDiff = diff; best = f; }
  }

  return minDiff <= FRACTION_TOLERANCE ? best.cls : null;
}


// ================================================================
// SECTION 8: TEXT UTILITIES
// ================================================================

/**
 * Gets the style name for a text node, with the prefix stripped.
 * 'type/hero-lg' → 'hero-lg'
 * 'buttons/button' → 'button'
 * Returns null if no text style is applied.
 */
async function getTextStyleName(node) {
  if (!node.textStyleId) return null;
  // figma.mixed means multiple styles in one text node — skip
  if (node.textStyleId === figma.mixed) return null;
  try {
    const style = await withTimeout(figma.getStyleByIdAsync(node.textStyleId), 2000, null);
    if (!style) return null;
    const idx = style.name.lastIndexOf('/');
    return idx >= 0 ? style.name.slice(idx + 1) : style.name;
  } catch (e) {
    return null;
  }
}

/** Returns true if a style name maps to a heading. */
function isHeadingStyle(n) { return HEADING_STYLE_NAMES.includes(n); }

/** Returns true if a style name maps to a paragraph. */
function isParagraphStyle(n) { return PARAGRAPH_STYLE_NAMES.includes(n); }

/**
 * Pre-scans a section node and builds a Map<nodeId, headingLevel>.
 *
 * The heaviest heading style in the section is assigned h2,
 * the next h3, and so on up to h6.
 * The style name is also stored for use as a className.
 */
async function buildHeadingMap(sectionNode) {
  const found = []; // [{ nodeId, styleName }]

  async function scan(node) {
    if (node.type === 'TEXT') {
      const styleName = await getTextStyleName(node);
      if (styleName && isHeadingStyle(styleName)) {
        found.push({ nodeId: node.id, styleName });
      }
      return;
    }
    if ('children' in node) {
      for (const child of node.children) await scan(child);
    }
  }

  await scan(sectionNode);

  // Unique styles sorted by weight
  const uniqueStyles = Array.from(new Set(found.map(function(f) { return f.styleName; })));
  uniqueStyles.sort((a, b) => {
    const ai = HEADING_WEIGHT_ORDER.indexOf(a);
    const bi = HEADING_WEIGHT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Assign levels h2–h6
  const styleToLevel = {};
  uniqueStyles.forEach((style, i) => {
    styleToLevel[style] = Math.min(2 + i, 6);
  });

  const map = new Map();
  for (const { nodeId, styleName } of found) {
    map.set(nodeId, styleToLevel[styleName]);
  }
  return map;
}


// ================================================================
// SECTION 9: IMAGE UTILITIES
// ================================================================

/** Returns true if a node has a visible image fill. */
function hasImageFill(node) {
  if (!('fills' in node) || !node.fills) return false;
  if (node.fills === figma.mixed) return false;
  return node.fills.some(function(f) { return f.type === 'IMAGE' && f.visible !== false; });
}

/**
 * Returns true if the node's image fill uses FILL or CROP scale mode.
 * These modes crop the image and require an aspect-ratio wrapper.
 */
function imageIsCropped(node) {
  if (!('fills' in node) || !node.fills || node.fills === figma.mixed) return false;
  const fill = node.fills.find(function(f) { return f.type === 'IMAGE' && f.visible !== false; });
  return fill && (fill.scaleMode === 'FILL' || fill.scaleMode === 'CROP');
}

/**
 * Matches a width/height ratio to the closest Sonder aspect ratio class.
 * Returns 'aspect-auto' if no standard ratio is close enough (>15% relative diff).
 */
function matchAspectRatio(width, height) {
  if (!width || !height) return 'aspect-auto';
  const ratio = width / height;
  const candidates = [
    { cls: 'aspect-super',             r: 21 / 9  },
    { cls: 'aspect-video',             r: 16 / 9  },
    { cls: 'aspect-postcard',          r: 3  / 2  },
    { cls: 'aspect-box',               r: 4  / 3  },
    { cls: 'aspect-square',            r: 1       },
    { cls: 'aspect-box-portrait',      r: 3  / 4  },
    { cls: 'aspect-postcard-portrait', r: 2  / 3  },
    { cls: 'aspect-video-portrait',    r: 9  / 16 },
  ];
  var best = 'aspect-auto', bestDiff = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var diff = Math.abs(ratio - candidates[i].r) / candidates[i].r;
    if (diff < bestDiff) { bestDiff = diff; best = candidates[i].cls; }
  }
  return bestDiff < 0.15 ? best : 'aspect-auto';
}

/**
 * Exports a Figma node as a base64 image.
 * Format is determined by layer name prefix or transparency.
 *
 * Returns { base64, filename, ext } or null on failure / images disabled.
 */
/**
 * forceExport: when true, skips the image-fill guard.
 * Use this for nodes explicitly classified as sonder/bg-image —
 * they should always be exported regardless of fill type.
 */
async function exportNodeAsImage(node, settings, layerIdentifier, forceExport, forceFormat) {
  if (!settings.exportImages) return { skipped: true };

  const nodeHasImageFill = hasImageFill(node);

  // Skip only when there's no signal at all to export
  if (!forceExport && !nodeHasImageFill) {
    return { skipped: true, reason: 'no image fill' };
  }

  // Auto-detect PNG vs JPG from transparency when no format is forced.
  // PNG: node is semi-transparent, any fill has reduced opacity, or there are no fills (transparent bg).
  // JPG: fully opaque node with fills.
  let isPng;
  if (forceFormat === 'png') {
    isPng = true;
  } else if (forceFormat === 'jpg') {
    isPng = false;
  } else {
    const nodeIsTransparent = node.opacity !== undefined && node.opacity < 1;
    const fills = node.fills;
    const fillsArr = (fills && fills !== figma.mixed && Array.isArray(fills)) ? fills : [];
    const fillHasTransparency = fillsArr.some(function(f) { return f.opacity !== undefined && f.opacity < 1; });
    const noFills = fillsArr.length === 0;
    isPng = nodeIsTransparent || fillHasTransparency || noFills;
  }
  const format = isPng ? 'PNG' : 'JPG';

  const longestEdge = Math.max(node.width || 1, node.height || 1);
  const scale = longestEdge > settings.maxSize ? settings.maxSize / longestEdge : 1;

  const exportSettings = { format };
  if (scale !== 1) exportSettings.constraint = { type: 'SCALE', value: scale };
  if (format === 'JPG') exportSettings.quality = settings.jpgQuality;

  try {
    const bytes = await node.exportAsync(exportSettings);
    if (!bytes || bytes.length === 0) {
      return { failed: true, reason: 'exportAsync returned empty data' };
    }
    // Encode to base64 in chunks to avoid call stack overflow on large images
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const ext = format.toLowerCase();
    const filename = (layerIdentifier || node.name).replace(/[^a-zA-Z0-9._-]/g, '-') + '.' + ext;
    return { base64: base64, filename: filename, ext: ext };
  } catch (e) {
    return { failed: true, reason: e.message };
  }
}

/**
 * Detects image format from magic bytes.
 */
function detectImageExt(bytes) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'webp';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  return 'png';
}

/**
 * Sends raw image bytes to the UI iframe for canvas-based resizing.
 * Returns a promise that resolves with { dataUrl, ext } or { error }.
 */
function resizeImageViaUI(bytes, ext, settings, forceFormat) {
  return new Promise(function(resolve) {
    const id = Math.random().toString(36).slice(2) + Date.now();
    pendingImageResizes[id] = resolve;
    figma.ui.postMessage({
      type: 'resize-image',
      id: id,
      buffer: bytes.buffer,
      ext: ext,
      forceFormat: forceFormat || null,
      maxSize: settings.maxSize,
      quality: settings.jpgQuality,
    });
  });
}

/**
 * Extracts the raw source image from a node's image fill using figma.getImageByHash(),
 * then resizes it via the UI canvas to respect maxSize/quality settings.
 * Falls back to exportNodeAsImage (rendered export) if no image fill is found.
 */
async function getNodeSourceImageBase64(node, settings, layerIdentifier, figmaImageMap, forceFormat) {
  if (!settings.exportImages) return { skipped: true };

  const fills = node.fills;
  const imgFill = fills && fills !== figma.mixed && Array.isArray(fills)
    ? fills.find(function(f) { return f.type === 'IMAGE' && f.imageHash; })
    : null;

  // If we have a Figma image URL map, use the CDN URL directly — no base64 needed.
  if (imgFill && figmaImageMap && figmaImageMap[imgFill.imageHash]) {
    return { url: figmaImageMap[imgFill.imageHash] };
  }

  if (!imgFill) {
    // No image fill — fall back to rendered export (respects forceFormat for auto-detect)
    return exportNodeAsImage(node, settings, layerIdentifier, true, forceFormat);
  }

  try {
    const img = figma.getImageByHash(imgFill.imageHash);
    if (!img) return { failed: true, reason: 'image hash not found' };

    const bytes = await img.getBytesAsync();
    if (!bytes || bytes.length === 0) return { failed: true, reason: 'empty image bytes' };

    const ext = detectImageExt(bytes);
    // forceFormat overrides the source format (e.g. force a PNG fill to export as JPG)
    const resized = await resizeImageViaUI(bytes, ext, settings, forceFormat || null);
    if (resized.error) return { failed: true, reason: resized.error };

    // Extract base64 from the data URL returned by the UI
    const commaIdx = resized.dataUrl.indexOf(',');
    const base64 = resized.dataUrl.slice(commaIdx + 1);
    const outputExt = resized.ext || ext;
    const filename = (layerIdentifier || node.name).replace(/[^a-zA-Z0-9._-]/g, '-') + '.' + outputExt;
    return { base64: base64, ext: outputExt, filename: filename };
  } catch (e) {
    return { failed: true, reason: e.message };
  }
}

/**
 * Exports a node as a raw SVG string.
 * Used for sonder/icon blocks.
 */
async function exportNodeAsSvg(node) {
  try {
    const bytes = await node.exportAsync({ format: 'SVG' });
    let svg = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      svg += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return svg || null;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}


// ================================================================
// SECTION 10: PHASE 1 — CLASSIFICATION
// ================================================================

/**
 * Checks if a node's maxWidth is bound to a container-width variable.
 * This is the primary signal for identifying sonder/container nodes.
 */
async function hasContainerWidthVar(node) {
  if (!node.boundVariables || !node.boundVariables.maxWidth) return false;
  const alias = node.boundVariables.maxWidth;
  const varId = alias.id || (Array.isArray(alias) && alias[0] ? alias[0].id : null);
  if (!varId) return false;
  try {
    const variable = await withTimeout(figma.variables.getVariableByIdAsync(varId), 2000, null);
    return variable ? variable.name.toLowerCase().includes('container') : false;
  } catch (e) {
    return false;
  }
}

/**
 * Classifies a Figma node into a WordPress block type.
 *
 * Priority order:
 *   1. Explicit layer name match
 *   2. jpg/png prefix → image export
 *   3. Figma component instance (registry or skip)
 *   4. Structural inference (text styles, image fills, layout)
 *   5. Fallback → sonder/div
 *
 * Returns a classification object:
 * {
 *   blockType:      string,   WP block type or '__skip__' / '__warning__' / '__image-wrapper__'
 *   classes:        string,   from // syntax
 *   override:       string,   from || syntax
 *   level:          number,   heading level (if applicable)
 *   styleName:      string,   text style name (if applicable)
 *   extraClass:     string,   from component registry
 *   source:         string,   classification path (for debugging)
 * }
 */
async function classifyNode(node, context) {
  const { id, classes, override } = parseLayerName(node.name);
  const idLower = id.toLowerCase();

  const result = {
    blockType: null, classes, override,
    level: null, styleName: null, extraClass: '', source: '',
  };

  // ---- Priority 1: Explicit block identifier ----
  if (BLOCK_IDENTIFIERS.hasOwnProperty(idLower)) {
    result.blockType = BLOCK_IDENTIFIERS[idLower];
    result.source = 'explicit';
    // h1–h6 explicit names carry their level
    const lvl = idLower.match(/^h([1-6])$/);
    if (lvl) result.level = parseInt(lvl[1]);
    // For text nodes that are headings, still fetch the style name so hero-lg etc. get applied
    if (result.blockType === 'core/heading' && node.type === 'TEXT') {
      const sName = await getTextStyleName(node);
      if (sName) result.styleName = sName;
    }
    if (result.blockType === 'core/paragraph' && node.type === 'TEXT') {
      const sName = await getTextStyleName(node);
      if (sName) result.styleName = sName;
    }
    return result;
  }

  // ---- Priority 1.5: Named link/button frames (non-instance only) ----
  // Instance nodes named "button" still fall through to Priority 3 for variant/color handling.
  if (node.type !== 'INSTANCE') {
    if (idLower === 'link') {
      result.blockType = 'sonder/button-new';
      result.source = 'link-frame';
      return result;
    }
    if (idLower === 'button' || idLower === 'button-sm' || idLower === 'button-lg') {
      result.blockType = 'sonder/button-new';
      result.source = 'button-frame';
      return result;
    }
  }

  // ---- Priority 2: Image override (|| png / || jpg) ----
  // The layer name before || becomes the alt text / filename hint.
  // e.g. "Hero sunset photo || png" → bg-image, alt="Hero sunset photo"
  if (override) {
    const ov = override.toLowerCase();
    if (ov === 'png' || ov === 'jpg' || ov === 'jpeg') {
      result.blockType = 'sonder/bg-image';
      result.source = 'override-image';
      return result;
    }
  }

  // ---- Priority 2.5: svg prefix ----
  if (idLower.startsWith('svg')) {
    result.blockType = 'sonder/svg';
    result.source = 'prefix-svg';
    return result;
  }

  // ---- Priority 2.6: icon- prefix → empty self-closing icon block ----
  if (idLower.startsWith('icon-')) {
    result.blockType = 'sonder/icon';
    result.source = 'prefix-icon';
    return result;
  }

  // ---- Priority 3: Component instance ----
  if (node.type === 'INSTANCE') {
    const mainComp = await node.getMainComponentAsync();
    const compName = (mainComp && mainComp.name) ? mainComp.name : '';

    // Skip list
    const isSkipped = SKIP_COMPONENTS.some(s =>
      s.toLowerCase() === compName.toLowerCase() ||
      s.toLowerCase() === idLower
    );
    if (isSkipped) {
      result.blockType = '__skip__';
      result.source = 'skip';
      return result;
    }

    // Registry match — check component name and parsed layer id (id strips // classes and || overrides)
    for (const entry of COMPONENT_REGISTRY) {
      if (matchesPattern(entry.match, compName) || matchesPattern(entry.match, id)) {
        // Special: Tag + layer identifier includes 'button' → button block
        if (entry.block === 'core/paragraph' && idLower.includes('button')) {
          result.blockType = 'sonder/button-new';
          result.source = 'component-tag-as-button';
          return result;
        }
        result.blockType = entry.block;
        result.extraClass = entry.extraClass || '';
        result.source = 'component';
        return result;
      }
    }

    // Unknown component → visible warning in block editor
    result.blockType = '__warning__';
    result.source = 'unknown-component';
    return result;
  }

  // ---- Priority 3b: SVG/VECTOR nodes → svg ----
  if (node.type === 'VECTOR') {
    result.blockType = 'sonder/svg';
    result.source = 'vector';
    return result;
  }

  // ---- Priority 4: Structural inference ----

  // 4a/4b: Text nodes
  if (node.type === 'TEXT') {
    const styleName = await getTextStyleName(node);
    if (styleName && isHeadingStyle(styleName)) {
      const level = (context.headingMap && context.headingMap.get(node.id)) || 2;
      result.blockType = 'core/heading';
      result.level = level;
      result.styleName = styleName;
      result.source = 'text-heading';
    } else {
      result.blockType = 'core/paragraph';
      result.styleName = styleName;
      result.source = 'text-paragraph';
    }
    return result;
  }

  // 4c/4d: Image fill
  if (hasImageFill(node)) {
    const hasKids = 'children' in node && node.children.length > 0;
    // If the image is cropped (FILL/CROP scaleMode), any children are structural
    // layout helpers (e.g. "Aspect ratio keeper" frames) — not real content.
    // Treat the node as a plain image so aspect ratio classes are applied correctly.
    if (hasKids && imageIsCropped(node)) {
      result.blockType = 'sonder/bg-image';
      result.source = 'image-fill-cropped';
    } else {
      result.blockType = hasKids ? '__image-wrapper__' : 'sonder/bg-image';
      result.source = hasKids ? 'image-wrapper' : 'image-fill';
    }
    return result;
  }

  // 4e: Container (bound to --container-width variable)
  if (await hasContainerWidthVar(node)) {
    result.blockType = 'sonder/container';
    result.source = 'container-var';
    return result;
  }

  // 4f: Separator (frame or group containing a single LINE child)
  if (
    'children' in node &&
    node.children.length === 1 &&
    node.children[0].type === 'LINE'
  ) {
    result.blockType = 'core/separator';
    result.source = 'separator-line';
    return result;
  }

  // 4g: Columns (horizontal auto-layout, all frame/group children)
  if (
    'layoutMode' in node && node.layoutMode === 'HORIZONTAL' &&
    'children' in node && node.children.length >= 2 &&
    node.children.every(c => c.type === 'FRAME' || c.type === 'GROUP')
  ) {
    result.blockType = 'sonder/columns';
    result.source = 'inferred-columns';
    return result;
  }

  // 4h: Column (direct child of a columns block)
  if (context.parentBlockType === 'sonder/columns') {
    result.blockType = 'sonder/column';
    result.source = 'inferred-column';
    return result;
  }

  // 4i: Grid item (direct child of a grid block)
  if (context.parentBlockType === 'sonder/grid') {
    result.blockType = 'sonder/grid-item';
    result.source = 'inferred-grid-item';
    return result;
  }

  // Priority 5: Fallback → generic wrapper
  result.blockType = 'sonder/div';
  result.source = 'fallback';
  return result;
}


// ================================================================
// SECTION 11: ATTRIBUTE BUILDING
// ================================================================

/** Merges class strings, filtering empty values, collapsing whitespace. */
function mergeClasses() {
  const parts = Array.from(arguments);
  return parts.filter(Boolean).join(' ').trim().replace(/\s+/g, ' ');
}

/**
 * Builds the WordPress block attributes object for a node.
 * Returns a plain object — internal keys starting with _ are serialized
 * separately and stripped from the block comment JSON.
 */
async function buildBlockAttrs(classification, node, autoClasses, context) {
  const { blockType, classes: explicitClasses, override, level, styleName, extraClass } = classification;
  const { id } = parseLayerName(node.name);
  const className = mergeClasses(autoClasses, extraClass, explicitClasses);

  switch (blockType) {

    // ---- Layout containers ----
    case 'sonder/section':
    case 'sonder/div': {
      const attrs = {};
      if (id.toLowerCase() === 'footer') attrs.tag = 'footer';
      if (className) attrs.className = className;
      // customLabel = layer name if it's descriptive (not the block type itself)
      const isGenericName = ['section', 'div', 'footer'].includes(id.toLowerCase());
      if (!isGenericName && id) attrs.customLabel = id;
      return attrs;
    }

    case 'sonder/container':
    case 'sonder/columns':
    case 'sonder/grid':
    case 'sonder/list':
    case 'sonder/list-item':
    case 'sonder/grid-item': {
      const attrs = {};
      if (className) attrs.className = className;
      return attrs;
    }

    case 'sonder/column': {
      // Use explicit width class if provided, otherwise derive from proportion
      let widthClass = '';
      if (!explicitClasses.includes('w-')) {
        if (node.parent && 'width' in node.parent) {
          const par = node.parent;
          // Inner width = parent width minus horizontal padding
          const padH = (par.paddingLeft || 0) + (par.paddingRight || 0);
          const innerWidth = par.width - padH;
          // Siblings share the gap — distribute total gap across all siblings
          const siblings = ('children' in par) ? par.children.filter(c => c.visible !== false) : [];
          const sibCount = siblings.length;
          const gap = (par.itemSpacing || 0);
          // Each column's effective share of inner width includes its portion of the gaps
          // effectiveWidth = nodeWidth + (gap / sibCount) * (sibCount - 1) / sibCount...
          // Simpler: treat the column as a fraction of (innerWidth + gap) to normalize
          const effectiveParent = innerWidth + gap;
          const effectiveNode = node.width + gap;
          widthClass = getColumnWidthClass(effectiveNode, effectiveParent) || '';
        }
      }
      const finalClass = mergeClasses(widthClass, explicitClasses, extraClass);
      const attrs = {};
      if (finalClass) attrs.className = finalClass;
      return attrs;
    }

    // ---- Text blocks ----
    case 'core/heading': {
      // || override takes precedence over dynamic level
      const finalLevel = override ? parseInt(override.replace('h', '')) : (level || 2);
      const headingClass = mergeClasses(styleName || '', autoClasses, explicitClasses);
      const attrs = {};
      if (finalLevel !== 2) attrs.level = finalLevel; // WP defaults to h2
      if (headingClass) attrs.className = headingClass;
      attrs._text = node.type === 'TEXT' ? node.characters : '';
      return attrs;
    }

    case 'core/paragraph': {
      const paraClass = mergeClasses(styleName || '', extraClass, autoClasses, explicitClasses);
      const attrs = {};
      if (paraClass) attrs.className = paraClass;
      if (node.type === 'TEXT') {
        attrs._text = node.characters;
      } else {
        // Component instances (e.g. Tag) — find first TEXT descendant
        const findText = (n) => {
          if (n.type === 'TEXT') return n.characters;
          if ('children' in n) {
            for (const c of n.children) { const t = findText(c); if (t) return t; }
          }
          return '';
        };
        attrs._text = findText(node);
      }
      return attrs;
    }

    // ---- Interactive blocks ----
    case 'sonder/button-new': {

      // ---- Named link/button frames ----
      if (classification.source === 'link-frame' || classification.source === 'button-frame') {
        // Find first TEXT descendant for content
        const findText = (n) => {
          if (n.type === 'TEXT') return n.characters;
          if ('children' in n) {
            for (const c of n.children) { const t = findText(c); if (t) return t; }
          }
          return null;
        };
        const content = findText(node) || '';

        // Find first descendant whose name starts with 'icon-'
        const findIcon = (n) => {
          if (!('children' in n)) return null;
          for (const c of n.children) {
            if (c.name.toLowerCase().startsWith('icon-')) return c;
            const found = findIcon(c);
            if (found) return found;
          }
          return null;
        };
        const iconNode = findIcon(node);

        // Size class for button frames; link frames get none
        let sizeClass = '';
        if (classification.source === 'button-frame') {
          sizeClass = id === 'button-lg' ? 'button-lg' : id === 'button-sm' ? 'button-sm' : 'button';
        }

        // Explicit layer classes first, then size, then base
        const btnClass = mergeClasses(explicitClasses, sizeClass, 'icon-sm inline-flex items-center');
        const attrs = {};
        if (content) attrs.content = content;
        if (iconNode) {
          attrs.iconName = iconNode.name;
          attrs.iconUrl  = '#' + iconNode.name;
        }
        if (btnClass) attrs.className = btnClass;
        return attrs;
      }

      // ---- Component instance (existing behaviour) ----
      // Button text: prefer child TEXT node, fall back to layer identifier
      let content = id;
      if ('children' in node) {
        const findText = (n) => {
          if (n.type === 'TEXT') return n.characters;
          if ('children' in n) {
            for (const c of n.children) { const t = findText(c); if (t) return t; }
          }
          return null;
        };
        content = findText(node) || id;
      }

      // Map Figma variant values → CSS classes
      // Every button must have button, button-sm, or button-lg as a base size class.
      const BUTTON_VARIANT_MAP = {
        'regular':         'button',
        'small':           'button-sm',
        'large':           'button-lg',
        'outline small':   'button-sm outlined',
        'outline regular': 'button outlined',
        'outline large':   'button-lg outlined',
        'tag':             'tag',
        'outline tag':     'outlined tag',
      };
      const variantClasses = [];
      if (node.componentProperties) {
        for (const prop of Object.values(node.componentProperties)) {
          if (prop.type === 'VARIANT') {
            const val = String(prop.value).toLowerCase().trim();
            const mapped = BUTTON_VARIANT_MAP[val];
            if (mapped) variantClasses.push(mapped);
          }
        }
      }
      // Ensure a base size class is always present
      const hasSizeClass = variantClasses.some(c => /\bbutton(-sm|-lg)?\b/.test(c));
      if (!hasSizeClass) variantClasses.unshift('button');

      // Derive primary/secondary/tertiary/quaternary from fill color token
      const fillCls = await getFillColorClass(node) || '';
      const COLOR_MAP = { 'bg-pc': '', 'bg-sc': 'secondary', 'bg-tc': 'tertiary', 'bg-qc': 'quaternary' };
      let colorClass = '';
      for (const [prefix, cls] of Object.entries(COLOR_MAP)) {
        if (fillCls.startsWith(prefix + '-')) { colorClass = cls; break; }
      }

      // Base classes always present; explicit layer classes can add overrides
      const btnClass = mergeClasses('icon-sm inline-flex items-center', colorClass, variantClasses.join(' '), explicitClasses);
      const attrs = { content };
      if (btnClass) attrs.className = btnClass;
      return attrs;
    }

    // ---- Media blocks ----
    case 'sonder/bg-image': {
      const attrs = { mediaId: 0 };
      if (className) attrs.className = className;
      // id = the descriptive name before || (e.g. "Hero sunset photo")
      // Used as alt text by the WP importer, and as the filename hint for export.
      attrs._imageAlt      = id;
      attrs._imageFilename = id;
      // || png / || jpg forces a specific export format; absent = auto-detect
      const ov = (override || '').toLowerCase();
      if (ov === 'png' || ov === 'jpg' || ov === 'jpeg') {
        attrs._imageFormat = ov === 'jpeg' ? 'jpg' : ov;
      }
      return attrs;
    }

    case 'sonder/icon': {
      // Use the full layer identifier (e.g. 'icon-arrow-right') as the base class,
      // merged with any explicit // classes and auto position classes.
      const iconClass = mergeClasses(id, autoClasses, explicitClasses);
      const attrs = {};
      if (iconClass) attrs.className = iconClass;
      return attrs;
    }

    case 'sonder/youtube':
    case 'sonder/vimeo': {
      // Always exported as empty placeholder blocks
      const attrs = {};
      if (className) attrs.className = className;
      return attrs;
    }

    // ---- Structural blocks ----
    case 'core/spacer': {
      return { height: Math.round(node.height || 100) };
    }

    case 'core/separator': {
      const attrs = {};
      // Derive py class from vertical padding
      if ('paddingTop' in node) {
        const snapT = snapToSpacing(node.paddingTop || 0);
        const snapB = snapToSpacing(node.paddingBottom || 0);
        if (snapT && snapB) {
          const pyClass = snapT.cls === snapB.cls
            ? `py-${snapT.cls}`
            : `pt-${snapT.cls} pb-${snapB.cls}`;
          attrs.className = mergeClasses(pyClass, explicitClasses);
        }
      } else if (className) {
        attrs.className = className;
      }
      // Border color from LINE stroke style
      const colorToken = await getLineStrokeColorToken(node);
      if (colorToken) attrs.backgroundColor = colorToken;
      return attrs;
    }

    case 'sonder/svg': {
      // autoClasses contains position classes only (flex/gap/fill are skipped upstream)
      const attrs = {};
      const cls = mergeClasses(autoClasses, explicitClasses);
      if (cls) attrs.className = cls;
      return attrs;
    }

    default: {
      const attrs = {};
      if (className) attrs.className = className;
      return attrs;
    }
  }
}


// ================================================================
// SECTION 12: PHASE 2 — TREE BUILDING
// ================================================================

/**
 * Recursively builds a BlockNode tree from a Figma node.
 * Returns a BlockNode, or null if the node should be skipped.
 *
 * Context shape:
 * {
 *   settings:        { exportImages, maxSize, jpgQuality }
 *   headingMap:      Map<nodeId, level>  — built per section
 *   parent:          SceneNode | null
 *   parentBlockType: string | null
 * }
 *
 * BlockNode shape:
 * {
 *   blockType:  string
 *   attrs:      object
 *   selfClosing: boolean
 *   isLeaf:     boolean    (has inner HTML, no child blocks)
 *   children:   BlockNode[]
 *   warningName: string    (only on __warning__ nodes)
 * }
 */
async function buildBlockTree(node, context) {
  const cl = await classifyNode(node, context);

  if (cl.blockType === '__skip__') return null;

  if (cl.blockType === '__warning__') {
    return { blockType: '__warning__', warningName: node.name, selfClosing: false, isLeaf: false, attrs: {}, children: [] };
  }

  // ---- Absolute positioning ----
  // Only bg/background named nodes get position classes — everything else is normal flow.
  // Siblings of a bg/background absolute node get 'relative' to establish stacking context.
  const isAbsolute = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';
  const isBgName   = /\b(bg|background)\b/.test(node.name.toLowerCase());
  const relativeClass = (!isAbsolute && context.hasBgAbsoluteSibling) ? 'relative' : '';

  let positionClasses = '';
  if (isAbsolute && isBgName) {
    if (context.parent) {
      const pos = getAbsolutePositionClasses(node, context.parent);
      positionClasses = pos.classes.join(' ');
    } else {
      positionClasses = 'absolute inset-0';
    }
  }

  // ---- Auto-layout classes ----
  // Buttons: skip everything (WP handles all styling)
  // SVGs: keep position classes, skip flex/gap/fill
  const isButton = cl.blockType === 'sonder/button-new';
  const isSvg    = cl.blockType === 'sonder/svg';
  const skipFlex = isButton || isSvg || isNaturalBlockFlow(node);
  const flexCls    = skipFlex ? '' : getFlexClasses(node).join(' ');
  const gapCls     = skipFlex ? '' : await getGapClass(node);
  const fillCls     = (isButton || isSvg) ? '' : await getFillColorClass(node) || '';
  const textColorCls = (isButton || isSvg) ? '' : await getTextColorClass(node) || '';
  const paddingCls  = (isButton || isSvg) ? '' : await getPaddingClasses(node);
  const marginCls   = (isButton || isSvg) ? '' : await getMarginClasses(node);
  const radiusCls   = (isButton || isSvg) ? '' : await getBorderRadiusClass(node);
  const opacityCls   = getOpacityClass(node);
  const shadowCls    = (isButton || isSvg) ? '' : await getDropShadowClass(node);
  const isTextBlock  = cl.blockType === 'core/paragraph' || cl.blockType === 'core/heading';
  const textAlignCls = isTextBlock ? getTextAlignClass(node) : '';
  // Component-registry paragraphs (e.g. Tag) are simple inline elements —
  // skip layout classes entirely, only carry position + relative.
  const isComponentParagraph = cl.blockType === 'core/paragraph' && cl.source === 'component';
  const autoClasses = isButton ? ''
    : isComponentParagraph ? ''
    : mergeClasses(positionClasses, relativeClass, flexCls, gapCls, fillCls, textColorCls, paddingCls, marginCls, radiusCls, opacityCls, shadowCls, textAlignCls);

  // ---- Build attributes ----
  const attrs = await buildBlockAttrs(cl, node, autoClasses, context);

  const blockType   = cl.blockType;
  const selfClosing = SELF_CLOSING_BLOCKS.has(blockType);
  const isLeaf      = LEAF_BLOCKS.has(blockType);

  // ---- Image / SVG export ----
  if (blockType === 'sonder/bg-image') {
    const imgId       = attrs._imageFilename || node.name;
    const imageAlt    = attrs._imageAlt      || '';
    const forceFormat = attrs._imageFormat   || null;
    delete attrs._imageFilename;
    delete attrs._imageAlt;
    delete attrs._imageFormat;
    const imageData = await getNodeSourceImageBase64(node, context.settings, imgId, context.figmaImageMap, forceFormat);
    let imageSrc = '';
    if (imageData && imageData.url) {
      imageSrc = imageData.url;
    } else if (imageData && imageData.base64) {
      imageSrc = 'data:image/' + imageData.ext + ';base64,' + imageData.base64;
    } else if (imageData && imageData.failed) {
      context.warnings.push('Image export failed for "' + node.name + '": ' + imageData.reason);
    }

    // Background fill image: absolutely positioned layer named 'bg' or 'background'.
    // Wrap in an inset-0 div; image gets object-cover, no aspect ratio.
    const nameLower = node.name.toLowerCase();
    const isBgLayer = isAbsolute && /\b(bg|background)\b/.test(nameLower);
    if (isBgLayer) {
      const bgOpacityCls = getImageOpacityClass(node);
      const imageBlock = {
        blockType: 'core/image',
        attrs: { id: 0 },
        selfClosing: false,
        isLeaf: true,
        children: [],
        _imageSrc: imageSrc,
        _imageAlt: imageAlt,
        _figureClass: mergeClasses('object-cover w-full h-full', bgOpacityCls),
      };
      return {
        blockType: 'sonder/div',
        attrs: { className: positionClasses || 'absolute inset-0' },
        selfClosing: false,
        isLeaf: false,
        children: [imageBlock],
      };
    }

    const isCropped = imageIsCropped(node);
    const aspectCls = isCropped ? matchAspectRatio(node.width, node.height) : '';
    const radiusCls = await getBorderRadiusClass(node);
    const imgOpacityCls = getImageOpacityClass(node);
    const figureCls = mergeClasses(
      isCropped ? mergeClasses(aspectCls, 'object-cover') : '',
      radiusCls,
      imgOpacityCls
    ) || undefined;
    return {
      blockType: 'core/image',
      attrs: { id: 0 },
      selfClosing: false,
      isLeaf: true,
      children: [],
      _imageSrc: imageSrc,
      _imageAlt: imageAlt,
      _figureClass: figureCls,
    };
  }

  if (blockType === 'sonder/icon') {
    const result = await exportNodeAsSvg(node);
    if (result && !result.error) attrs._svgContent = result;
  }

  if (blockType === 'sonder/svg') {
    const result = await exportNodeAsSvg(node);
    if (result && !result.error) {
      attrs.svgCode = result;
      attrs._svgContent = result;
    } else {
      const reason = (result && result.error) ? result.error : 'empty result';
      context.warnings.push('SVG export failed for "' + node.name + '": ' + reason);
    }
    if (!attrs.className) attrs.className = '';
  }

  if (selfClosing || isLeaf) {
    return { blockType, attrs, selfClosing, isLeaf: !selfClosing, children: [] };
  }

  // ---- Image-wrapper: split fill + children into separate blocks ----
  if (blockType === '__image-wrapper__') {
    const wrapId = parseLayerName(node.name).id;
    const wrapImageData = await getNodeSourceImageBase64(node, context.settings, wrapId, context.figmaImageMap);
    let wrapImageSrc = '';
    if (wrapImageData && wrapImageData.url) {
      wrapImageSrc = wrapImageData.url;
    } else if (wrapImageData && wrapImageData.base64) {
      wrapImageSrc = 'data:image/' + wrapImageData.ext + ';base64,' + wrapImageData.base64;
    } else if (wrapImageData && wrapImageData.failed) {
      context.warnings.push('Image export failed for "' + node.name + '": ' + wrapImageData.reason);
    }

    const imageBlock = {
      blockType: 'core/image',
      attrs: { id: 0 },
      selfClosing: false,
      isLeaf: true,
      children: [],
      _imageSrc: wrapImageSrc,
      _imageAlt: node.name,
    };
    const wrapKids = await buildChildren(node, Object.assign({}, context, { parent: node, parentBlockType: 'sonder/div' }));
    return {
      blockType: 'sonder/div',
      attrs: { className: cl.classes || '' },
      selfClosing: false, isLeaf: false,
      children: [imageBlock].concat(wrapKids),
    };
  }

  // ---- Container: recurse into children ----

  // Pre-build heading map when entering a section
  let headingMap = context.headingMap;
  if (blockType === 'sonder/section') {
    headingMap = await buildHeadingMap(node);
  }

  const children = await buildChildren(node, Object.assign({}, context, {
    parent: node,
    parentBlockType: blockType,
    headingMap: headingMap,
  }));

  return { blockType, attrs, selfClosing: false, isLeaf: false, children };
}

/**
 * Helper: builds child BlockNodes for a given parent node.
 */
async function buildChildren(node, childContext) {
  if (!('children' in node)) return [];
  const hasBgAbsoluteSibling = node.children.some(c =>
    c.layoutPositioning === 'ABSOLUTE' && /\b(bg|background)\b/.test(c.name.toLowerCase())
  );
  const results = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const block = await buildBlockTree(child, Object.assign({}, childContext, { hasBgAbsoluteSibling }));
    if (block) results.push(block);
  }
  return results;
}


// ================================================================
// SECTION 13: PHASE 3 — SERIALIZATION
// ================================================================

/**
 * Converts block attributes to a JSON string for the WP block comment.
 * Internal attributes (prefixed with _) are excluded.
 * Returns '' if there are no public attributes.
 */
function serializeAttrs(attrs) {
  const pub = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('_')) continue;
    if (v === undefined || v === null || v === '') continue;
    pub[k] = v;
  }
  return Object.keys(pub).length ? ' ' + JSON.stringify(pub) : '';
}

/**
 * Returns the inner HTML string for leaf blocks (heading, paragraph, icon, spacer, separator).
 */
function getLeafHTML(block) {
  const { blockType, attrs } = block;

  if (blockType === 'core/heading') {
    const lvl = attrs.level || 2;
    const cls = attrs.className
      ? `wp-block-heading ${attrs.className}`
      : 'wp-block-heading';
    const headingText = (attrs._text || '').replace(/\n/g, '<br>');
    return `<h${lvl} class="${cls}">${headingText}</h${lvl}>`;
  }

  if (blockType === 'core/paragraph') {
    const cls = attrs.className || '';
    const clsAttr = cls ? ` class="${cls}"` : '';
    const text = (attrs._text || '').replace(/\n/g, '<br>');
    return `<p${clsAttr}>${text}</p>`;
  }

  if (blockType === 'sonder/svg') {
    const svg = attrs._svgContent || '';
    const cls = attrs.className ? ` class="${attrs.className}"` : '';
    return `<div${cls}>${svg}</div>`;
  }

  if (blockType === 'sonder/icon') {
    const svg = attrs._svgContent || '';
    if (!svg) return '<svg aria-hidden="true"><use href=""></use></svg>';
    const cls = attrs.className ? ` class="${attrs.className}"` : '';
    // Inject className and aria-hidden into the SVG opening tag
    return svg.replace(/^<svg/, `<svg${cls} aria-hidden="true"`);
  }

  if (blockType === 'sonder/bg-image') {
    const src = block._imageSrc || '';
    const alt = block._imageAlt || '';
    const cls = attrs.className ? ` class="${attrs.className}"` : '';
    return `<img src="${src}" alt="${alt}"${cls}/>`;
  }

  if (blockType === 'core/image') {
    const src = block._imageSrc || '';
    const alt = block._imageAlt || '';
    const extraCls = attrs.className ? ' ' + attrs.className : '';
    const figureCls = block._figureClass ? ' ' + block._figureClass : '';
    return `<figure class="wp-block-image${extraCls}${figureCls}"><img src="${src}" alt="${alt}"/></figure>`;
  }

  if (blockType === 'core/spacer') {
    return `<div style="height:${attrs.height || 100}px" aria-hidden="true" class="wp-block-spacer"></div>`;
  }

  if (blockType === 'core/separator') {
    const bgCls = attrs.backgroundColor
      ? ` has-${attrs.backgroundColor}-color has-${attrs.backgroundColor}-background-color has-background`
      : '';
    const extraCls = attrs.className ? ` ${attrs.className}` : '';
    return `<hr class="wp-block-separator${bgCls} is-style-wide${extraCls}"/>`;
  }

  return '';
}

/**
 * Serializes a BlockNode to WordPress block markup.
 * @param {object} block  - BlockNode
 * @param {number} indent - Indentation depth
 */
function serializeBlock(block, indent) {
  const pad = '  '.repeat(indent);

  // Visible warning block
  if (block.blockType === '__warning__') {
    return [
      `${pad}<!-- wp:paragraph {"className":"text-error-500"} -->`,
      `${pad}<p class="text-error-500">⚠️ No block mapping found for component: "${block.warningName}"</p>`,
      `${pad}<!-- /wp:paragraph -->`,
    ].join('\n');
  }

  const attrsStr  = serializeAttrs(block.attrs);
  const openDecl  = `<!-- wp:${block.blockType}${attrsStr}`;
  const closeDecl = `<!-- /wp:${block.blockType} -->`;

  // Self-closing: <!-- wp:block {...} /-->
  if (block.selfClosing) {
    return `${pad}${openDecl} /-->`;
  }

  // Leaf block: <!-- wp:block --> [html] <!-- /wp:block -->
  if (block.isLeaf) {
    const html = getLeafHTML(block);
    return [`${pad}${openDecl} -->`, `${pad}${html}`, `${pad}${closeDecl}`].join('\n');
  }

  // Container block
  const childStr = block.children
    .map(c => serializeBlock(c, indent + 1))
    .filter(Boolean)
    .join('\n');

  const lines = [`${pad}${openDecl} -->`];
  if (childStr) lines.push(childStr);
  lines.push(`${pad}${closeDecl}`);
  return lines.join('\n');
}

/** Serializes an array of BlockNodes to a complete markup string. */
function serializeTree(blocks) {
  return blocks.map(b => serializeBlock(b, 0)).filter(Boolean).join('\n');
}


// ================================================================
// SECTION 14: SELECTION PREVIEW (FAST SYNC SCAN)
// ================================================================

/**
 * Synchronously classifies a node using name and type only.
 * No async operations — used for the live preview panel.
 * Returns { blockType, hasIssue }
 */
async function quickClassify(node, parentBlockType) {
  var parsed = parseLayerName(node.name);
  var id = parsed.id;
  var idLower = id.toLowerCase();

  // Priority 1: Explicit name
  if (BLOCK_IDENTIFIERS.hasOwnProperty(idLower)) {
    return { blockType: BLOCK_IDENTIFIERS[idLower], hasIssue: false };
  }

  // Priority 2: jpg/png prefix → image export
  if (idLower.startsWith('jpg') || idLower.startsWith('png')) {
    return { blockType: 'sonder/bg-image', hasIssue: false };
  }

  // Priority 2.5: svg prefix
  if (idLower.startsWith('svg')) {
    return { blockType: 'sonder/svg', hasIssue: false };
  }

  // Priority 3: Component instance
  if (node.type === 'INSTANCE') {
    var mainComp = await node.getMainComponentAsync();
    var compName = (mainComp && mainComp.name) ? mainComp.name : '';
    var isSkipped = SKIP_COMPONENTS.some(function(s) {
      return s.toLowerCase() === compName.toLowerCase() || s.toLowerCase() === node.name.toLowerCase();
    });
    if (isSkipped) return { blockType: '__skip__', hasIssue: false };

    for (var i = 0; i < COMPONENT_REGISTRY.length; i++) {
      var entry = COMPONENT_REGISTRY[i];
      if (matchesPattern(entry.match, compName) || matchesPattern(entry.match, node.name)) {
        if (entry.block === 'core/paragraph' && idLower.includes('button')) {
          return { blockType: 'sonder/button-new', hasIssue: false };
        }
        return { blockType: entry.block, hasIssue: false };
      }
    }
    return { blockType: '__warning__', hasIssue: true };
  }

  // Vector → svg (name prefix already handled above)
  if (node.type === 'VECTOR') return { blockType: 'sonder/svg', hasIssue: false };

  // Text (approximate — no style lookup)
  if (node.type === 'TEXT') {
    return { blockType: 'core/paragraph', hasIssue: false };
  }

  // Image fill
  if (hasImageFill(node)) {
    var hasKids = 'children' in node && node.children.length > 0;
    return { blockType: hasKids ? 'sonder/div' : 'sonder/bg-image', hasIssue: false };
  }

  // Separator (frame wrapping a single LINE)
  if ('children' in node && node.children.length === 1 && node.children[0].type === 'LINE') {
    return { blockType: 'core/separator', hasIssue: false };
  }

  // Parent context
  if (parentBlockType === 'sonder/columns') return { blockType: 'sonder/column', hasIssue: false };
  if (parentBlockType === 'sonder/grid')    return { blockType: 'sonder/grid-item', hasIssue: false };

  // Columns (horizontal auto-layout, all frame/group children)
  if (
    'layoutMode' in node && node.layoutMode === 'HORIZONTAL' &&
    'children' in node && node.children.length >= 2 &&
    node.children.every(function(c) { return c.type === 'FRAME' || c.type === 'GROUP'; })
  ) {
    return { blockType: 'sonder/columns', hasIssue: false };
  }

  // Fallback
  return { blockType: 'sonder/div', hasIssue: false };
}

/**
 * Recursively builds a lightweight preview node.
 * Stops at depth 5 to keep the tree readable.
 */
async function buildPreviewNode(node, depth, parentBlockType) {
  if (depth > 5) return null;

  var cl = await quickClassify(node, parentBlockType);
  if (cl.blockType === '__skip__') return null;

  var label = parseLayerName(node.name).id || node.name;

  var previewNode = {
    label:     label,
    blockType: cl.blockType,
    hasIssue:  cl.hasIssue,
    depth:     depth,
    children:  [],
  };

  var isSelfClosing = SELF_CLOSING_BLOCKS.has(cl.blockType);
  var isLeaf        = LEAF_BLOCKS.has(cl.blockType);

  if (!isSelfClosing && !isLeaf && 'children' in node && node.children.length > 0) {
    for (var i = 0; i < node.children.length; i++) {
      var child = await buildPreviewNode(node.children[i], depth + 1, cl.blockType);
      if (child) previewNode.children.push(child);
    }
  }

  return previewNode;
}

/** Scans the current selection and posts a 'preview' message to the UI. */
async function runPreview() {
  var selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) {
    figma.ui.postMessage({ type: 'preview', nodes: [] });
    return;
  }

  var nodes = [];
  for (var i = 0; i < selection.length; i++) {
    var node = await buildPreviewNode(selection[i], 0, null);
    if (node) nodes.push(node);
  }

  figma.ui.postMessage({ type: 'preview', nodes: nodes });
}


// ================================================================
// SECTION 15: MAIN EXPORT
// ================================================================

/**
 * Main export function.
 * Processes the current Figma selection and returns WP block markup.
 *
 * @param {object} settings - { exportImages, maxSize, jpgQuality }
 * @returns {object} - { success, markup, warnings, stripped, error }
 */
async function runExport(settings, figmaImageMap) {
  const selection = figma.currentPage.selection;

  if (!selection || selection.length === 0) {
    return { success: false, error: 'Nothing selected. Please select at least one layer.' };
  }

  const warnings = [];
  const context = {
    settings,
    figmaImageMap: figmaImageMap || null,
    headingMap: new Map(),
    parent: null,
    parentBlockType: null,
    warnings: warnings,
  };

  const blocks = [];

  for (const node of selection) {
    try {
      const block = await buildBlockTree(node, context);
      if (block) blocks.push(block);
    } catch (e) {
      warnings.push(`"${node.name}": ${e.message}`);
      console.error('Export error on node', node.name, e);
    }
  }

  if (blocks.length === 0) {
    return { success: false, error: 'No blocks could be generated from the selection.' };
  }

  let markup  = serializeTree(blocks);
  let stripped = false;

  // Check output size — strip base64 if over threshold
  const byteSize = markup.length; // ASCII-safe approximation for WP block markup
  if (byteSize > SIZE_THRESHOLD) {
    markup = markup.replace(/"imageSrc":"data:[^"]+"/g, '"imageSrc":"[stripped — use WP importer]"');
    stripped = true;
    warnings.push(`Output was over ${Math.round(SIZE_THRESHOLD / 1024)}kb. Base64 images were stripped. Run the WP image import plugin to attach images by filename.`);
  }

  return { success: true, markup, warnings, stripped };
}


// ================================================================
// SECTION 15: PLUGIN INITIALIZATION
// ================================================================

figma.showUI(__html__, {
  width: 340,
  height: 640,
  title: 'Sonder Blocks Export',
});

// Init data is sent in response to the 'ui-ready' message from the UI.

// Run preview immediately on open, then whenever selection changes.
runPreview();
figma.on('selectionchange', runPreview);

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'image-resized') {
    const cb = pendingImageResizes[msg.id];
    if (cb) {
      delete pendingImageResizes[msg.id];
      cb(msg);
    }
    return;
  }

  if (msg.type === 'ui-ready') {
    const pat     = await figma.clientStorage.getAsync('figma-pat')     || '';
    const savedKey = await figma.clientStorage.getAsync('figma-filekey') || '';
    const fileKey = figma.fileKey || savedKey || '';
    figma.ui.postMessage({ type: 'init', fileKey, pat });
    return;
  }

  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
    return;
  }


  if (msg.type === 'save-pat') {
    await figma.clientStorage.setAsync('figma-pat', msg.pat || '');
    return;
  }

  if (msg.type === 'save-filekey') {
    await figma.clientStorage.setAsync('figma-filekey', msg.fileKey || '');
    return;
  }

  if (msg.type === 'export') {
    figma.ui.postMessage({ type: 'status', message: 'Processing selection…' });

    const result = await runExport(msg.settings, msg.figmaImageMap || null);

    if (!result.success) {
      figma.ui.postMessage({ type: 'error', message: result.error });
      return;
    }

    figma.ui.postMessage({
      type:     'result',
      markup:   result.markup,
      warnings: result.warnings,
      stripped: result.stripped,
    });
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};
