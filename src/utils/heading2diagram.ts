/**
 * heading2diagram — TypeScript port of heading2diagram.py (v1.0.2)
 * https://github.com/sekita/heading2diagram
 * MIT License, Copyright (c) 2026 heading2diagram contributors
 *
 * Converts "heading format" text (Markdown-like `#` headings that describe a
 * tree) into Mermaid (flowchart / block / ishikawa / pie / venn /
 * quadrantChart) or PlantUML (mindmap / salt) diagram source.
 *
 * `runHeading2Diagram` is a line-for-line port of the CLI's `run()` and is
 * kept byte-compatible with the Python reference outputs (see
 * `__tests__/utils/heading2diagram.test.ts`). Diagnostic messages are kept in
 * Japanese, exactly as the original program prints them.
 *
 * The second half of the file (`parseHeadingInfo`, `convertHeadingBlock`, …)
 * is the editor-facing API used by the Mermaid node.
 */

// ---------------------------------------------------------------------------
// Constants (diagram types, options, notation tables)
// ---------------------------------------------------------------------------

export const typeIdList = [
  'hier-mind', 'hier-mindlabel', 'hier-block', 'hier-flow', 'fishBone',
  'pie', 'venn', 'table', 'tablec', 'table1', 'table1c', 'table2',
  'table2c', 'table3', 'table3c', 'struct-flow', 'quadrant',
] as const;
export type HeadingTypeId = (typeof typeIdList)[number];

export const tableTypeIds: readonly string[] = [
  'table', 'tablec', 'table1', 'table1c', 'table2', 'table2c', 'table3', 'table3c',
];
export const plantumlTypeIds: ReadonlySet<string> = new Set(['hier-mind', 'hier-mindlabel', ...tableTypeIds]);

export const directionChoices = ['TB', 'TD', 'BT', 'LR', 'RL'] as const;
export const layoutChoices = ['tight', 'normal', 'spacyX', 'spacyY', 'spacyXY', 'spacyPadding'] as const;
export const lineChoices = ['dotted', 'solid', 'thick', 'dottedArrow', 'solidArrow', 'thickArrow'] as const;
export const arrowDirectionChoices = ['default', 'reverse'] as const;
export const curveChoices = [
  'default', 'linear', 'bumpX', 'bumpY', 'cardinal', 'catmullRom',
  'monotoneX', 'monotoneY', 'natural', 'step',
] as const;

export type HeadingOptionName = 'direction' | 'layout' | 'line' | 'arrowDirection' | 'curve';
export type HeadingOptions = Record<HeadingOptionName, string>;
export type ExplicitHeadingOptions = Partial<HeadingOptions>;

/** Options that appear in the output heading line (per diagram type, in this order). */
export const optionOrder: readonly HeadingOptionName[] = ['direction', 'layout', 'line', 'arrowDirection', 'curve'];
export const optionChoices: Record<HeadingOptionName, readonly string[]> = {
  direction: directionChoices,
  layout: layoutChoices,
  line: lineChoices,
  arrowDirection: arrowDirectionChoices,
  curve: curveChoices,
};
export const defaultHeadingOptions: HeadingOptions = {
  direction: 'TB', layout: 'normal', line: 'solid', arrowDirection: 'default', curve: 'default',
};
const optionFlags: Record<HeadingOptionName, string> = {
  direction: '--direction', layout: '--layout', line: '--line',
  arrowDirection: '--arrowDirection', curve: '--curve',
};
export const meaningfulOptions: Record<string, readonly HeadingOptionName[]> = {
  'hier-mind': ['direction', 'layout', 'line'],
  'hier-mindlabel': ['direction', 'layout', 'line'],
  'hier-block': ['direction', 'layout', 'line', 'arrowDirection'],
  'hier-flow': ['direction', 'layout', 'line', 'arrowDirection', 'curve'],
  'struct-flow': ['layout', 'line'],
};

const lineStyleNames = new Map<string, string>([
  ['実線', 'solid'], ['solid', 'solid'],
  ['点線', 'dotted'], ['dotted', 'dotted'],
  ['太線', 'thick'], ['thick', 'thick'],
  ['実線矢印', 'solidArrow'], ['solidArrow', 'solidArrow'],
  ['点線矢印', 'dottedArrow'], ['dottedArrow', 'dottedArrow'],
  ['太線矢印', 'thickArrow'], ['thickArrow', 'thickArrow'],
]);

const shapeNames = new Map<string, string>([
  ['四角', 'rect'], ['rect', 'rect'],
  ['角丸', 'rounded'], ['rounded', 'rounded'],
  ['スタ', 'stadium'], ['stadium', 'stadium'],
  ['サブ', 'fr-rect'], ['fr-rect', 'fr-rect'],
  ['円柱', 'cyl'], ['cyl', 'cyl'],
  ['円形', 'circle'], ['circle', 'circle'],
  ['非対', 'odd'], ['odd', 'odd'],
  ['ひし', 'diam'], ['diam', 'diam'],
  ['六角', 'hex'], ['hex', 'hex'],
  ['四右', 'lean-r'], ['lean-r', 'lean-r'],
  ['四左', 'lean-l'], ['lean-l', 'lean-l'],
  ['台形', 'trap-b'], ['trap-b', 'trap-b'],
  ['逆台', 'trap-t'], ['trap-t', 'trap-t'],
  ['重円', 'dbl-circ'], ['dbl-circ', 'dbl-circ'],
  ['無枠', 'borderless'], ['borderless', 'borderless'],
]);

/** Mermaid shape notation (opening bracket, closing bracket). */
const shapeBrackets: Record<string, [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  stadium: ['([', '])'],
  'fr-rect': ['[[', ']]'],
  cyl: ['[(', ')]'],
  circle: ['((', '))'],
  odd: ['>', ']'],
  diam: ['{', '}'],
  hex: ['{{', '}}'],
  'lean-r': ['[/', '/]'],
  'lean-l': ['[\\', '\\]'],
  'trap-b': ['[/', '\\]'],
  'trap-t': ['[\\', '/]'],
  'dbl-circ': ['(((', ')))'],
  borderless: ['[', ']'],
};

const flowSymbols: Record<string, string> = {
  solid: '---', dotted: '-.-', thick: '===',
  solidArrow: '-->', dottedArrow: '-.->', thickArrow: '==>',
};
const blockSymbols: Record<string, string> = {
  solid: '---', dotted: '-.-', thick: '===',
  solidArrow: '--->', dottedArrow: '-.->', thickArrow: '===>',
};
const blockReverseSymbols: Record<string, string> = {
  solidArrow: '<---', dottedArrow: '<-.-', thickArrow: '<===',
};
const reverseDirection: Record<string, string> = { TB: 'BT', TD: 'BT', BT: 'TB', LR: 'RL', RL: 'LR' };

const headingRe = /^(#+)(?:[ \t]+([\s\S]*))?$/;
const headingTypoRe = /^#+[^ \t#]/;
const colorRe = /^([\s\S]*):(#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3}))$/;
// Python's `\S` (str.isspace) differs slightly from JavaScript's, so the
// whitespace set is spelled out to stay identical to the reference program.
const badColorRe = /:#[^\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const modifierRe = /^([^ \t;]*);/;
const numberRe = /^[0-9]+(\.[0-9]+)?$/;

const fullWidthSpace = '\u3000';

// ---------------------------------------------------------------------------
// Small helpers mirroring Python string semantics
// ---------------------------------------------------------------------------

const isBlank = (ch: string): boolean => ch === ' ' || ch === '\t';

function stripLeft(text: string): string {
  let start = 0;
  while (start < text.length && isBlank(text[start])) start++;
  return text.slice(start);
}

function stripRight(text: string): string {
  let end = text.length;
  while (end > 0 && isBlank(text[end - 1])) end--;
  return text.slice(0, end);
}

const stripBoth = (text: string): string => stripLeft(stripRight(text));

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Collects warnings / errors (the same warning is reported only once). */
export class Diagnostics {
  private seenWarnings = new Set<string>();
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  /** Combined stream, formatted exactly like the CLI's stderr. */
  readonly log: string[] = [];

  warn(message: string): void {
    if (this.seenWarnings.has(message)) return;
    this.seenWarnings.add(message);
    this.warnings.push(message);
    this.log.push('warning: ' + message);
  }

  error(message: string): void {
    this.errors.push(message);
    this.log.push('error: ' + message);
  }
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/** Parsed result of one heading line. */
interface HeadingEntry {
  lineNo: number;
  rawLevel: number;
  label: string | null;
  lineStyle: string | null;
  shape: string | null;
  text: string;
  color: string | null;
}

/** A node of the tree. */
interface TreeNode {
  entry: HeadingEntry;
  level: number;
  children: TreeNode[];
  parent: TreeNode | null;
  nodeId: string;
  label: string | null;
  lineStyle: string | null;
  shape: string | null;
  text: string;
  color: string | null;
  lineNo: number;
}

/** Splits heading content into label / modifiers / text / colour (4.1). */
function parseContent(content: string, lineNo: number, diag: Diagnostics): Omit<HeadingEntry, 'lineNo' | 'rawLevel'> {
  let rest = stripRight(content);
  let label: string | null = null;

  // 1. Label
  if (rest.startsWith('|')) {
    const closeIndex = rest.indexOf('|', 1);
    if (closeIndex < 0) {
      diag.warn(`${lineNo}行目: ラベルの閉じ "|" が無いため、"|" を含めて内容全体をテキストとして扱う`);
    } else {
      const labelText = stripBoth(rest.slice(1, closeIndex));
      if (labelText === '') {
        diag.warn(`${lineNo}行目: ラベルが空（||）のため、ラベル無しとして扱う`);
      } else {
        label = labelText;
      }
      rest = stripLeft(rest.slice(closeIndex + 1));
    }
  }

  // 2. Colour
  let color: string | null = null;
  const colorMatch = colorRe.exec(rest);
  if (colorMatch) {
    rest = colorMatch[1];
    color = colorMatch[2];
  } else if (badColorRe.test(rest)) {
    diag.warn(`${lineNo}行目: 色の指定 ":#..." が16進3桁または6桁ではない（書き間違いの可能性）。テキストの一部として扱う`);
  }

  // 3. Modifiers (line style name / shape name)
  let lineStyle: string | null = null;
  let shape: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const modifierMatch = modifierRe.exec(rest);
    if (!modifierMatch) break;
    const name = modifierMatch[1];
    if (lineStyleNames.has(name)) {
      if (lineStyle !== null) {
        diag.warn(`${lineNo}行目: 線種名が2回指定されている。"${name};" はテキストの一部として扱う`);
        break;
      }
      lineStyle = lineStyleNames.get(name)!;
    } else if (shapeNames.has(name)) {
      if (shape !== null) {
        diag.warn(`${lineNo}行目: 形状名が2回指定されている。"${name};" はテキストの一部として扱う`);
        break;
      }
      shape = shapeNames.get(name)!;
    } else {
      diag.warn(`${lineNo}行目: "${name};" は既知の線種名・形状名ではない（書き間違いの可能性）。テキストの一部として扱う`);
      break;
    }
    rest = stripLeft(rest.slice(modifierMatch[0].length));
  }

  // 4. Text
  const text = stripBoth(rest);
  return { label, lineStyle, shape, text, color };
}

/** Parses the whole input and returns the list of heading lines. */
function parseInput(sourceText: string, diag: Diagnostics): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  const rawLines = sourceText.split('\n');
  for (let index = 0; index < rawLines.length; index++) {
    const lineNo = index + 1;
    const line = rawLines[index].replace(/\r+$/, '');
    if (stripBoth(line) === '') continue;
    const headingMatch = headingRe.exec(line);
    if (headingMatch === null) {
      if (headingTypoRe.test(line)) {
        diag.warn(`${lineNo}行目: "#" の直後に空白が無い（見出し行の書き間違いの可能性）。この行を無視する`);
      } else {
        diag.warn(`${lineNo}行目: 見出し行でも空行でもない行を無視する`);
      }
      continue;
    }
    const rawLevel = headingMatch[1].length;
    const content = headingMatch[2] || '';
    entries.push({ lineNo, rawLevel, ...parseContent(content, lineNo, diag) });
  }
  return entries;
}

/** Assigns node ids (5.1). */
function assignNodeIds(roots: TreeNode[]): void {
  const assign = (node: TreeNode, nodeId: string) => {
    node.nodeId = nodeId;
    node.children.forEach((child, childIndex) => assign(child, `${nodeId}_${childIndex + 1}`));
  };
  roots.forEach((root, rootIndex) => assign(root, `N${rootIndex + 1}`));
}

/** Builds the tree from the heading lines (4.2). */
function buildTree(entries: HeadingEntry[], includeEmpty: boolean, diag: Diagnostics): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  let prevLevel = 0;
  for (const entry of entries) {
    if (entry.text === '' && !includeEmpty) continue;
    const level = entry.rawLevel;
    let effectiveLevel: number;
    if (level > prevLevel + 1) {
      effectiveLevel = prevLevel + 1;
      if (prevLevel === 0) {
        diag.warn(`${entry.lineNo}行目: 先頭の見出し行のレベルが${level}である（レベル飛び）。ルート（レベル1）として扱う`);
      } else {
        diag.warn(`${entry.lineNo}行目: レベル飛び（直前の見出し行のレベル${prevLevel}に対してレベル${level}）。`
          + `直前の見出し行の節の子（レベル${effectiveLevel}）として扱う`);
      }
    } else {
      effectiveLevel = level;
    }
    const node: TreeNode = {
      entry,
      level: effectiveLevel,
      children: [],
      parent: null,
      nodeId: '',
      label: entry.label,
      lineStyle: entry.lineStyle,
      shape: entry.shape,
      text: entry.text,
      color: entry.color,
      lineNo: entry.lineNo,
    };
    stack.length = effectiveLevel - 1;
    if (effectiveLevel === 1) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      node.parent = parent;
    }
    stack.push(node);
    prevLevel = effectiveLevel;
  }
  assignNodeIds(roots);
  return roots;
}

/** Lists every node depth-first (in order of appearance). */
function walkDepthFirst(roots: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  const visit = (node: TreeNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}

/** Lists parent/child pairs breadth-first (10.4). */
function walkBreadthFirst(root: TreeNode): Array<[TreeNode, TreeNode]> {
  const pairs: Array<[TreeNode, TreeNode]> = [];
  const queue: TreeNode[] = [root];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const parent = queue[queueIndex];
    for (const child of parent.children) {
      pairs.push([parent, child]);
      queue.push(child);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Replaces `"` with `#quot;` for Mermaid (5.2). */
const quoteText = (text: string): string => text.split('"').join('#quot;');

/** Mermaid node definition (4.3). */
function shapeDefinition(node: TreeNode): string {
  const [openBracket, closeBracket] = shapeBrackets[node.shape || 'rect'];
  return `${node.nodeId}${openBracket}"${quoteText(node.text)}"${closeBracket}`;
}

/** `style` lines for colours and borderless nodes. */
function styleLines(nodes: TreeNode[]): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.shape === 'borderless') {
      if (node.color) lines.push(`style ${node.nodeId} fill:${node.color},stroke:none`);
      else lines.push(`style ${node.nodeId} fill:none,stroke:none`);
    } else if (node.color) {
      lines.push(`style ${node.nodeId} fill:${node.color}`);
    }
  }
  return lines;
}

const spaceToken = (count: number): string => (count === 1 ? 'space' : `space:${count}`);

/** Renders one grid row (10.1). */
function renderGridRow(cells: Array<string | null>): string {
  const parts: string[] = [];
  let emptyRun = 0;
  for (const cell of cells) {
    if (cell === null) {
      emptyRun += 1;
    } else {
      if (emptyRun) {
        parts.push(spaceToken(emptyRun));
        emptyRun = 0;
      }
      parts.push(cell);
    }
  }
  if (emptyRun) parts.push(spaceToken(emptyRun));
  return parts.join(' ');
}

/** Level coordinates t(L) and T for the `tight` layout (10.1). */
function tightCoordinates(nodes: TreeNode[], maxLevel: number): { levelCoord: number[]; tightTotal: number } {
  const gapFlags: number[] = new Array(maxLevel + 1).fill(0);
  for (const node of nodes) {
    if (node.level >= 2 && node.label) gapFlags[node.level - 1] = 1;
  }
  const levelCoord: number[] = [0, 1];
  for (let level = 1; level < maxLevel; level++) {
    levelCoord[level + 1] = levelCoord[level] + 1 + gapFlags[level];
  }
  return { levelCoord, tightTotal: levelCoord[maxLevel] };
}

/** An edge of a block diagram (5.3, 5.4). */
function blockEdge(parentId: string, childId: string, lineStyle: string, label: string | null, reverse: boolean): string {
  let symbol = blockSymbols[lineStyle];
  if (reverse && lineStyle in blockReverseSymbols) symbol = blockReverseSymbols[lineStyle];
  if (label) return `${parentId} -- "${quoteText(label)}" ${symbol} ${childId}`;
  return `${parentId} ${symbol} ${childId}`;
}

// East Asian Width "W"/"F" code point ranges (Unicode 15.1, as used by the
// reference implementation's `unicodedata.east_asian_width`).
const wideRanges: readonly number[] = [
  0x1100, 0x115f, 0x231a, 0x231b, 0x2329, 0x232a, 0x23e9, 0x23ec, 0x23f0, 0x23f0, 0x23f3, 0x23f3,
  0x25fd, 0x25fe, 0x2614, 0x2615, 0x2648, 0x2653, 0x267f, 0x267f, 0x2693, 0x2693, 0x26a1, 0x26a1,
  0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26ce, 0x26d4, 0x26d4, 0x26ea, 0x26ea,
  0x26f2, 0x26f3, 0x26f5, 0x26f5, 0x26fa, 0x26fa, 0x26fd, 0x26fd, 0x2705, 0x2705, 0x270a, 0x270b,
  0x2728, 0x2728, 0x274c, 0x274c, 0x274e, 0x274e, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797,
  0x27b0, 0x27b0, 0x27bf, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b50, 0x2b55, 0x2b55, 0x2e80, 0x2e99,
  0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x303e, 0x3041, 0x3096, 0x3099, 0x30ff, 0x3105, 0x312f,
  0x3131, 0x318e, 0x3190, 0x31e3, 0x31ef, 0x321e, 0x3220, 0x3247, 0x3250, 0x4dbf, 0x4e00, 0xa48c,
  0xa490, 0xa4c6, 0xa960, 0xa97c, 0xac00, 0xd7a3, 0xf900, 0xfaff, 0xfe10, 0xfe19, 0xfe30, 0xfe52,
  0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0xff01, 0xff60, 0xffe0, 0xffe6, 0x16fe0, 0x16fe4,
  0x16ff0, 0x16ff1, 0x17000, 0x187f7, 0x18800, 0x18cd5, 0x18d00, 0x18d08, 0x1aff0, 0x1aff3,
  0x1aff5, 0x1affb, 0x1affd, 0x1affe, 0x1b000, 0x1b122, 0x1b132, 0x1b132, 0x1b150, 0x1b152,
  0x1b155, 0x1b155, 0x1b164, 0x1b167, 0x1b170, 0x1b2fb, 0x1f004, 0x1f004, 0x1f0cf, 0x1f0cf,
  0x1f18e, 0x1f18e, 0x1f191, 0x1f19a, 0x1f200, 0x1f202, 0x1f210, 0x1f23b, 0x1f240, 0x1f248,
  0x1f250, 0x1f251, 0x1f260, 0x1f265, 0x1f300, 0x1f320, 0x1f32d, 0x1f335, 0x1f337, 0x1f37c,
  0x1f37e, 0x1f393, 0x1f3a0, 0x1f3ca, 0x1f3cf, 0x1f3d3, 0x1f3e0, 0x1f3f0, 0x1f3f4, 0x1f3f4,
  0x1f3f8, 0x1f43e, 0x1f440, 0x1f440, 0x1f442, 0x1f4fc, 0x1f4ff, 0x1f53d, 0x1f54b, 0x1f54e,
  0x1f550, 0x1f567, 0x1f57a, 0x1f57a, 0x1f595, 0x1f596, 0x1f5a4, 0x1f5a4, 0x1f5fb, 0x1f64f,
  0x1f680, 0x1f6c5, 0x1f6cc, 0x1f6cc, 0x1f6d0, 0x1f6d2, 0x1f6d5, 0x1f6d7, 0x1f6dc, 0x1f6df,
  0x1f6eb, 0x1f6ec, 0x1f6f4, 0x1f6fc, 0x1f7e0, 0x1f7eb, 0x1f7f0, 0x1f7f0, 0x1f90c, 0x1f93a,
  0x1f93c, 0x1f945, 0x1f947, 0x1f9ff, 0x1fa70, 0x1fa7c, 0x1fa80, 0x1fa88, 0x1fa90, 0x1fabd,
  0x1fabf, 0x1fac5, 0x1face, 0x1fadb, 0x1fae0, 0x1fae8, 0x1faf0, 0x1faf8, 0x20000, 0x2fffd,
  0x30000, 0x3fffd,
];

function isWide(codePoint: number): boolean {
  let low = 0;
  let high = wideRanges.length / 2 - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (codePoint < wideRanges[2 * mid]) high = mid - 1;
    else if (codePoint > wideRanges[2 * mid + 1]) low = mid + 1;
    else return true;
  }
  return false;
}

/** Display width (8.3.2). */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch.codePointAt(0)!) ? 2 : 1;
  return width;
}

/** Splits a pie slice "name:number"; null when it does not fit. */
function parsePieText(text: string): [string, string] | null {
  const colonIndex = text.lastIndexOf(':');
  if (colonIndex < 0) return null;
  const name = stripBoth(text.slice(0, colonIndex));
  const value = stripBoth(text.slice(colonIndex + 1));
  if (name === '' || !numberRe.test(value)) return null;
  return [name, value];
}

/** Splits a venn "name[:number]". */
function parseVennText(text: string): [string, string | null] {
  const colonIndex = text.lastIndexOf(':');
  if (colonIndex >= 0) {
    const value = stripBoth(text.slice(colonIndex + 1));
    if (numberRe.test(value)) return [stripBoth(text.slice(0, colonIndex)), value];
  }
  return [stripBoth(text), null];
}

/** Coordinate notation for quadrant charts (9.1). */
function formatCoordinate(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (hundredths % 10 === 0) return `${whole}.${fraction / 10}`;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Input conditions (4.4)
// ---------------------------------------------------------------------------

/** Checks the input condition; returns the violation text, or null when satisfied. */
function checkCondition(typeId: string, mainRoots: TreeNode[], tableRoots: TreeNode[]): string | null {
  if (typeId.startsWith('hier-') || typeId === 'fishBone') {
    if (mainRoots.length !== 1) return `ルートがちょうど1個であること（ルートが${mainRoots.length}個ある）`;
    return null;
  }

  if (tableTypeIds.includes(typeId)) {
    if (tableRoots.length < 1) return 'ルートが1個以上であること';
    if (Math.max(...walkDepthFirst(tableRoots).map(n => n.level)) > 2) {
      return 'レベルが2以下であること（レベル3以上の節が存在する）';
    }
    return null;
  }

  if (typeId === 'struct-flow') {
    if (mainRoots.length < 1) return 'ルートが1個以上であること';
    return null;
  }

  const nodes = walkDepthFirst(mainRoots);

  if (typeId === 'pie') {
    if (mainRoots.length !== 1) return `ルートがちょうど1個であること（ルートが${mainRoots.length}個ある）`;
    const slices = nodes.filter(n => n.level === 2);
    if (!slices.length) return 'レベル2の節が1個以上であること';
    if (nodes.some(n => n.level >= 3)) return 'レベル3以上の節が存在しないこと';
    for (const node of slices) {
      if (parsePieText(node.text) === null) {
        return `レベル2の節が「名称:数値」形式であること（${node.lineNo}行目 "${node.text}"）`;
      }
    }
    return null;
  }

  if (typeId === 'venn') {
    if (nodes.some(n => n.level > 3)) return 'レベルが3以下であること（レベル4以上の節が存在する）';
    const level1Count = nodes.filter(n => n.level === 1).length;
    const level2Count = nodes.filter(n => n.level === 2).length;
    const level3Count = nodes.filter(n => n.level === 3).length;
    if (!(level1Count >= 1 && level1Count <= 3)) return `レベル1の節が1個以上3個以下であること（${level1Count}個ある）`;
    if (level2Count > 3) return `レベル2の節が高々3個であること（${level2Count}個ある）`;
    if (level3Count > 1) return `レベル3の節が高々1個であること（${level3Count}個ある）`;
    let seenSets = 0;
    let seenLevel2 = 0;
    const requiredForLevel2 = [2, 3, 3];
    for (const node of nodes) {
      const [name] = parseVennText(node.text);
      if (name === '') return `全節の名称が空でないこと（${node.lineNo}行目）`;
      if (node.level === 1) {
        seenSets += 1;
      } else if (node.level === 2) {
        seenLevel2 += 1;
        if (seenSets < requiredForLevel2[seenLevel2 - 1]) {
          return `対応集合の出現（${node.lineNo}行目の${seenLevel2}番目のレベル2の領域に必要な集合が`
            + 'それより前に出現していない）';
        }
      } else if (seenSets < 3) {
        return `対応集合の出現（${node.lineNo}行目のレベル3の領域に必要な集合 N1・N2・N3 がそれより前に出現していない）`;
      }
    }
    return null;
  }

  if (typeId === 'quadrant') {
    if (mainRoots.length !== 2) return `ルートがちょうど2個であること（ルートが${mainRoots.length}個ある）`;
    if (nodes.some(n => n.level >= 4)) return 'レベル4以上の節が存在しないこと';
    for (const root of mainRoots) {
      if (root.children.length !== 2) {
        return `レベル2の節が各ルートにちょうど2個であること（${root.lineNo}行目のルートに${root.children.length}個ある）`;
      }
      for (const child of root.children) {
        if (!(child.children.length >= 1 && child.children.length <= 9)) {
          return 'レベル3の節が各レベル2節に1個以上9個以下であること'
            + `（${child.lineNo}行目の節に${child.children.length}個ある）`;
        }
      }
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-type generators
// ---------------------------------------------------------------------------

/** hier-mind / hier-mindlabel (6.1, 6.2). */
function generateMindmap(roots: TreeNode[], options: HeadingOptions, labelMode: boolean, typeId: string, diag: Diagnostics): string {
  const root = roots[0];
  const nodes = walkDepthFirst(roots);

  if (nodes.some(n => n.shape !== null && n.shape !== 'borderless' && n.shape !== 'rounded')) {
    diag.warn(`${typeId}: PlantUML mindmapでは枠の形状を表現できない（「無枠」「角丸」以外の形状指定を無視する）`);
  }
  if (nodes.some(n => n.lineStyle)) {
    diag.warn(`${typeId}: PlantUML mindmapでは節ごとの線種を変更できない（線種名指定を無視する）`);
  }

  let direction = options.direction;
  if (direction === 'BT') {
    diag.warn(`${typeId}: PlantUML mindmapでは方向 BT はサポートされていないため、TB として扱う`);
    direction = 'TB';
  }
  const directionLine = ({
    TB: 'top to bottom direction', TD: 'top to bottom direction',
    LR: 'left to right direction', RL: 'right to left direction',
  } as Record<string, string>)[direction];

  let lineStyle = options.line;
  if (lineStyle.endsWith('Arrow')) {
    const plainStyle = lineStyle.slice(0, -'Arrow'.length);
    diag.warn(`${typeId}: PlantUML mindmapでは矢印を付けられないため、--line ${lineStyle} を ${plainStyle} として扱う`);
    lineStyle = plainStyle;
  }

  const layout = options.layout;
  let padding: number;
  let margin: number;
  if (layout === 'tight') [padding, margin] = [3, 2];
  else if (layout === 'normal') [padding, margin] = [3, 5];
  else [padding, margin] = [5, 10];

  const out = ['@startmindmap', '<style>', 'mindmapDiagram {',
    '  node {', '    RoundCorner 0', `    Padding ${padding}`, `    Margin ${margin}`, '  }'];
  for (const node of nodes) {
    const isRounded = node.shape === 'rounded';
    if (node.color || isRounded) {
      out.push(`  .${node.nodeId}Node {`);
      if (isRounded) out.push('    RoundCorner 8');
      if (node.color) out.push(`    BackgroundColor ${node.color}`);
      out.push('  }');
    }
  }
  if (lineStyle === 'dotted') out.push('  arrow {', '    LineStyle 2-2', '  }');
  else if (lineStyle === 'thick') out.push('  arrow {', '    LineThickness 4', '  }');
  out.push('}', '</style>', directionLine);

  if (labelMode && root.label) {
    diag.warn(`${typeId}: ${root.lineNo}行目: ルートのラベル "${root.label}" は無視する`);
  }

  const isVertical = direction === 'TB' || direction === 'TD';
  const alternativeLabel = lineStyle === 'dotted'
    ? (isVertical ? ':' : '\u2026')
    : (isVertical ? '|' : '-');

  const nodeLine = (node: TreeNode, depth: number): string => {
    const marker = '*'.repeat(depth) + (node.shape === 'borderless' ? '_' : '');
    const suffix = (node.color || node.shape === 'rounded') ? ` <<${node.nodeId}Node>>` : '';
    return `${marker} ${node.text}${suffix}`;
  };

  const emit = (node: TreeNode, depth: number): void => {
    out.push(nodeLine(node, depth));
    const groupHasLabel = labelMode && node.children.some(child => child.label);
    for (const child of node.children) {
      if (groupHasLabel) {
        out.push('*'.repeat(depth + 1) + '_ ' + (child.label || alternativeLabel));
        emit(child, depth + 2);
      } else {
        emit(child, depth + 1);
      }
    }
  };

  emit(root, 1);
  out.push('@endmindmap');
  return out.join('\n');
}

/** hier-flow (6.3). */
function generateFlowchart(roots: TreeNode[], options: HeadingOptions): string {
  const root = roots[0];
  const direction = options.direction;
  const reverse = options.arrowDirection === 'reverse';
  const isVertical = direction === 'TB' || direction === 'TD' || direction === 'BT';

  let padding = 8;
  let nodeSpacing = 30;
  let rankSpacing = 30;
  const layout = options.layout;
  if (layout === 'tight') {
    nodeSpacing = rankSpacing = 15;
  } else if (layout === 'spacyXY') {
    nodeSpacing = rankSpacing = 50;
  } else if (layout === 'spacyX') {
    if (isVertical) nodeSpacing = 50;
    else rankSpacing = 50;
  } else if (layout === 'spacyY') {
    if (isVertical) rankSpacing = 50;
    else nodeSpacing = 50;
  } else if (layout === 'spacyPadding') {
    padding = 16;
  }

  const out = ['---', 'config:', '  flowchart:', `    padding: ${padding}`,
    `    nodeSpacing: ${nodeSpacing}`, `    rankSpacing: ${rankSpacing}`,
    '    diagramPadding: 5', '---'];
  if (options.curve !== 'default') {
    out.push('%%{init:{"flowchart":{"curve":"' + options.curve + '"}}}%%');
  }
  out.push('flowchart ' + (reverse ? reverseDirection[direction] : direction));

  const definedIds = new Set<string>();
  const reference = (node: TreeNode): string => {
    if (definedIds.has(node.nodeId)) return node.nodeId;
    definedIds.add(node.nodeId);
    return shapeDefinition(node);
  };

  const pairs = walkBreadthFirst(root);
  if (!pairs.length) out.push(reference(root));
  for (const [parent, child] of pairs) {
    const symbol = flowSymbols[child.lineStyle || options.line];
    const labelPart = child.label ? `|"${quoteText(child.label)}"|` : '';
    let leftText: string;
    let rightText: string;
    if (reverse) {
      leftText = reference(child);
      rightText = reference(parent);
    } else {
      leftText = reference(parent);
      rightText = reference(child);
    }
    if (labelPart) out.push(`${leftText} ${symbol} ${labelPart}${rightText}`);
    else out.push(`${leftText} ${symbol} ${rightText}`);
  }

  const styles = styleLines(walkDepthFirst(roots));
  if (styles.length) out.push('', ...styles);
  return out.join('\n');
}

const blockFrontmatter = (): string[] => ['---', 'config:', '  block:', '    padding: 30', '---'];

/** hier-block (6.4, 10.2-10.4). */
function generateHierBlock(roots: TreeNode[], options: HeadingOptions): string {
  const root = roots[0];
  const nodes = walkDepthFirst(roots);
  const maxLevel = Math.max(...nodes.map(n => n.level));
  const layout = options.layout;
  const direction = options.direction;
  const reverse = options.arrowDirection === 'reverse';
  const isSpacyX = layout === 'spacyX' || layout === 'spacyXY';
  const isSpacyY = layout === 'spacyY' || layout === 'spacyXY';
  const isTight = layout === 'tight';

  // 10.2 Position
  const positions = new Map<string, number>();
  let leafCount = 0;
  const assignPosition = (node: TreeNode): void => {
    if (!node.children.length) {
      leafCount += 1;
      positions.set(node.nodeId, leafCount);
      return;
    }
    node.children.forEach(assignPosition);
    const childPositions = node.children.map(c => positions.get(c.nodeId)!);
    positions.set(node.nodeId, Math.floor((Math.min(...childPositions) + Math.max(...childPositions)) / 2));
  };
  assignPosition(root);
  const { levelCoord, tightTotal } = tightCoordinates(nodes, maxLevel);

  // 10.3 Expansion onto the grid
  const cellOf = new Map<string, [number, number]>();
  let width: number;
  let rowCount: number;
  if (direction === 'TB' || direction === 'TD' || direction === 'BT') {
    width = isSpacyX ? 2 * leafCount - 1 : leafCount;
    if (isTight) rowCount = tightTotal;
    else if (isSpacyY) rowCount = 3 * maxLevel - 2;
    else rowCount = 2 * maxLevel - 1;
    for (const node of nodes) {
      const position = positions.get(node.nodeId)!;
      const column = isSpacyX ? 2 * position - 1 : position;
      let row: number;
      if (isTight) row = levelCoord[node.level];
      else if (isSpacyY) row = 3 * node.level - 2;
      else row = 2 * node.level - 1;
      if (direction === 'BT') row = rowCount + 1 - row;
      cellOf.set(node.nodeId, [row, column]);
    }
  } else {
    if (isTight) width = tightTotal;
    else if (isSpacyX) width = 3 * maxLevel - 2;
    else width = 2 * maxLevel - 1;
    rowCount = isSpacyY ? 2 * leafCount - 1 : leafCount;
    for (const node of nodes) {
      const position = positions.get(node.nodeId)!;
      let column: number;
      if (isTight) column = levelCoord[node.level];
      else if (isSpacyX) column = 3 * node.level - 2;
      else column = 2 * node.level - 1;
      if (direction === 'RL') column = width + 1 - column;
      const row = isSpacyY ? 2 * position - 1 : position;
      cellOf.set(node.nodeId, [row, column]);
    }
  }

  const grid: Array<Array<string | null>> = Array.from({ length: rowCount }, () => new Array(width).fill(null));
  for (const node of nodes) {
    const [row, column] = cellOf.get(node.nodeId)!;
    grid[row - 1][column - 1] = shapeDefinition(node);
  }

  const out: string[] = [];
  if (layout === 'spacyPadding') out.push(...blockFrontmatter());
  out.push('block', `columns ${width}`);
  out.push(...grid.map(renderGridRow));

  // 10.4 Edge order
  const edges = walkBreadthFirst(root).map(([parent, child]) =>
    blockEdge(parent.nodeId, child.nodeId, child.lineStyle || options.line, child.label, reverse));
  if (edges.length) out.push('', ...edges);
  const styles = styleLines(nodes);
  if (styles.length) out.push('', ...styles);
  return out.join('\n');
}

/** struct-flow (10.5-10.6). */
function generateStructFlow(roots: TreeNode[], options: HeadingOptions): string {
  const nodes = walkDepthFirst(roots);
  const maxLevel = Math.max(...nodes.map(n => n.level));
  const layout = options.layout;
  const isSpacyX = layout === 'spacyX' || layout === 'spacyXY';
  const isSpacyY = layout === 'spacyY' || layout === 'spacyXY';
  const { levelCoord, tightTotal } = tightCoordinates(nodes, maxLevel);

  let width: number;
  if (layout === 'tight') width = tightTotal;
  else if (isSpacyX) width = 3 * maxLevel - 2;
  else width = 2 * maxLevel - 1;

  const columnOf = (node: TreeNode): number => {
    if (layout === 'tight') return levelCoord[node.level];
    if (isSpacyX) return 3 * node.level - 2;
    return 2 * node.level - 1;
  };

  // Row assignment (one group per root)
  const groups: string[][] = [];
  for (const root of roots) {
    const groupRows: Array<Array<string | null>> = [];
    const place = (node: TreeNode, rowIndexIn: number | null): void => {
      let rowIndex = rowIndexIn;
      if (rowIndex === null) {
        groupRows.push(new Array(width).fill(null));
        rowIndex = groupRows.length - 1;
      }
      groupRows[rowIndex][columnOf(node) - 1] = shapeDefinition(node);
      const ownRow = rowIndex;
      node.children.forEach((child, childIndex) => place(child, childIndex === 0 ? ownRow : null));
    };
    place(root, null);
    groups.push(groupRows.map(renderGridRow));
  }

  const out: string[] = [];
  if (layout === 'spacyPadding') out.push(...blockFrontmatter());
  out.push('block', `columns ${width}`);
  const blankRow = spaceToken(width);
  groups.forEach((groupRows, groupIndex) => {
    if (groupIndex > 0) {
      out.push('');
      if (isSpacyY) out.push(blankRow);
    }
    groupRows.forEach((rowText, rowIndex) => {
      if (rowIndex > 0 && isSpacyY) out.push(blankRow);
      out.push(rowText);
    });
  });

  // 10.6 Edges
  const defaultLine = options.line;
  const subtreeEdges = (node: TreeNode, edgeList: string[]): void => {
    node.children.forEach((child, childIndex) => {
      const lineStyle = child.lineStyle || defaultLine;
      if (child.label) {
        edgeList.push(blockEdge(node.nodeId, child.nodeId, lineStyle, child.label, false));
      } else if (childIndex === 0) {
        edgeList.push(blockEdge(node.nodeId, child.nodeId, lineStyle, null, false));
      } else {
        const previous = node.children[childIndex - 1];
        edgeList.push(blockEdge(previous.nodeId, child.nodeId, lineStyle, null, false));
      }
      subtreeEdges(child, edgeList);
    });
  };

  const edgeGroups: string[][] = [];
  roots.forEach((root, rootIndex) => {
    const edgeList: string[] = [];
    if (rootIndex > 0) {
      const previousRoot = roots[rootIndex - 1];
      edgeList.push(blockEdge(previousRoot.nodeId, root.nodeId, root.lineStyle || defaultLine, null, false));
    }
    subtreeEdges(root, edgeList);
    if (edgeList.length) edgeGroups.push(edgeList);
  });
  for (const edgeList of edgeGroups) out.push('', ...edgeList);

  const styles = styleLines(nodes);
  if (styles.length) out.push('', ...styles);
  return out.join('\n');
}

/** fishBone (chapter 7). */
function generateFishBone(roots: TreeNode[]): string {
  const out = ['ishikawa-beta'];
  for (const node of walkDepthFirst(roots)) out.push(' '.repeat(2 * node.level) + node.text);
  return out.join('\n');
}

/** pie (8.1). */
function generatePie(roots: TreeNode[], diag: Diagnostics): string {
  const root = roots[0];
  const slices = root.children.map((child) => {
    const [name, value] = parsePieText(child.text)!;
    return { name, value, color: child.color };
  });
  if (slices.length >= 13) {
    diag.warn(`pie: スライスが${slices.length}個ある（Mermaidのテーマ変数は pie1〜pie12 まで）。`
      + '13個目以降の色指定は無視する');
  }
  const themeItems: string[] = [];
  slices.slice(0, 12).forEach((slice, sliceIndex) => {
    if (slice.color) themeItems.push(`"pie${sliceIndex + 1}":"${slice.color}"`);
  });
  themeItems.push('"pieOpacity":1');
  const out = ['%%{init: {"theme":"base","themeVariables":{'];
  themeItems.forEach((item, itemIndex) => {
    out.push('  ' + item + (itemIndex < themeItems.length - 1 ? ',' : ''));
  });
  out.push('}}}%%');
  out.push('pie showData');
  out.push(`title ${root.text}`);
  for (const slice of slices) out.push(`"${quoteText(slice.name)}" : ${slice.value}`);
  return out.join('\n');
}

/** venn (8.2). */
function generateVenn(roots: TreeNode[]): string {
  const level2Sets = ['N1,N2', 'N1,N3', 'N2,N3'];
  const out = ['venn-beta'];
  const styles: string[] = [];
  let level1Count = 0;
  let level2Count = 0;
  for (const node of walkDepthFirst(roots)) {
    const [name, value] = parseVennText(node.text);
    const valuePart = value !== null ? `:${value}` : '';
    let region: string;
    if (node.level === 1) {
      level1Count += 1;
      region = `N${level1Count}`;
      out.push(`  set ${region}["${quoteText(name)}"]${valuePart}`);
    } else {
      if (node.level === 2) {
        level2Count += 1;
        region = level2Sets[level2Count - 1];
      } else {
        region = 'N1,N2,N3';
      }
      out.push(`  union ${region}["${quoteText(name)}"]${valuePart}`);
    }
    if (node.color) styles.push(`  style ${region} fill:${node.color}`);
  }
  if (styles.length) out.push('', ...styles);
  return out.join('\n');
}

/** table family (8.3). */
function generateTable(tableRoots: TreeNode[], typeId: string): string {
  const suffix = typeId.slice('table'.length);
  const boldColumn = /^[0-9]/.test(suffix) ? parseInt(suffix[0], 10) : null;
  const isCentered = suffix.endsWith('c');

  const rows: string[][] = [];
  for (const root of tableRoots) {
    const cells = [root.text, ...root.children.map(child => child.text)]
      // 8.3.0 Empty cell replacement
      .map(cell => (cell.replace(/[ \t]/g, '') === '' ? fullWidthSpace : cell));
    rows.push(cells);
  }

  const columnWidths: number[] = [];
  for (const cells of rows) {
    cells.forEach((cell, columnIndex) => {
      columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, displayWidth(cell));
    });
  }

  const out = ['@startsalt', '{#'];
  rows.forEach((cells, rowIndex) => {
    const cellTexts = cells.map((cell, columnIndex) => {
      let cellText = cell;
      // 8.3.1 Bold
      if (boldColumn !== null && (rowIndex === 0 || columnIndex + 1 === boldColumn)) {
        cellText = `<b>${cellText}</b>`;
      }
      // 8.3.2 Centering
      if (isCentered) {
        const padWidth = columnWidths[columnIndex] - displayWidth(cell);
        const spaceCount = Math.floor(padWidth / 2);
        const leftCount = Math.floor(spaceCount / 2);
        let rightCount = spaceCount - leftCount;
        if (columnIndex === cells.length - 1) rightCount = 0;
        cellText = fullWidthSpace.repeat(leftCount) + cellText + fullWidthSpace.repeat(rightCount);
      }
      return cellText;
    });
    out.push('| ' + cellTexts.join(' | '));
  });
  out.push('}', '@endsalt');
  return out.join('\n');
}

/** quadrant (chapter 9). */
function generateQuadrant(roots: TreeNode[]): string {
  const [firstRoot, secondRoot] = roots;
  const quadrantOf = new Map<string, number>([
    [firstRoot.children[0].nodeId, 3],
    [firstRoot.children[1].nodeId, 2],
    [secondRoot.children[0].nodeId, 4],
    [secondRoot.children[1].nodeId, 1],
  ]);
  const level2Nodes = [...firstRoot.children, ...secondRoot.children];

  const fills = new Map<number, string>();
  for (const node of level2Nodes) {
    if (node.color) fills.set(quadrantOf.get(node.nodeId)!, node.color);
  }
  const out: string[] = [];
  if (fills.size) {
    out.push('---', 'config:', '  themeVariables:');
    for (let quadrantNo = 1; quadrantNo <= 4; quadrantNo++) {
      if (fills.has(quadrantNo)) out.push(`    quadrant${quadrantNo}Fill: "${fills.get(quadrantNo)}"`);
    }
    out.push('---');
  }

  out.push('quadrantChart');
  out.push(`  x-axis "${quoteText(firstRoot.text)}" --> "${quoteText(secondRoot.text)}"`);
  out.push(`  y-axis "${quoteText(firstRoot.children[0].text)}" --> "${quoteText(firstRoot.children[1].text)}"`);

  const labels = new Map<number, string>();
  for (const node of level2Nodes) labels.set(quadrantOf.get(node.nodeId)!, node.children[0].text);
  for (let quadrantNo = 1; quadrantNo <= 4; quadrantNo++) {
    out.push(`  quadrant-${quadrantNo} "${quoteText(labels.get(quadrantNo)!)}"`);
  }

  roots.forEach((root, rootIndex) => {
    const xValue = rootIndex === 0 ? 25 : 75;
    root.children.forEach((level2Node, childIndex) => {
      const baseY = childIndex === 0 ? 40 : 90;
      level2Node.children.slice(1).forEach((pointNode, pointIndex) => {
        const yValue = baseY - 5 * pointIndex;
        out.push(`  "${quoteText(pointNode.text)}": `
          + `[${formatCoordinate(xValue)}, ${formatCoordinate(yValue)}] radius:0`);
      });
    });
  });
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Port of the CLI driver (`run`)
// ---------------------------------------------------------------------------

export interface HeadingDiagramBlock {
  /** Type actually generated (hier-mind may become hier-mindlabel). */
  typeId: string;
  language: 'mermaid' | 'plantuml';
  /** `## type (--option value ...)` line the CLI prints above the block. */
  heading: string;
  /** Diagram source (the content of the fenced block). */
  body: string;
}

export interface HeadingDiagramRun {
  /** 0 on success, 1 on input error (same as the CLI's exit status). */
  exitCode: number;
  blocks: HeadingDiagramBlock[];
  /** Exactly what the CLI writes to stdout / the `-o` file ('' on failure). */
  outputText: string;
  warnings: string[];
  errors: string[];
  /** stderr lines (`warning: ...` / `error: ...`) in emission order. */
  log: string[];
}

function makeHeading(typeId: string, explicitOptions: ExplicitHeadingOptions): string {
  const optionParts: string[] = [];
  for (const optionName of meaningfulOptions[typeId] ?? []) {
    if (explicitOptions[optionName] !== undefined) {
      optionParts.push(`${optionFlags[optionName]} ${explicitOptions[optionName]}`);
    }
  }
  let heading = `## ${typeId}`;
  if (optionParts.length) heading += ' (' + optionParts.join(' ') + ')';
  return heading;
}

/**
 * Port of `run()`.
 * @param sourceText heading-format input
 * @param types diagram type ids (`-t`); null/undefined = generate every type whose condition holds
 * @param explicitOptions options given explicitly (`--direction` etc.)
 */
export function runHeading2Diagram(
  sourceText: string,
  types?: readonly string[] | null,
  explicitOptions: ExplicitHeadingOptions = {},
): HeadingDiagramRun {
  const diag = new Diagnostics();
  const finish = (exitCode: number, blocks: HeadingDiagramBlock[] = []): HeadingDiagramRun => ({
    exitCode,
    blocks,
    outputText: exitCode === 0
      ? blocks.map(b => [b.heading, '```' + b.language, b.body, '```'].join('\n')).join('\n\n') + '\n'
      : '',
    warnings: diag.warnings,
    errors: diag.errors,
    log: diag.log,
  });

  const explicit: ExplicitHeadingOptions = {};
  const options = { ...defaultHeadingOptions };
  for (const optionName of optionOrder) {
    const value = explicitOptions[optionName];
    if (value !== undefined && value !== null) {
      explicit[optionName] = value;
      options[optionName] = value;
    }
  }

  let text = sourceText;
  if (text.startsWith('\ufeff')) text = text.slice(1);

  const entries = parseInput(text, diag);
  if (!entries.some(entry => entry.text !== '')) {
    diag.error('有効な見出し行（テキストが空でない見出し行）が1行も無い');
    return finish(1);
  }

  // Decide what to generate
  const isExplicit = types !== null && types !== undefined;
  let targets: string[] = [];
  if (isExplicit) {
    for (const typeId of types) {
      if (!targets.includes(typeId)) targets.push(typeId);
    }
  }

  const needsMainTree = !isExplicit || targets.some(t => !tableTypeIds.includes(t));
  const needsTableTree = !isExplicit || targets.some(t => tableTypeIds.includes(t));

  let mainRoots: TreeNode[] = [];
  let tableRoots: TreeNode[] = [];
  if (needsMainTree) {
    for (const entry of entries) {
      if (entry.text === '') {
        diag.warn(`${entry.lineNo}行目: 内容（テキスト）が空の見出し行である。`
          + 'table系以外の図種では無視し、table系では空セルとして扱う');
      }
    }
    mainRoots = buildTree(entries, false, diag);
  }
  if (needsTableTree) tableRoots = buildTree(entries, true, diag);

  const hasLabel = walkDepthFirst(mainRoots).some(node => node.label);
  if (!isExplicit) {
    targets = [hasLabel ? 'hier-mindlabel' : 'hier-mind', 'hier-block', 'hier-flow',
      'fishBone', 'pie', 'venn', 'table', 'struct-flow', 'quadrant'];
  }

  // Input conditions
  const validTargets: string[] = [];
  let hasError = false;
  for (const typeId of targets) {
    const reason = checkCondition(typeId, mainRoots, tableRoots);
    if (reason === null) {
      validTargets.push(typeId);
    } else if (isExplicit) {
      diag.error(`図種 ${typeId} の入力条件を満たさない: ${reason}`);
      hasError = true;
    } else {
      diag.warn(`図種 ${typeId} の入力条件を満たさないためスキップする: ${reason}`);
    }
  }
  if (hasError) return finish(1);
  if (!validTargets.length) {
    diag.error('生成できた図種が1つも無い');
    return finish(1);
  }

  // Generate
  const blocks: HeadingDiagramBlock[] = [];
  for (const typeId of validTargets) {
    let outputTypeId = typeId;
    if (typeId === 'hier-mind' && hasLabel) {
      diag.warn('hier-mind: 入力にラベル（|x|）が含まれるため、hier-mindlabel として生成する');
      outputTypeId = 'hier-mindlabel';
    }

    let body: string;
    if (outputTypeId === 'hier-mind' || outputTypeId === 'hier-mindlabel') {
      body = generateMindmap(mainRoots, options, outputTypeId === 'hier-mindlabel', outputTypeId, diag);
    } else if (typeId === 'hier-flow') {
      body = generateFlowchart(mainRoots, options);
    } else if (typeId === 'hier-block') {
      body = generateHierBlock(mainRoots, options);
    } else if (typeId === 'struct-flow') {
      body = generateStructFlow(mainRoots, options);
    } else if (typeId === 'fishBone') {
      body = generateFishBone(mainRoots);
    } else if (typeId === 'pie') {
      body = generatePie(mainRoots, diag);
    } else if (typeId === 'venn') {
      body = generateVenn(mainRoots);
    } else if (tableTypeIds.includes(typeId)) {
      body = generateTable(tableRoots, typeId);
    } else {
      body = generateQuadrant(mainRoots);
    }

    blocks.push({
      typeId: outputTypeId,
      language: plantumlTypeIds.has(outputTypeId) ? 'plantuml' : 'mermaid',
      heading: makeHeading(outputTypeId, explicit),
      body,
    });
  }

  return finish(0, blocks);
}

// ---------------------------------------------------------------------------
// Editor-facing API
// ---------------------------------------------------------------------------

/** Fence language that marks a heading-format block in a Markdown document. */
export const HEADING_FENCE_LANGUAGE = 'heading2diagram';

/** Type used when a block does not name one. */
export const DEFAULT_HEADING_TYPE: HeadingTypeId = 'hier-flow';

/** Types whose output Mermaid can render (everything else is PlantUML). */
export const mermaidHeadingTypeIds: readonly string[] = typeIdList.filter(id => !plantumlTypeIds.has(id));

export const DEFAULT_HEADING_SOURCE = [
  '# 会議の準備',
  '## 議題の確定',
  '## 資料作成',
  '### 前回議事録',
  '### 実績データ',
  '## 会場手配',
].join('\n');

const hierarchySample = [
  '# サブ;会議の準備',
  '## 議題の確定',
  '## スタ;資料作成:#FAF',
  '### 前回議事録',
  '### 実績データ',
  '## 六角;会場手配:#0FF',
  '### |参加者確定|実線矢印;日程調整',
  '### |会場確定|実線矢印;備品確認',
].join('\n');
const tableSample = ['# 区分', '## 名称', '## 備考', '# Ａ', '## りんご', '## 胃腸によい', '# Ｂ', '## みかん', '## 冬'].join('\n');

/** A small input that satisfies the type's condition (from the reference repository's examples). */
export function headingSampleFor(typeId: string): string {
  if (tableTypeIds.includes(typeId)) return tableSample;
  switch (typeId) {
    case 'fishBone':
      return ['# 図表作成が容易', '## 環境構築が容易', '### 標準仕様', '### 低コスト',
        '## 操作が容易', '### 直感的', '### 構造がわかりやすい'].join('\n');
    case 'pie':
      return ['# 作業時間の内訳', '## 資料作成:60:#aff', '## 会場手配:40:#afa', '## 日程調整:30:#ffa', '## 議題の確定:15:#faa'].join('\n');
    case 'venn':
      return ['# 紙:30:#f88', '# 電子:20:#88f', '## 紙と電子:10', '# 音声:#5f5',
        '## 紙と音声:5', '## 電子と音声:5', '### 三つとも'].join('\n');
    case 'quadrant':
      return ['# 費用が低い', '## 効果が小さい:#fee', '### 見送り', '### 現状維持', '## 効果が大きい:#efe', '### 優先実施', '### 試行導入',
        '# 費用が高い', '## 効果が小さい:#fef', '### 中止', '### 縮小', '## 効果が大きい:#eff', '### 段階導入', '### フェーズ展開'].join('\n');
    default:
      return hierarchySample;
  }
}

export const isHeadingTypeId = (value: unknown): value is HeadingTypeId =>
  typeof value === 'string' && (typeIdList as readonly string[]).includes(value);

export interface HeadingInfo {
  typeId: HeadingTypeId;
  options: ExplicitHeadingOptions;
  /** Tokens that could not be understood (unknown type / option / value). */
  problems: string[];
}

/**
 * Parses the part of a fence info string that follows `heading2diagram`,
 * e.g. `hier-flow --direction LR --layout tight`. The syntax follows the CLI
 * (`-t TYPE` is accepted too); unknown tokens are reported, never fatal.
 */
export function parseHeadingInfo(info: string | null | undefined): HeadingInfo {
  const tokens = (info ?? '').trim().split(/\s+/).filter(Boolean);
  const options: ExplicitHeadingOptions = {};
  const problems: string[] = [];
  let typeId: HeadingTypeId | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-t' || token === '--type') {
      const value = tokens[++i];
      if (isHeadingTypeId(value)) typeId = value;
      else problems.push(`${token} ${value ?? ''}`.trim());
    } else if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = (eq >= 0 ? token.slice(2, eq) : token.slice(2)) as HeadingOptionName;
      const value = eq >= 0 ? token.slice(eq + 1) : tokens[++i];
      if (optionOrder.includes(name) && value !== undefined && optionChoices[name].includes(value)) {
        options[name] = value;
      } else {
        problems.push(`--${name} ${value ?? ''}`.trim());
      }
    } else if (typeId === null && isHeadingTypeId(token)) {
      typeId = token;
    } else {
      problems.push(token);
    }
  }
  return { typeId: typeId ?? DEFAULT_HEADING_TYPE, options, problems };
}

/** Inverse of `parseHeadingInfo`. Options equal to the default, or meaningless for the type, are dropped. */
export function buildHeadingInfo(typeId: string, options: ExplicitHeadingOptions = {}): string {
  const parts = [typeId];
  for (const name of meaningfulOptions[typeId] ?? []) {
    const value = options[name];
    if (value && value !== defaultHeadingOptions[name] && optionChoices[name].includes(value)) {
      parts.push(`${optionFlags[name]} ${value}`);
    }
  }
  return parts.join(' ');
}

/** `key value` option string stored on the editor node (`--direction LR --layout tight`). */
export function buildHeadingOptionString(typeId: string, options: ExplicitHeadingOptions = {}): string {
  return buildHeadingInfo(typeId, options).slice(typeId.length).trim();
}

export interface HeadingConversion {
  ok: boolean;
  /** Type actually generated. */
  typeId: string;
  language: 'mermaid' | 'plantuml';
  /** Generated diagram source ('' when `ok` is false). */
  code: string;
  warnings: string[];
  error: string | null;
}

/** Converts one heading-format block for the editor. */
export function convertHeadingBlock(
  source: string,
  typeId: string | null | undefined,
  options: ExplicitHeadingOptions | string | null | undefined = {},
): HeadingConversion {
  const requested = isHeadingTypeId(typeId) ? typeId : DEFAULT_HEADING_TYPE;
  const explicit = typeof options === 'string' ? parseHeadingInfo(`${requested} ${options}`).options : (options ?? {});
  const result = runHeading2Diagram(source, [requested], explicit);
  const block = result.blocks[0];
  if (result.exitCode !== 0 || !block) {
    return {
      ok: false,
      typeId: requested,
      language: plantumlTypeIds.has(requested) ? 'plantuml' : 'mermaid',
      code: '',
      warnings: result.warnings,
      error: result.errors.join('\n') || 'heading2diagram: conversion failed',
    };
  }
  return { ok: true, typeId: block.typeId, language: block.language, code: block.body, warnings: result.warnings, error: null };
}

/** Types whose input condition the given source satisfies (drives the type picker). */
export function validHeadingTypes(source: string): string[] {
  return typeIdList.filter(typeId => runHeading2Diagram(source, [typeId]).exitCode === 0);
}

// ---------------------------------------------------------------------------
// Gallery (compare the same source under several types / options)
// ---------------------------------------------------------------------------

export interface HeadingGalleryItem {
  /** Stable key for list rendering. */
  key: string;
  /** `type`: one card per diagram type; `option`: one value of one option changed. */
  group: 'type' | 'option';
  /** For `option` cards, the option that differs from the current settings. */
  optionName: HeadingOptionName | null;
  /** Type the card applies when chosen. */
  typeId: string;
  /** Options the card applies when chosen (defaults omitted). */
  options: ExplicitHeadingOptions;
  /** Short caption (`hier-block`, `LR`, `tight`, ...). */
  label: string;
  /** Equals the settings currently being edited. */
  current: boolean;
  conversion: HeadingConversion;
}

/** Drops values that equal the default or do not apply to the type. */
function normaliseHeadingOptions(typeId: string, options: ExplicitHeadingOptions): ExplicitHeadingOptions {
  const result: ExplicitHeadingOptions = {};
  for (const name of meaningfulOptions[typeId] ?? []) {
    const value = options[name];
    if (value !== undefined && value !== defaultHeadingOptions[name] && optionChoices[name].includes(value)) {
      result[name] = value;
    }
  }
  return result;
}

const sameOptions = (a: ExplicitHeadingOptions, b: ExplicitHeadingOptions): boolean =>
  optionOrder.every(name => a[name] === b[name]);

/**
 * Builds the cards of the comparison gallery for one heading-format source:
 *
 * - `type` cards: every type whose input condition the source satisfies,
 *   using the current options where they apply (what the CLI prints when run
 *   without `-t`, plus the table variants). `hier-mind` is left out when the
 *   source has labels, because it would be generated as `hier-mindlabel`.
 * - `option` cards: for the current type, each value of each option it
 *   understands, changing that single option and keeping the others.
 */
export function buildHeadingGallery(
  source: string,
  currentType: string,
  currentOptions: ExplicitHeadingOptions = {},
): HeadingGalleryItem[] {
  const items: HeadingGalleryItem[] = [];
  const current = normaliseHeadingOptions(currentType, currentOptions);

  for (const typeId of typeIdList) {
    const options = normaliseHeadingOptions(typeId, currentOptions);
    const conversion = convertHeadingBlock(source, typeId, options);
    if (!conversion.ok || conversion.typeId !== typeId) continue;
    items.push({
      key: `type:${typeId}`,
      group: 'type',
      optionName: null,
      typeId,
      options,
      label: typeId,
      current: typeId === currentType && sameOptions(options, current),
      conversion,
    });
  }

  if (isHeadingTypeId(currentType)) {
    for (const optionName of meaningfulOptions[currentType] ?? []) {
      for (const value of optionChoices[optionName]) {
        const options = normaliseHeadingOptions(currentType, { ...current, [optionName]: value });
        items.push({
          key: `option:${optionName}:${value}`,
          group: 'option',
          optionName,
          typeId: currentType,
          options,
          label: value,
          current: sameOptions(options, current),
          conversion: convertHeadingBlock(source, currentType, options),
        });
      }
    }
  }
  return items;
}
