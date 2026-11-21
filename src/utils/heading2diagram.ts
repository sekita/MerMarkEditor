/**
 * heading2diagram — TypeScript port of heading2diagram.py (v1.1.0)
 * https://github.com/sekita/heading2diagram
 * MIT License, Copyright (c) 2026 heading2diagram contributors
 *
 * Converts "heading format" text (Markdown-like `#` headings that describe a
 * tree) into Mermaid (flowchart / block / ishikawa / pie / venn /
 * quadrantChart) or PlantUML (mindmap / salt) diagram source.
 *
 * `runHeading2Diagram` is a line-for-line port of the CLI's `run()` and is
 * kept byte-compatible with the Python reference outputs (see
 * `__tests__/utils/heading2diagram.test.ts`). Diagnostic messages are kept
 * exactly as the original program prints them.
 *
 * The second half of the file (`parseHeadingInfo`, `convertHeadingBlock`, …)
 * is the editor-facing API used by the Mermaid node.
 */

// ---------------------------------------------------------------------------
// Constants (diagram types, options, notation tables)
// ---------------------------------------------------------------------------

export const typeIdList = [
  'hier-mind', 'hier-mindlabel', 'hier-block', 'hier-flow', 'fishBone', 'pie', 'venn',
  'table', 'tablec', 'table1', 'table1c', 'table2', 'table2c', 'table3', 'table3c',
  'struct-flow', 'quadrant', 'star',
] as const;
export type HeadingTypeId = (typeof typeIdList)[number];

export const tableTypeIds: readonly string[] = [
  'table', 'tablec', 'table1', 'table1c', 'table2', 'table2c', 'table3', 'table3c',
];
/** Types generated when the CLI is run without `-t`. */
export const defaultTypeIds: readonly string[] = [
  'hier-mind', 'hier-block', 'hier-flow', 'fishBone', 'pie', 'venn', 'table',
  'struct-flow', 'quadrant', 'star',
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

/** Options whose value is one of a fixed list. */
export type ChoiceHeadingOptionName = 'direction' | 'layout' | 'line' | 'arrowDirection' | 'curve';
/** Numeric options of `star` (v1.1.0). */
export type NumericHeadingOptionName = 'degree' | 'span' | 'radius' | 'blockWidth';
export type HeadingOptionName = ChoiceHeadingOptionName | NumericHeadingOptionName;
export type HeadingOptions = Record<HeadingOptionName, string>;
export type ExplicitHeadingOptions = Partial<HeadingOptions>;

/** Every option, in the order the CLI defines them. */
export const optionOrder: readonly HeadingOptionName[] = [
  'direction', 'layout', 'line', 'arrowDirection', 'curve', 'degree', 'span', 'radius', 'blockWidth',
];
export const numericOptionNames: readonly NumericHeadingOptionName[] = ['degree', 'span', 'radius', 'blockWidth'];
export const isNumericHeadingOption = (name: string): name is NumericHeadingOptionName =>
  (numericOptionNames as readonly string[]).includes(name);

/**
 * Values offered by the editor for each option. For the choice options this
 * is the full list the CLI accepts; for the numeric `star` options it is a
 * set of presets (any valid number is accepted, see `isValidHeadingOptionValue`).
 * `radius` and `blockWidth` depend on the content, so they have no presets.
 */
export const optionChoices: Record<HeadingOptionName, readonly string[]> = {
  direction: directionChoices,
  layout: layoutChoices,
  line: lineChoices,
  arrowDirection: arrowDirectionChoices,
  curve: curveChoices,
  degree: ['0', '30', '45', '90'],
  span: ['1', '2', '4', '8'],
  radius: [],
  blockWidth: [],
};
/** Effective defaults. '' means "automatic" (radius / blockWidth). */
export const defaultHeadingOptions: HeadingOptions = {
  direction: 'TB', layout: 'normal', line: 'solid', arrowDirection: 'default', curve: 'default',
  degree: '0', span: '4', radius: '', blockWidth: '',
};
const optionFlags: Record<HeadingOptionName, string> = {
  direction: '--direction', layout: '--layout', line: '--line',
  arrowDirection: '--arrowDirection', curve: '--curve',
  degree: '--degree', span: '--span', radius: '--radius', blockWidth: '--blockWidth',
};
/** Options that appear in the output heading line (per diagram type, in this order). */
export const meaningfulOptions: Record<string, readonly HeadingOptionName[]> = {
  'hier-mind': ['direction', 'layout', 'line'],
  'hier-mindlabel': ['direction', 'layout', 'line'],
  'hier-block': ['direction', 'layout', 'line', 'arrowDirection'],
  'hier-flow': ['direction', 'layout', 'line', 'arrowDirection', 'curve'],
  'struct-flow': ['layout', 'line'],
  star: ['layout', 'line', 'arrowDirection', 'degree', 'span', 'radius', 'blockWidth'],
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

/** Mermaid shape notation (opening mark, closing mark). */
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

// star constants (10.9.1)
const wideCharWidth = 16;
const narrowCharWidth = 9;
const blockPaddingX = 30;
const blockHeight = 40;
const labelPaddingX = 8;
const labelHeight = 24;
const angleWeight = 2.0;
const sizePenalty = 0.5;
const searchRange = 1.5;

/** star values per --layout (10.9.2): [minLineLength, labelMargin, minBlockGap, cellGap]. */
const starLayoutValues: Record<string, [number, number, number, number]> = {
  tight: [15, 8, 8, 8],
  normal: [30, 16, 16, 8],
  spacyX: [60, 32, 32, 8],
  spacyY: [60, 32, 32, 8],
  spacyXY: [60, 32, 32, 8],
  spacyPadding: [30, 16, 16, 30],
};

const blockPaddingFrontmatter = ['---', 'config:', '  block:', '    padding: 30', '---'];

const fullWidthSpace = '　';

// Python's `str.isspace` set: `\s`/`\S` and `str.strip()` in the reference
// program use it, and it differs slightly from JavaScript's `\s`.
const pyWhitespace = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const pyWhitespaceRe = new RegExp(`[${pyWhitespace}]`);

const headingRe = /^(#+)(?:[ \t]+([\s\S]*))?$/;
const headingTypoRe = /^#+[^ \t#]/;
const colorRe = /:#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/;
const colorTypoRe = new RegExp(`:#[^${pyWhitespace}]*$`);
const modifierRe = /^([^ \t;]*);/;
const numberRe = /^[0-9]+(\.[0-9]+)?$/;

// ---------------------------------------------------------------------------
// Small helpers mirroring Python semantics
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

/** `text.strip(' \t')`: removes half-width spaces and tabs only. */
const stripBlank = (text: string): string => stripLeft(stripRight(text));

/** `text.strip()` with no argument (every Unicode whitespace character). */
function pyStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && pyWhitespaceRe.test(text[start])) start++;
  while (end > start && pyWhitespaceRe.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Python's `%` for floats (the result takes the sign of the divisor). */
function pyMod(value: number, divisor: number): number {
  let mod = value % divisor;
  if (mod) {
    if ((divisor < 0) !== (mod < 0)) mod += divisor;
  } else {
    mod = divisor < 0 ? -0 : 0;
  }
  return mod;
}

/** Splits `a` into high and low halves (Dekker) for exact products. */
function splitDouble(a: number): [number, number] {
  const c = 134217729 * a; // 2^27 + 1
  const high = c - (c - a);
  return [high, a - high];
}

/** Exact product `a * b` as an unevaluated sum [product, error]. */
function twoProduct(a: number, b: number): [number, number] {
  const product = a * b;
  const [aHigh, aLow] = splitDouble(a);
  const [bHigh, bLow] = splitDouble(b);
  const error = ((aHigh * bHigh - product) + aHigh * bLow + aLow * bHigh) + aLow * bLow;
  return [product, error];
}

/**
 * `math.hypot(x, y)`. CPython computes it (almost always) correctly rounded;
 * `Math.hypot` may be 1 ulp off, so the sum of squares is kept exact and one
 * corrected Newton step is applied, as CPython does.
 */
function pyHypot(x: number, y: number): number {
  x = Math.abs(x);
  y = Math.abs(y);
  if (x === 0) return y;
  if (y === 0) return x;
  const [xx, xxError] = twoProduct(x, x);
  const [yy, yyError] = twoProduct(y, y);
  const sum = xx + yy;
  const virtual = sum - xx;
  const sumError = (xx - (sum - virtual)) + (yy - virtual);
  const low = sumError + xxError + yyError;
  let root = Math.sqrt(sum + low);
  const [square, squareError] = twoProduct(root, root);
  const residual = ((sum - square) - squareError) + low;
  root += residual / (2 * root);
  return root;
}

/** `sum()` of floats (Python 3.12+ uses Neumaier's compensated summation). */
function pySum(values: number[]): number {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    if (Math.abs(total) >= Math.abs(value)) compensation += (total - next) + value;
    else compensation += (value - next) + total;
    total = next;
  }
  return total + compensation;
}

const degToRad = Math.PI / 180;
const radToDeg = 180 / Math.PI;

/** Python `repr()` of a string (used in argparse-style messages). */
function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let body = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') body += '\\\\';
    else if (ch === quote) body += '\\' + ch;
    else if (ch === '\n') body += '\\n';
    else if (ch === '\r') body += '\\r';
    else if (ch === '\t') body += '\\t';
    else if (code < 0x20 || code === 0x7f) body += '\\x' + code.toString(16).padStart(2, '0');
    else body += ch;
  }
  return quote + body + quote;
}

/** Python `format(value, 'g')`. */
function formatG(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : (value > 0 ? 'inf' : '-inf');
  const exponential = value.toExponential(5);
  const exponent = Number(exponential.slice(exponential.indexOf('e') + 1));
  const trimZeros = (text: string): string => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);
  if (exponent < -4 || exponent >= 6) {
    const mantissa = trimZeros(exponential.slice(0, exponential.indexOf('e')));
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return trimZeros(value.toFixed(5 - exponent));
}

/** Replaces Unicode decimal digits (e.g. full-width `３`) with ASCII ones, as Python's int()/float() accept them. */
function asciiDigits(text: string): string {
  let result = '';
  for (const ch of text) {
    if (/\p{Nd}/u.test(ch) && !/[0-9]/.test(ch)) {
      // Decimal digit blocks are runs of whole 0-9 sequences.
      let start = ch.codePointAt(0)!;
      while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
      result += String((ch.codePointAt(0)! - start) % 10);
    } else {
      result += ch;
    }
  }
  return result;
}

const pyFloatRe = /^[+-]?(?:(?:[0-9](?:_?[0-9])*)?\.[0-9](?:_?[0-9])*|[0-9](?:_?[0-9])*\.?)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const pyIntRe = /^[+-]?[0-9](?:_?[0-9])*$/;

/** `parseFiniteFloat()`: float(text) when it is finite, otherwise null. */
export function parseFiniteFloat(text: string): number | null {
  const stripped = asciiDigits(pyStrip(text));
  if (!pyFloatRe.test(stripped)) return null;
  const value = Number(stripped.replace(/_/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** int(text), or null when Python would raise ValueError. */
function parsePyInt(text: string): number | null {
  const stripped = asciiDigits(pyStrip(text));
  if (!pyIntRe.test(stripped)) return null;
  return Number(stripped.replace(/_/g, ''));
}

/**
 * Validates one numeric option the way the CLI does. Returns the parsed value,
 * or the argparse error text (without the `argument --x: ` prefix).
 */
function parseNumericOption(name: NumericHeadingOptionName, text: string): { value: number } | { error: string } {
  if (name === 'degree') {
    const value = parseFiniteFloat(text);
    return value === null ? { error: `数値でない値である: ${pyRepr(text)}` } : { value };
  }
  if (name === 'span') {
    const value = parsePyInt(text);
    return value === null || value < 1 ? { error: `1以上の整数を指定すること: ${pyRepr(text)}` } : { value };
  }
  const value = parseFiniteFloat(text);
  return value === null || value <= 0 ? { error: `正の数を指定すること: ${pyRepr(text)}` } : { value };
}

/** True when the CLI accepts `value` for the option. */
export function isValidHeadingOptionValue(name: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (isNumericHeadingOption(name)) return 'value' in parseNumericOption(name, value);
  return (optionOrder as readonly string[]).includes(name)
    && (optionChoices[name as HeadingOptionName] as readonly string[]).includes(value);
}

/** True when the value has the same effect as leaving the option out. */
function isDefaultOptionValue(name: HeadingOptionName, value: string): boolean {
  if (value === defaultHeadingOptions[name]) return true;
  if (name === 'degree') return parseFiniteFloat(value) === 0;
  if (name === 'span') return parsePyInt(value) === 4;
  return false;
}

// ---------------------------------------------------------------------------
// Warnings / errors
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

/** Input condition violation of a diagram type (4.4). */
class ConditionError extends Error {}

// ---------------------------------------------------------------------------
// Input parsing (4.1)
// ---------------------------------------------------------------------------

/** Parsed content of one heading line. */
interface ContentInfo {
  label: string | null;
  lineType: string | null;
  shape: string | null;
  text: string;
  color: string | null;
}

/** One heading line. */
interface HeadingRecord {
  lineNo: number;
  level: number;
  info: ContentInfo;
}

const emptyContent = (): ContentInfo => ({ label: null, lineType: null, shape: null, text: '', color: null });

/** Splits heading content into label / colour / modifiers / text. */
function parseContent(content: string, lineNo: number, diag: Diagnostics): ContentInfo {
  const info = emptyContent();
  let rest = stripBlank(content);

  // 1. Label
  if (rest.startsWith('|')) {
    const closeIndex = rest.indexOf('|', 1);
    if (closeIndex < 0) {
      diag.warn(`line ${lineNo}: ラベルの閉じ "|" が無い。先頭の "|" を含めて内容全体をテキストとして扱う`);
      info.text = rest;
      return info;
    }
    const labelText = stripBlank(rest.slice(1, closeIndex));
    rest = stripBlank(rest.slice(closeIndex + 1));
    if (labelText === '') {
      diag.warn(`line ${lineNo}: ラベルが空である。ラベル無しとして扱う`);
    } else {
      info.label = labelText;
    }
  }

  // 2. Colour
  const colorMatch = colorRe.exec(rest);
  if (colorMatch) {
    info.color = '#' + colorMatch[1];
    rest = rest.slice(0, colorMatch.index);
  } else if (colorTypoRe.test(rest)) {
    diag.warn(`line ${lineNo}: ":#" の後が16進3桁・6桁でない（色の書き間違いの可能性）。テキストの一部として扱う`);
  }

  // 3. Modifiers (line style name / shape name)
  for (let attempt = 0; attempt < 2; attempt++) {
    const modifierMatch = modifierRe.exec(rest);
    if (!modifierMatch) break;
    const name = modifierMatch[1];
    if (lineStyleNames.has(name)) {
      if (info.lineType !== null) {
        diag.warn(`line ${lineNo}: 線種名 "${name}" が重複している。テキストの一部として扱う`);
        break;
      }
      info.lineType = lineStyleNames.get(name)!;
    } else if (shapeNames.has(name)) {
      if (info.shape !== null) {
        diag.warn(`line ${lineNo}: 形状名 "${name}" が重複している。テキストの一部として扱う`);
        break;
      }
      info.shape = shapeNames.get(name)!;
    } else {
      diag.warn(`line ${lineNo}: "${name};" は未知の線種名・形状名である（書き間違いの可能性）。テキストの一部として扱う`);
      break;
    }
    rest = stripLeft(rest.slice(modifierMatch[0].length));
  }

  // 4. Text
  info.text = stripBlank(rest);
  return info;
}

/** Parses every input line and returns the heading lines. */
function parseLines(lines: string[], diag: Diagnostics): HeadingRecord[] {
  const records: HeadingRecord[] = [];
  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.replace(/[\r\n]+$/, '');
    const headingMatch = headingRe.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const info = content === undefined || stripBlank(content) === ''
        ? emptyContent()
        : parseContent(content, lineNo, diag);
      records.push({ lineNo, level, info });
    } else if (pyStrip(line) === '') {
      // blank line
    } else if (headingTypoRe.test(line)) {
      diag.warn(`line ${lineNo}: "#" の直後に空白が無い（見出し行の書き間違いの可能性）。無視する`);
    } else {
      diag.warn(`line ${lineNo}: 見出し行でも空行でもない行である。無視する`);
    }
  });
  return records;
}

// ---------------------------------------------------------------------------
// Tree (4.2, 5.1)
// ---------------------------------------------------------------------------

/** A node of the tree. */
interface TreeNode {
  label: string | null;
  lineType: string | null;
  shape: string | null;
  text: string;
  color: string | null;
  level: number;
  lineNo: number;
  children: TreeNode[];
  parent: TreeNode | null;
  nodeId: string;
}

/** A forest of nodes (there may be several roots). */
class Tree {
  constructor(readonly roots: TreeNode[]) {}

  /** Every node depth-first (in order of appearance). */
  allNodes(): TreeNode[] {
    const result: TreeNode[] = [];
    const stack = [...this.roots].reverse();
    while (stack.length) {
      const node = stack.pop()!;
      result.push(node);
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    return result;
  }

  maxLevel(): number {
    return this.allNodes().reduce((max, node) => Math.max(max, node.level), 0);
  }

  nodesAtLevel(level: number): TreeNode[] {
    return this.allNodes().filter(node => node.level === level);
  }
}

function assignIds(nodes: TreeNode[], prefix: string): void {
  nodes.forEach((node, index) => {
    node.nodeId = prefix === 'N' ? `${prefix}${index + 1}` : `${prefix}_${index + 1}`;
    assignIds(node.children, node.nodeId);
  });
}

/** Builds the tree. `includeEmpty` = true gives the tree used by the table types. */
function buildTree(records: HeadingRecord[], includeEmpty: boolean, diag: Diagnostics): Tree {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  let prevLevel = 0;
  for (const record of records) {
    if (record.info.text === '' && !includeEmpty) continue;
    let level = record.level;
    if (level > prevLevel + 1) {
      const effectiveLevel = prevLevel + 1;
      diag.warn(`line ${record.lineNo}: レベル飛び（レベル${level}、直前の見出しはレベル${prevLevel}）。`
        + `レベル${effectiveLevel}として扱う`);
      level = effectiveLevel;
    }
    const { info } = record;
    const node: TreeNode = {
      label: info.label,
      lineType: info.lineType,
      shape: info.shape,
      text: info.text,
      color: info.color,
      level,
      lineNo: record.lineNo,
      children: [],
      parent: null,
      nodeId: '',
    };
    if (level === 1) {
      roots.push(node);
    } else {
      const parent = stack[level - 2];
      parent.children.push(node);
      node.parent = parent;
    }
    stack.length = level - 1;
    stack.push(node);
    prevLevel = level;
  }
  assignIds(roots, 'N');
  return new Tree(roots);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Replaces `"` with `#quot;` for Mermaid (5.2). */
const quoteText = (text: string): string => text.split('"').join('#quot;');

/** Mermaid node definition (4.3). */
function mermaidNodeDef(node: TreeNode): string {
  const [openMark, closeMark] = shapeBrackets[node.shape || 'rect'];
  return `${node.nodeId}${openMark}"${quoteText(node.text)}"${closeMark}`;
}

/** `style` lines for colours and borderless nodes. */
function mermaidStyleLines(nodes: TreeNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.shape === 'borderless') {
      if (node.color) result.push(`style ${node.nodeId} fill:${node.color},stroke:none`);
      else result.push(`style ${node.nodeId} fill:none,stroke:none`);
    } else if (node.color) {
      result.push(`style ${node.nodeId} fill:${node.color}`);
    }
  }
  return result;
}

/** An edge of a block diagram (5.3, 5.4). */
function blockEdge(sourceId: string, targetId: string, lineType: string, label: string | null, reverse: boolean): string {
  let operator = blockSymbols[lineType];
  if (reverse) operator = blockReverseSymbols[lineType] ?? operator;
  if (label) return `${sourceId} -- "${quoteText(label)}" ${operator} ${targetId}`;
  return `${sourceId} ${operator} ${targetId}`;
}

const spaceToken = (count: number): string => (count === 1 ? 'space' : `space:${count}`);

/** Renders one grid row of `width` columns. `cells` maps column (1-based) -> node definition. */
function renderGridRow(cells: Map<number, string>, width: number): string {
  const parts: string[] = [];
  let emptyRun = 0;
  for (let col = 1; col <= width; col++) {
    const cell = cells.get(col);
    if (cell !== undefined) {
      if (emptyRun) {
        parts.push(spaceToken(emptyRun));
        emptyRun = 0;
      }
      parts.push(cell);
    } else {
      emptyRun += 1;
    }
  }
  if (emptyRun) parts.push(spaceToken(emptyRun));
  return parts.join(' ');
}

/** Parent -> child pairs, breadth-first (10.4). */
function breadthFirstEdges(root: TreeNode): Array<[TreeNode, TreeNode]> {
  const edges: Array<[TreeNode, TreeNode]> = [];
  const queue: TreeNode[] = [root];
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index];
    for (const child of parent.children) {
      edges.push([parent, child]);
      queue.push(child);
    }
  }
  return edges;
}

function requireSingleRoot(tree: Tree, typeId: string): TreeNode {
  if (tree.roots.length !== 1) {
    throw new ConditionError(`${typeId}: ルートがちょうど1個である必要がある（ルートが${tree.roots.length}個ある）`);
  }
  return tree.roots[0];
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

/** Estimated text width tw(s) for star (10.9.3). */
function textPixelWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch.codePointAt(0)!) ? wideCharWidth : narrowCharWidth;
  return width;
}

/** Level coordinates t(L) and T for the `tight` layout (10.1). */
function tightLevelCoords(tree: Tree, maxDepth: number): { coords: number[]; total: number } {
  const gapList: number[] = new Array(maxDepth + 1).fill(0);
  for (const node of tree.allNodes()) {
    if (node.level >= 2 && node.label) gapList[node.level - 1] = 1;
  }
  const coords: number[] = new Array(maxDepth + 1).fill(0);
  coords[1] = 1;
  for (let level = 1; level < maxDepth; level++) {
    coords[level + 1] = coords[level] + 1 + gapList[level];
  }
  return { coords, total: coords[maxDepth] };
}

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

/** Effective options (defaults applied) plus the option strings given explicitly. */
interface RunOptions {
  direction: string;
  layout: string;
  line: string;
  arrowDirection: string;
  curve: string;
  degreeValue: number;
  spanValue: number;
  radiusValue: number | null;
  blockWidthValue: number | null;
  givenOptions: ExplicitHeadingOptions;
}

function headingFor(opts: RunOptions, typeId: string): string {
  const parts: string[] = [];
  for (const name of meaningfulOptions[typeId] ?? []) {
    const value = opts.givenOptions[name];
    if (value !== undefined) parts.push(`${optionFlags[name]} ${value}`);
  }
  return `## ${typeId}` + (parts.length ? ` (${parts.join(' ')})` : '');
}

// ---------------------------------------------------------------------------
// 6.1 / 6.2 hier-mind / hier-mindlabel
// ---------------------------------------------------------------------------

function generateMindmap(tree: Tree, opts: RunOptions, typeId: string, withLabel: boolean, diag: Diagnostics): string[] {
  const root = requireSingleRoot(tree, typeId);
  const nodes = tree.allNodes();

  let direction = opts.direction;
  if (direction === 'BT') {
    diag.warn(`${typeId}: PlantUML mindmapでは --direction BT はサポートされていない。TB として扱う`);
    direction = 'TB';
  }
  if (direction === 'TD') direction = 'TB';

  let lineStyle = opts.line;
  if (lineStyle.endsWith('Arrow')) {
    diag.warn(`${typeId}: PlantUML mindmapでは矢印を付けられない。--line ${lineStyle} を `
      + `${lineStyle.slice(0, -5)} として扱う`);
    lineStyle = lineStyle.slice(0, -5);
  }

  if (nodes.some(node => node.shape !== null && node.shape !== 'borderless' && node.shape !== 'rounded')) {
    diag.warn(`${typeId}: PlantUML mindmapでは枠の形状を表現できない。形状の指定を無視する`);
  }
  if (nodes.some(node => node.lineType !== null)) {
    diag.warn(`${typeId}: PlantUML mindmapでは節ごとの線種を変更できない。線種名の指定を無視する`);
  }
  if (withLabel && root.label) {
    diag.warn(`line ${root.lineNo}: ${typeId}: ルートのラベルは無視する`);
  }

  let padding: number;
  let margin: number;
  if (opts.layout === 'tight') [padding, margin] = [3, 2];
  else if (opts.layout === 'normal') [padding, margin] = [3, 5];
  else [padding, margin] = [5, 10];

  const out = ['@startmindmap', '<style>', 'mindmapDiagram {',
    '  node {', '    RoundCorner 0', `    Padding ${padding}`, `    Margin ${margin}`, '  }'];
  for (const node of nodes) {
    if (node.shape === 'rounded' || node.color) {
      out.push(`  .${node.nodeId}Node {`);
      if (node.shape === 'rounded') out.push('    RoundCorner 8');
      if (node.color) out.push(`    BackgroundColor ${node.color}`);
      out.push('  }');
    }
  }
  if (lineStyle === 'dotted') out.push('  arrow {', '    LineStyle 2-2', '  }');
  else if (lineStyle === 'thick') out.push('  arrow {', '    LineThickness 4', '  }');
  out.push('}', '</style>');
  out.push(({
    TB: 'top to bottom direction', LR: 'left to right direction', RL: 'right to left direction',
  } as Record<string, string>)[direction]);

  let altLabel: string;
  if (direction === 'TB') altLabel = lineStyle === 'dotted' ? ':' : '|';
  else altLabel = lineStyle === 'dotted' ? '…' : '-';

  const bodyLine = (node: TreeNode, depth: number): string => {
    const mark = '*'.repeat(depth) + (node.shape === 'borderless' ? '_' : '');
    const suffix = (node.shape === 'rounded' || node.color) ? ` <<${node.nodeId}Node>>` : '';
    return `${mark} ${node.text}${suffix}`;
  };

  const emit = (node: TreeNode, depth: number): void => {
    out.push(bodyLine(node, depth));
    const hasLabel = withLabel && node.children.some(child => child.label);
    for (const child of node.children) {
      if (hasLabel) {
        out.push('*'.repeat(depth + 1) + '_ ' + (child.label ? child.label : altLabel));
        emit(child, depth + 2);
      } else {
        emit(child, depth + 1);
      }
    }
  };

  emit(root, 1);
  out.push('@endmindmap');
  return out;
}

// ---------------------------------------------------------------------------
// 6.3 hier-flow
// ---------------------------------------------------------------------------

function generateHierFlow(tree: Tree, opts: RunOptions): string[] {
  const root = requireSingleRoot(tree, 'hier-flow');
  const reverse = opts.arrowDirection === 'reverse';
  const flowDirection = reverse ? reverseDirection[opts.direction] : opts.direction;
  const isHorizontal = opts.direction === 'LR' || opts.direction === 'RL';

  let padding = 8;
  let nodeSpacing = 30;
  let rankSpacing = 30;
  const layout = opts.layout;
  if (layout === 'tight') {
    nodeSpacing = rankSpacing = 15;
  } else if (layout === 'spacyXY') {
    nodeSpacing = rankSpacing = 50;
  } else if (layout === 'spacyX') {
    if (isHorizontal) rankSpacing = 50;
    else nodeSpacing = 50;
  } else if (layout === 'spacyY') {
    if (isHorizontal) nodeSpacing = 50;
    else rankSpacing = 50;
  } else if (layout === 'spacyPadding') {
    padding = 16;
  }

  const out = ['---', 'config:', '  flowchart:', `    padding: ${padding}`, `    nodeSpacing: ${nodeSpacing}`,
    `    rankSpacing: ${rankSpacing}`, '    diagramPadding: 5', '---'];
  if (opts.curve !== 'default') out.push('%%{init:{"flowchart":{"curve":"' + opts.curve + '"}}}%%');
  out.push('flowchart ' + flowDirection);

  const definedIds = new Set<string>();
  const reference = (node: TreeNode): string => {
    if (definedIds.has(node.nodeId)) return node.nodeId;
    definedIds.add(node.nodeId);
    return mermaidNodeDef(node);
  };

  const edges = breadthFirstEdges(root);
  if (!edges.length) out.push(mermaidNodeDef(root));
  for (const [parent, child] of edges) {
    const operator = flowSymbols[child.lineType || opts.line];
    const [left, right] = reverse ? [child, parent] : [parent, child];
    const leftText = reference(left);
    const rightText = reference(right);
    if (child.label) out.push(`${leftText} ${operator} |"${quoteText(child.label)}"|${rightText}`);
    else out.push(`${leftText} ${operator} ${rightText}`);
  }

  const styles = mermaidStyleLines(tree.allNodes());
  if (styles.length) out.push('', ...styles);
  return out;
}

// ---------------------------------------------------------------------------
// 6.4 / 10.2-10.4 hier-block
// ---------------------------------------------------------------------------

/** Position decision of 10.2: node -> position, and the number of leaves. */
function computeLeafPositions(root: TreeNode): { positions: Map<TreeNode, number>; leafCount: number } {
  const positions = new Map<TreeNode, number>();
  let leafCounter = 0;
  const visit = (node: TreeNode): void => {
    if (!node.children.length) {
      leafCounter += 1;
      positions.set(node, leafCounter);
      return;
    }
    node.children.forEach(visit);
    const childPositions = node.children.map(child => positions.get(child)!);
    positions.set(node, Math.floor((Math.min(...childPositions) + Math.max(...childPositions)) / 2));
  };
  visit(root);
  return { positions, leafCount: leafCounter };
}

function setGridCell(grid: Map<number, Map<number, string>>, row: number, col: number, value: string): void {
  let cells = grid.get(row);
  if (!cells) {
    cells = new Map();
    grid.set(row, cells);
  }
  cells.set(col, value);
}

function generateHierBlock(tree: Tree, opts: RunOptions): string[] {
  const root = requireSingleRoot(tree, 'hier-block');
  const direction = opts.direction === 'TD' ? 'TB' : opts.direction;
  const layout = opts.layout;
  const isTight = layout === 'tight';
  const isSpacyX = layout === 'spacyX' || layout === 'spacyXY';
  const isSpacyY = layout === 'spacyY' || layout === 'spacyXY';

  const { positions, leafCount } = computeLeafPositions(root);
  const maxDepth = tree.maxLevel();
  const { coords: tightCoords, total: tightTotal } = tightLevelCoords(tree, maxDepth);
  const nodes = tree.allNodes();

  const grid = new Map<number, Map<number, string>>();
  let width: number;
  let rowCount: number;
  if (direction === 'TB' || direction === 'BT') {
    let colOf: (p: number) => number;
    let rowOfLevel: (level: number) => number;
    if (isSpacyX) {
      width = 2 * leafCount - 1;
      colOf = p => 2 * p - 1;
    } else {
      width = leafCount;
      colOf = p => p;
    }
    if (isTight) {
      rowOfLevel = level => tightCoords[level];
      rowCount = tightTotal;
    } else if (isSpacyY) {
      rowOfLevel = level => 3 * level - 2;
      rowCount = 3 * maxDepth - 2;
    } else {
      rowOfLevel = level => 2 * level - 1;
      rowCount = 2 * maxDepth - 1;
    }
    for (const node of nodes) {
      let row = rowOfLevel(node.level);
      if (direction === 'BT') row = rowCount + 1 - row;
      setGridCell(grid, row, colOf(positions.get(node)!), mermaidNodeDef(node));
    }
  } else {
    let colOfLevel: (level: number) => number;
    let rowOf: (p: number) => number;
    if (isTight) {
      colOfLevel = level => tightCoords[level];
      width = tightTotal;
    } else if (isSpacyX) {
      colOfLevel = level => 3 * level - 2;
      width = 3 * maxDepth - 2;
    } else {
      colOfLevel = level => 2 * level - 1;
      width = 2 * maxDepth - 1;
    }
    if (isSpacyY) {
      rowOf = p => 2 * p - 1;
      rowCount = 2 * leafCount - 1;
    } else {
      rowOf = p => p;
      rowCount = leafCount;
    }
    for (const node of nodes) {
      let col = colOfLevel(node.level);
      if (direction === 'RL') col = width + 1 - col;
      setGridCell(grid, rowOf(positions.get(node)!), col, mermaidNodeDef(node));
    }
  }

  const out: string[] = [];
  if (layout === 'spacyPadding') out.push(...blockPaddingFrontmatter);
  out.push('block', `columns ${width}`);
  for (let row = 1; row <= rowCount; row++) {
    out.push(renderGridRow(grid.get(row) ?? new Map(), width));
  }

  const reverse = opts.arrowDirection === 'reverse';
  const edgeLines = breadthFirstEdges(root).map(([parent, child]) =>
    blockEdge(parent.nodeId, child.nodeId, child.lineType || opts.line, child.label, reverse));
  if (edgeLines.length) out.push('', ...edgeLines);
  const styles = mermaidStyleLines(nodes);
  if (styles.length) out.push('', ...styles);
  return out;
}

// ---------------------------------------------------------------------------
// 7 fishBone
// ---------------------------------------------------------------------------

function generateFishBone(tree: Tree): string[] {
  requireSingleRoot(tree, 'fishBone');
  const out = ['ishikawa-beta'];
  for (const node of tree.allNodes()) out.push(' '.repeat(2 * node.level) + node.text);
  return out;
}

// ---------------------------------------------------------------------------
// 8.1 pie
// ---------------------------------------------------------------------------

/** Splits "name:number"; null when it does not fit. */
function parsePieSlice(text: string): [string, string] | null {
  const colonIndex = text.lastIndexOf(':');
  if (colonIndex < 0) return null;
  const name = stripBlank(text.slice(0, colonIndex));
  const value = stripBlank(text.slice(colonIndex + 1));
  if (name === '' || !numberRe.test(value)) return null;
  return [name, value];
}

function generatePie(tree: Tree, diag: Diagnostics): string[] {
  const root = requireSingleRoot(tree, 'pie');
  if (!root.children.length) throw new ConditionError('pie: レベル2の節が1個以上必要である');
  if (tree.maxLevel() > 2) throw new ConditionError('pie: レベル3以上の節が存在してはならない');
  const slices: Array<[string, string, string | null]> = [];
  for (const child of root.children) {
    const parsed = parsePieSlice(child.text);
    if (parsed === null) {
      throw new ConditionError(`pie: line ${child.lineNo}: レベル2の節が「名称:数値」形式でない（"${child.text}"）`);
    }
    slices.push([parsed[0], parsed[1], child.color]);
  }
  if (slices.length >= 13) {
    diag.warn(`pie: スライスが${slices.length}個ある。Mermaidのテーマ変数は pie1〜pie12 までのため、`
      + '13個目以降の色指定は無視する');
  }

  const themeItems: string[] = [];
  slices.forEach(([, , color], index) => {
    if (color && index + 1 <= 12) themeItems.push(`"pie${index + 1}":"${color}"`);
  });
  themeItems.push('"pieOpacity":1');

  const out = ['%%{init: {"theme":"base","themeVariables":{'];
  themeItems.forEach((item, index) => out.push('  ' + item + (index < themeItems.length - 1 ? ',' : '')));
  out.push('}}}%%');
  out.push('pie showData', `title ${root.text}`);
  for (const [name, value] of slices) out.push(`"${quoteText(name)}" : ${value}`);
  return out;
}

// ---------------------------------------------------------------------------
// 8.2 venn
// ---------------------------------------------------------------------------

const vennLevel2Sets: ReadonlyArray<readonly number[]> = [[1, 2], [1, 3], [2, 3]];

function parseVennName(text: string): [string, string | null] {
  const colonIndex = text.lastIndexOf(':');
  if (colonIndex >= 0) {
    const value = stripBlank(text.slice(colonIndex + 1));
    if (numberRe.test(value)) return [stripBlank(text.slice(0, colonIndex)), value];
  }
  return [text, null];
}

function generateVenn(tree: Tree): string[] {
  const nodes = tree.allNodes();
  if (tree.maxLevel() > 3) throw new ConditionError('venn: レベルは3以下である必要がある');
  const level1Count = tree.nodesAtLevel(1).length;
  const level2Count = tree.nodesAtLevel(2).length;
  const level3Count = tree.nodesAtLevel(3).length;
  if (!(level1Count >= 1 && level1Count <= 3)) {
    throw new ConditionError(`venn: レベル1は1個以上3個以下である必要がある（${level1Count}個ある）`);
  }
  if (level2Count > 3) throw new ConditionError(`venn: レベル2は高々3個である必要がある（${level2Count}個ある）`);
  if (level3Count > 1) throw new ConditionError(`venn: レベル3は高々1個である必要がある（${level3Count}個ある）`);

  const bodyLines: string[] = [];
  const styleLines: string[] = [];
  let setsSeen = 0;
  let level2Seen = 0;
  for (const node of nodes) {
    const [name, value] = parseVennName(node.text);
    if (name === '') throw new ConditionError(`venn: line ${node.lineNo}: 名称が空である`);
    let region: string;
    let line: string;
    if (node.level === 1) {
      setsSeen += 1;
      region = `N${setsSeen}`;
      line = `  set ${region}["${quoteText(name)}"]`;
    } else {
      let required: readonly number[];
      if (node.level === 2) {
        required = vennLevel2Sets[level2Seen];
        level2Seen += 1;
      } else {
        required = [1, 2, 3];
      }
      if (Math.max(...required) > setsSeen) {
        const needed = required.map(k => `N${k}`).join('・');
        throw new ConditionError(`venn: line ${node.lineNo}: 領域 "${name}" に必要な集合（${needed}）が`
          + 'それより前に出現していない');
      }
      region = required.map(k => `N${k}`).join(',');
      line = `  union ${region}["${quoteText(name)}"]`;
    }
    if (value !== null) line += `:${value}`;
    bodyLines.push(line);
    if (node.color) styleLines.push(`  style ${region} fill:${node.color}`);
  }

  const out = ['venn-beta', ...bodyLines];
  if (styleLines.length) out.push('', ...styleLines);
  return out;
}

// ---------------------------------------------------------------------------
// 8.3 table types
// ---------------------------------------------------------------------------

const tableSettings: Record<string, [number | null, boolean]> = {
  table: [null, false], tablec: [null, true],
  table1: [1, false], table1c: [1, true],
  table2: [2, false], table2c: [2, true],
  table3: [3, false], table3c: [3, true],
};

function generateTable(tableTree: Tree, typeId: string): string[] {
  if (!tableTree.roots.length) throw new ConditionError(`${typeId}: ルートが1個以上必要である`);
  if (tableTree.maxLevel() > 2) throw new ConditionError(`${typeId}: レベル3以上の節が存在してはならない`);
  const [boldColumn, centering] = tableSettings[typeId];

  // 8.3.0 replace empty cells
  const rows: string[][] = tableTree.roots.map(root =>
    [root.text, ...root.children.map(child => child.text)].map(text =>
      (text.split(' ').join('').split('\t').join('') === '' ? fullWidthSpace : text)));

  const columnWidths = new Map<number, number>();
  if (centering) {
    for (const cells of rows) {
      cells.forEach((text, colIndex) => {
        columnWidths.set(colIndex, Math.max(columnWidths.get(colIndex) ?? 0, displayWidth(text)));
      });
    }
  }

  const out = ['@startsalt', '{#'];
  rows.forEach((cells, rowIndex) => {
    const cellStrings: string[] = [];
    cells.forEach((text, colIndex) => {
      let cellText = text;
      // 8.3.1 bold
      if (boldColumn !== null && (rowIndex === 0 || colIndex === boldColumn - 1)) cellText = `<b>${cellText}</b>`;
      // 8.3.2 centring
      if (centering) {
        const padWidth = columnWidths.get(colIndex)! - displayWidth(text);
        const spaceCount = Math.floor(padWidth / 2);
        const leftCount = Math.floor(spaceCount / 2);
        let rightCount = spaceCount - leftCount;
        if (colIndex === cells.length - 1) rightCount = 0;
        cellText = fullWidthSpace.repeat(leftCount) + cellText + fullWidthSpace.repeat(rightCount);
      }
      cellStrings.push(cellText);
    });
    out.push('| ' + cellStrings.join(' | '));
  });
  out.push('}', '@endsalt');
  return out;
}

// ---------------------------------------------------------------------------
// 9 quadrant
// ---------------------------------------------------------------------------

/** A value with two decimals (given ×100 as an integer) in the notation of 9.1. */
function formatHundredths(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  if (value % 10 === 0) return `${whole}.${Math.floor(fraction / 10)}`;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

function generateQuadrant(tree: Tree): string[] {
  const roots = tree.roots;
  if (roots.length !== 2) throw new ConditionError(`quadrant: ルートがちょうど2個である必要がある（${roots.length}個ある）`);
  for (const root of roots) {
    if (root.children.length !== 2) {
      throw new ConditionError(`quadrant: レベル2の節が各ルートにちょうど2個必要である（"${root.text}" の子は`
        + `${root.children.length}個）`);
    }
    for (const child of root.children) {
      if (!(child.children.length >= 1 && child.children.length <= 9)) {
        throw new ConditionError(`quadrant: レベル3の節が各レベル2節に1個以上9個以下必要である（"${child.text}" の子は`
          + `${child.children.length}個）`);
      }
    }
  }
  if (tree.maxLevel() > 3) throw new ConditionError('quadrant: レベル4以上の節が存在してはならない');

  const [leftBottom, leftTop] = roots[0].children;
  const [rightBottom, rightTop] = roots[1].children;
  const quadrantNodes: Record<number, TreeNode> = { 1: rightTop, 2: leftTop, 3: leftBottom, 4: rightBottom };

  const out: string[] = [];
  const fills = [1, 2, 3, 4].filter(k => quadrantNodes[k].color).map(k => [k, quadrantNodes[k].color] as const);
  if (fills.length) {
    out.push('---', 'config:', '  themeVariables:');
    for (const [k, color] of fills) out.push(`    quadrant${k}Fill: "${color}"`);
    out.push('---');
  }
  out.push('quadrantChart');
  out.push(`  x-axis "${quoteText(roots[0].text)}" --> "${quoteText(roots[1].text)}"`);
  out.push(`  y-axis "${quoteText(leftBottom.text)}" --> "${quoteText(leftTop.text)}"`);
  for (const k of [1, 2, 3, 4]) out.push(`  quadrant-${k} "${quoteText(quadrantNodes[k].children[0].text)}"`);
  roots.forEach((root, rootIndex) => {
    const xValue = rootIndex === 0 ? 25 : 75;
    root.children.forEach((child, childIndex) => {
      const baseY = childIndex === 0 ? 40 : 90;
      child.children.slice(1).forEach((point, offset) => {
        const yValue = baseY - 5 * offset;
        out.push(`  "${quoteText(point.text)}": [${formatHundredths(xValue)}, `
          + `${formatHundredths(yValue)}] radius:0`);
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 10.5-10.6 struct-flow
// ---------------------------------------------------------------------------

function generateStructFlow(tree: Tree, opts: RunOptions): string[] {
  const roots = tree.roots;
  if (!roots.length) throw new ConditionError('struct-flow: ルートが1個以上必要である');
  const layout = opts.layout;
  const maxDepth = tree.maxLevel();
  const { coords: tightCoords, total: tightTotal } = tightLevelCoords(tree, maxDepth);
  let colOfLevel: (level: number) => number;
  let width: number;
  if (layout === 'tight') {
    colOfLevel = level => tightCoords[level];
    width = tightTotal;
  } else if (layout === 'spacyX' || layout === 'spacyXY') {
    colOfLevel = level => 3 * level - 2;
    width = 3 * maxDepth - 2;
  } else {
    colOfLevel = level => 2 * level - 1;
    width = 2 * maxDepth - 1;
  }
  const isSpacyY = layout === 'spacyY' || layout === 'spacyXY';

  const groups: Array<Array<Map<number, string>>> = [];
  for (const root of roots) {
    const rows: Array<Map<number, string>> = [];
    const place = (node: TreeNode, sameRow: boolean): void => {
      if (!sameRow) rows.push(new Map());
      rows[rows.length - 1].set(colOfLevel(node.level), mermaidNodeDef(node));
      node.children.forEach((child, childIndex) => place(child, childIndex === 0));
    };
    place(root, false);
    groups.push(rows);
  }

  const out: string[] = [];
  if (layout === 'spacyPadding') out.push(...blockPaddingFrontmatter);
  out.push('block', `columns ${width}`);
  const blankRow = spaceToken(width);
  groups.forEach((rows, groupIndex) => {
    if (groupIndex > 0) {
      out.push('');
      if (isSpacyY) out.push(blankRow);
    }
    rows.forEach((cells, rowIndex) => {
      if (rowIndex > 0 && isSpacyY) out.push(blankRow);
      out.push(renderGridRow(cells, width));
    });
  });

  const subtreeLines = (node: TreeNode): string[] => {
    const result: string[] = [];
    node.children.forEach((child, childIndex) => {
      const source = child.label || childIndex === 0 ? node : node.children[childIndex - 1];
      result.push(blockEdge(source.nodeId, child.nodeId, child.lineType || opts.line, child.label, false));
      result.push(...subtreeLines(child));
    });
    return result;
  };

  let segments: string[][] = [subtreeLines(roots[0])];
  for (let rootIndex = 1; rootIndex < roots.length; rootIndex++) {
    const previous = roots[rootIndex - 1];
    const current = roots[rootIndex];
    const segment = [blockEdge(previous.nodeId, current.nodeId, current.lineType || opts.line, null, false)];
    segment.push(...subtreeLines(current));
    segments.push(segment);
  }
  segments = segments.filter(segment => segment.length);
  if (segments.length) {
    out.push('');
    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) out.push('');
      out.push(...segment);
    });
  }

  const styles = mermaidStyleLines(tree.allNodes());
  if (styles.length) out.push('', ...styles);
  return out;
}

// ---------------------------------------------------------------------------
// 10.8-10.10 star
// ---------------------------------------------------------------------------

/** Estimated block size (10.9.3). */
function estimateBlockSize(node: TreeNode): [number, number] {
  const textWidth = textPixelWidth(node.text);
  const shape = node.shape || 'rect';
  if (shape === 'cyl') return [textWidth + 6, 43 + 0.18 * textWidth];
  if (shape === 'circle') {
    const diameter = pyHypot(textWidth, labelHeight) + 6;
    return [diameter, diameter];
  }
  if (shape === 'dbl-circ') {
    const diameter = pyHypot(textWidth, labelHeight) + 24;
    return [diameter, diameter];
  }
  if (shape === 'diam') return [textWidth + 38, textWidth + 38];
  return [textWidth + blockPaddingX, blockHeight];
}

function roundHalfAway(value: number): number {
  if (value === 0) return 0;
  const sign = value > 0 ? 1 : -1;
  return sign * Math.floor(Math.abs(value) + 0.5) || 0;
}

type StarCell = [number, number];

/** Dimensions used for the star layout. */
class StarGeometry {
  readonly span: number;
  readonly degree: number;
  readonly minLineLength: number;
  readonly labelMargin: number;
  readonly minBlockGap: number;
  readonly cellGap: number;
  readonly count: number;
  readonly cellHeight: number;
  readonly colPitch: number;
  readonly rowPitch: number;
  readonly drawnWidth: number;
  readonly needs: Array<[number, number]> = [];

  constructor(root: TreeNode, opts: RunOptions) {
    this.span = opts.spanValue;
    this.degree = opts.degreeValue;
    [this.minLineLength, this.labelMargin, this.minBlockGap, this.cellGap] = starLayoutValues[opts.layout];
    const peripherals = root.children;
    this.count = peripherals.length;
    const sizes = [root, ...peripherals].map(estimateBlockSize);
    const naturalWidth = opts.blockWidthValue !== null
      ? opts.blockWidthValue
      : Math.max(...sizes.map(([w]) => w));
    this.cellHeight = Math.max(...sizes.map(([, h]) => h));
    const columnWidth = naturalWidth / this.span;
    this.colPitch = columnWidth + this.cellGap;
    this.rowPitch = this.cellHeight + this.cellGap;
    this.drawnWidth = columnWidth * this.span + this.cellGap * (this.span - 1);
    for (const node of peripherals) {
      if (node.label) {
        const needX = textPixelWidth(node.label) + labelPaddingX + 2 * this.labelMargin;
        const needY = labelHeight + 2 * this.labelMargin;
        this.needs.push([needX, needY]);
      } else {
        this.needs.push([this.minLineLength, this.minLineLength]);
      }
    }
  }

  gapX(cellA: StarCell, cellB: StarCell): number {
    return Math.abs(cellA[0] - cellB[0]) * this.colPitch - this.drawnWidth;
  }

  gapY(cellA: StarCell, cellB: StarCell): number {
    return Math.abs(cellA[1] - cellB[1]) * this.rowPitch - this.cellHeight;
  }

  cellsForRadius(radius: number): StarCell[] {
    const cells: StarCell[] = [];
    for (let index = 0; index < this.count; index++) {
      const theta = (this.degree + (360 * index) / this.count) * degToRad;
      const xValue = radius * Math.sin(theta);
      const yValue = -radius * Math.cos(theta);
      cells.push([roundHalfAway(xValue / this.colPitch), roundHalfAway(yValue / this.rowPitch)]);
    }
    return cells;
  }

  isValid(cells: StarCell[]): boolean {
    const center: StarCell = [0, 0];
    for (let index = 0; index < cells.length; index++) {
      const [needX, needY] = this.needs[index];
      if (!(this.gapX(center, cells[index]) >= needX || this.gapY(center, cells[index]) >= needY)) return false;
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (!(this.gapX(cells[i], cells[j]) >= this.minBlockGap
          || this.gapY(cells[i], cells[j]) >= this.minBlockGap)) return false;
      }
    }
    return true;
  }

  distortion(cells: StarCell[]): number {
    const step = 360 / this.count;
    let maxDelta = 0.0;
    const distances: number[] = [];
    cells.forEach(([col, row], index) => {
      const xPos = col * this.colPitch;
      const yPos = row * this.rowPitch;
      const actualAngle = pyMod(Math.atan2(xPos, -yPos) * radToDeg, 360);
      const targetAngle = pyMod(this.degree + step * index, 360);
      const diff = Math.abs(actualAngle - targetAngle) % 360;
      maxDelta = Math.max(maxDelta, Math.min(diff, 360 - diff));
      distances.push(pyHypot(xPos, yPos));
    });
    const meanDistance = pySum(distances) / distances.length;
    return angleWeight * maxDelta / step + (Math.max(...distances) - Math.min(...distances)) / meanDistance;
  }
}

/** Radius search (10.9.10). Returns the cells of a valid layout. */
function searchStarCells(geometry: StarGeometry, radiusOption: number | null): StarCell[] {
  if (radiusOption !== null) {
    const cells = geometry.cellsForRadius(radiusOption);
    if (!geometry.isValid(cells)) {
      throw new ConditionError(`star: --radius ${formatG(radiusOption)} では周辺ブロックや線ラベルが重なる`);
    }
    return cells;
  }
  const radiusStep = Math.min(geometry.colPitch, geometry.rowPitch) / 8;
  let firstRadius: number | null = null;
  let bestCells: StarCell[] | null = null;
  let bestScore = 0;
  for (let k = 0; ; k++) {
    const radius = geometry.rowPitch + k * radiusStep;
    if (radius > geometry.rowPitch * 1000) throw new ConditionError('star: 有効な配置が見つからない');
    const cells = geometry.cellsForRadius(radius);
    if (geometry.isValid(cells)) {
      if (firstRadius === null) firstRadius = radius;
      const score = geometry.distortion(cells) + sizePenalty * (radius / firstRadius - 1);
      if (bestCells === null || score < bestScore - 1e-9) {
        bestCells = cells;
        bestScore = score;
      }
    }
    if (firstRadius !== null && radius > firstRadius * searchRange) return bestCells!;
  }
}

function generateStar(tree: Tree, opts: RunOptions): string[] {
  const root = requireSingleRoot(tree, 'star');
  if (!root.children.length) throw new ConditionError('star: レベル2の節が1個以上必要である');
  if (tree.maxLevel() > 2) throw new ConditionError('star: レベル3以上の節が存在してはならない');

  const geometry = new StarGeometry(root, opts);
  const cells = searchStarCells(geometry, opts.radiusValue);
  const span = geometry.span;
  const spanSuffix = span >= 2 ? `:${span}` : '';

  const placed: Array<[number, number, TreeNode]> = [
    [0, 0, root],
    ...root.children.map((node, index): [number, number, TreeNode] => [cells[index][0], cells[index][1], node]),
  ];
  const minCol = Math.min(...placed.map(([col]) => col));
  const endCol = Math.max(...placed.map(([col]) => col)) + span;
  const width = endCol - minCol;
  const minRow = Math.min(...placed.map(([, row]) => row));
  const maxRow = Math.max(...placed.map(([, row]) => row));

  const out: string[] = [];
  if (opts.layout === 'spacyPadding') out.push(...blockPaddingFrontmatter);
  out.push('block', `columns ${width}`);
  for (let row = minRow; row <= maxRow; row++) {
    const rowBlocks = placed
      .filter(([, r]) => r === row)
      .map(([col, , node]) => [col, node] as const)
      .sort((a, b) => a[0] - b[0]);
    const parts: string[] = [];
    let cursor = minCol;
    for (const [col, node] of rowBlocks) {
      if (col > cursor) parts.push(spaceToken(col - cursor));
      parts.push(mermaidNodeDef(node) + spanSuffix);
      cursor = col + span;
    }
    if (endCol > cursor) parts.push(spaceToken(endCol - cursor));
    out.push(parts.join(' '));
  }

  const reverse = opts.arrowDirection === 'reverse';
  out.push('');
  for (const node of root.children) {
    out.push(blockEdge(root.nodeId, node.nodeId, node.lineType || opts.line, node.label, reverse));
  }

  const styles = mermaidStyleLines([root, ...root.children]);
  if (styles.length) out.push('', ...styles);
  return out;
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
  /** 0 on success, 1 on input error, 2 on a command-line error (same as the CLI's exit status). */
  exitCode: number;
  blocks: HeadingDiagramBlock[];
  /** Exactly what the CLI writes to stdout / the `-o` file ('' on failure). */
  outputText: string;
  warnings: string[];
  errors: string[];
  /** stderr lines (`warning: ...` / `error: ...`) in emission order. */
  log: string[];
}

const choiceText = (choices: readonly string[]): string => choices.map(choice => pyRepr(choice)).join(', ');

/** Validates the options like argparse + `Options` do; returns the argparse error text or the options. */
function buildRunOptions(explicitOptions: ExplicitHeadingOptions): RunOptions | string {
  const givenOptions: ExplicitHeadingOptions = {};
  for (const name of optionOrder) {
    const value = explicitOptions[name];
    if (value !== undefined && value !== null) givenOptions[name] = value;
  }
  for (const name of optionOrder) {
    const value = givenOptions[name];
    if (value === undefined || isNumericHeadingOption(name)) continue;
    if (!(optionChoices[name] as readonly string[]).includes(value)) {
      return `argument ${optionFlags[name]}: invalid choice: ${pyRepr(value)} (choose from ${choiceText(optionChoices[name])})`;
    }
  }
  const numericValues: Partial<Record<NumericHeadingOptionName, number>> = {};
  for (const name of numericOptionNames) {
    const value = givenOptions[name];
    if (value === undefined) continue;
    const parsed = parseNumericOption(name, value);
    if ('error' in parsed) return `argument ${optionFlags[name]}: ${parsed.error}`;
    numericValues[name] = parsed.value;
  }
  return {
    direction: givenOptions.direction || 'TB',
    layout: givenOptions.layout || 'normal',
    line: givenOptions.line || 'solid',
    arrowDirection: givenOptions.arrowDirection || 'default',
    curve: givenOptions.curve || 'default',
    degreeValue: numericValues.degree ?? 0.0,
    spanValue: numericValues.span ?? 4,
    radiusValue: numericValues.radius ?? null,
    blockWidthValue: numericValues.blockWidth ?? null,
    givenOptions,
  };
}

function generateDiagram(typeId: string, normalTree: () => Tree, tableTree: () => Tree, opts: RunOptions, diag: Diagnostics): string[] {
  if (tableTypeIds.includes(typeId)) return generateTable(tableTree(), typeId);
  const tree = normalTree();
  switch (typeId) {
    case 'hier-mind': return generateMindmap(tree, opts, typeId, false, diag);
    case 'hier-mindlabel': return generateMindmap(tree, opts, typeId, true, diag);
    case 'hier-block': return generateHierBlock(tree, opts);
    case 'hier-flow': return generateHierFlow(tree, opts);
    case 'fishBone': return generateFishBone(tree);
    case 'pie': return generatePie(tree, diag);
    case 'venn': return generateVenn(tree);
    case 'struct-flow': return generateStructFlow(tree, opts);
    case 'quadrant': return generateQuadrant(tree);
    case 'star': return generateStar(tree, opts);
    default: throw new Error(`unknown diagram type: ${typeId}`);
  }
}

/**
 * Port of `run()`.
 * @param sourceText heading-format input
 * @param types diagram type ids (`-t`); null/undefined/empty = the CLI's default set
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

  // Command line (argparse) errors: exit status 2
  for (const typeId of types ?? []) {
    if (!(typeIdList as readonly string[]).includes(typeId)) {
      diag.error(`argument -t/--type: invalid choice: ${pyRepr(String(typeId))} (choose from ${choiceText(typeIdList)})`);
      return finish(2);
    }
  }
  const opts = buildRunOptions(explicitOptions);
  if (typeof opts === 'string') {
    diag.error(opts);
    return finish(2);
  }

  // The file is read with universal newlines and `utf-8-sig`.
  let text = sourceText;
  if (text.startsWith('﻿')) text = text.slice(1);
  const records = parseLines(text.replace(/\r\n?/g, '\n').split('\n'), diag);
  if (!records.some(record => record.info.text !== '')) {
    diag.error('有効な見出し行（テキストが空でない見出し行）が1行も無い');
    return finish(1);
  }

  const explicit = !!types && types.length > 0;
  const targetTypes = explicit ? [...new Set(types)] : [...defaultTypeIds];

  // Warn about empty headings only when a non-table type is generated
  if (targetTypes.some(typeId => !tableTypeIds.includes(typeId))) {
    for (const record of records) {
      if (record.info.text === '') {
        diag.warn(`line ${record.lineNo}: 内容（テキスト）が空の見出し行である。`
          + 'table系以外の図種では無視し、table系では空セルとして扱う');
      }
    }
  }

  // Trees are built when first needed
  let normalCache: Tree | null = null;
  let tableCache: Tree | null = null;
  const normalTree = (): Tree => (normalCache ??= buildTree(records, false, diag));
  const tableTree = (): Tree => (tableCache ??= buildTree(records, true, diag));

  const blocks: HeadingDiagramBlock[] = [];
  const errors: string[] = [];
  for (const typeId of targetTypes) {
    let actualType = typeId;
    if (typeId === 'hier-mind' && normalTree().allNodes().some(node => node.label)) {
      if (explicit) diag.warn('hier-mind: 入力にラベルが含まれるため hier-mindlabel として生成する');
      actualType = 'hier-mindlabel';
    }
    let body: string[];
    try {
      body = generateDiagram(actualType, normalTree, tableTree, opts, diag);
    } catch (exc) {
      if (!(exc instanceof ConditionError)) throw exc;
      if (explicit) errors.push(`入力条件違反: ${exc.message}`);
      else diag.warn(`入力条件違反のためスキップする: ${exc.message}`);
      continue;
    }
    // The heading's options follow the requested type (hier-mind)
    const heading = headingFor(opts, typeId).replace(`## ${typeId}`, `## ${actualType}`);
    blocks.push({
      typeId: actualType,
      language: plantumlTypeIds.has(actualType) ? 'plantuml' : 'mermaid',
      heading,
      body: body.join('\n'),
    });
  }

  if (errors.length) {
    for (const message of errors) diag.error(message);
    return finish(1);
  }
  if (!blocks.length) {
    diag.error('生成できた図種が1つも無い');
    return finish(1);
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
    case 'star':
      return ['# 円形;会議の準備:#ffd', '## 議題の確定', '## |前回議事録|実線矢印;資料作成',
        '## |参加者確定|実線矢印;サブ;会場手配:#0FF', '## |会場確定|点線矢印;日程調整', '## 角丸;備品確認'].join('\n');
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
 * e.g. `hier-flow --direction LR --layout tight` or `star --degree 30`. The
 * syntax follows the CLI (`-t TYPE` is accepted too); unknown tokens are
 * reported, never fatal.
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
      if (optionOrder.includes(name) && value !== undefined && isValidHeadingOptionValue(name, value)) {
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

/** Drops values that are invalid, equal to the default, or do not apply to the type. */
function normaliseHeadingOptions(typeId: string, options: ExplicitHeadingOptions): ExplicitHeadingOptions {
  const result: ExplicitHeadingOptions = {};
  for (const name of meaningfulOptions[typeId] ?? []) {
    const value = options[name];
    if (value !== undefined && isValidHeadingOptionValue(name, value) && !isDefaultOptionValue(name, value)) {
      result[name] = value;
    }
  }
  return result;
}

/** Inverse of `parseHeadingInfo`. Options equal to the default, or meaningless for the type, are dropped. */
export function buildHeadingInfo(typeId: string, options: ExplicitHeadingOptions = {}): string {
  const parts = [typeId];
  const normalised = normaliseHeadingOptions(typeId, options);
  for (const name of meaningfulOptions[typeId] ?? []) {
    const value = normalised[name];
    if (value !== undefined) parts.push(`${optionFlags[name]} ${value}`);
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
 *   understands, changing that single option and keeping the others. The
 *   numeric `star` options use their presets (`radius` / `blockWidth` have none).
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

/** Preference order used when a type has to be picked automatically. */
const suggestionOrder: readonly HeadingTypeId[] = ['hier-flow', 'struct-flow', 'quadrant', 'venn', 'pie', 'table'];

/**
 * Picks a type the source can be drawn as: `hier-flow` for a single tree,
 * `struct-flow` for several roots, then the more specialised types.
 * Falls back to `hier-flow` (which then reports why it cannot be drawn).
 */
export function suggestHeadingType(source: string): HeadingTypeId {
  for (const typeId of suggestionOrder) {
    if (runHeading2Diagram(source, [typeId]).exitCode === 0) return typeId;
  }
  return DEFAULT_HEADING_TYPE;
}
