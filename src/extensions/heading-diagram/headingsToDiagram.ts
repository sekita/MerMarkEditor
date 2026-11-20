/**
 * "Convert headings to diagram": turns a run of top-level heading blocks into
 * one heading-format (heading2diagram) diagram node.
 *
 * - With an empty selection, the cursor must be in a heading; the run of
 *   consecutive headings around it is converted.
 * - With a selection, the range from the first to the last selected heading
 *   is converted. Empty paragraphs inside it are dropped; any other block in
 *   between (text, list, table, image, ...) cancels the command so nothing
 *   is lost.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { suggestHeadingType } from '../../utils/heading2diagram';

export interface HeadingRun {
  /** Document position where the first converted block starts. */
  from: number;
  /** Document position where the last converted block ends. */
  to: number;
  /** Heading-format text (`# A`, `## B`, ...). */
  source: string;
}

interface TopBlock {
  node: ProseMirrorNode;
  start: number;
  end: number;
}

const isHeading = (block: TopBlock) => block.node.type.name === 'heading';
const isEmptyParagraph = (block: TopBlock) =>
  block.node.type.name === 'paragraph' && block.node.textContent.trim() === '';

const headingLine = (node: ProseMirrorNode): string =>
  `${'#'.repeat(Number(node.attrs.level) || 1)} ${node.textContent.replace(/\s+/g, ' ').trim()}`;

/** Finds the headings the command would convert, or null when there are none. */
export function findHeadingRun(state: EditorState): HeadingRun | null {
  const blocks: TopBlock[] = [];
  state.doc.forEach((node, offset) => blocks.push({ node, start: offset, end: offset + node.nodeSize }));
  if (!blocks.length) return null;

  const { from, to, empty } = state.selection;
  const indexAt = (pos: number) => {
    const found = blocks.findIndex((block) => pos >= block.start && pos < block.end);
    return found >= 0 ? found : blocks.length - 1;
  };

  let first: number;
  let last: number;
  if (empty) {
    const index = indexAt(from);
    if (!isHeading(blocks[index])) return null;
    first = index;
    last = index;
    while (first > 0 && isHeading(blocks[first - 1])) first--;
    while (last < blocks.length - 1 && isHeading(blocks[last + 1])) last++;
  } else {
    const startIndex = indexAt(from);
    // A selection that ends exactly where a block starts does not include it.
    let endIndex = indexAt(to);
    if (endIndex > startIndex && to <= blocks[endIndex].start + 1) endIndex--;
    first = startIndex;
    last = endIndex;
    while (first <= last && !isHeading(blocks[first])) first++;
    while (last >= first && !isHeading(blocks[last])) last--;
    if (first > last) return null;
    for (let index = first; index <= last; index++) {
      const block = blocks[index];
      if (!isHeading(block) && !isEmptyParagraph(block)) return null;
    }
  }

  const lines = blocks.slice(first, last + 1).filter(isHeading).map((block) => headingLine(block.node));
  return { from: blocks[first].start, to: blocks[last].end, source: lines.join('\n') };
}

/**
 * Replaces the heading run with a diagram node of `nodeTypeName` on `tr`.
 * Returns false (and leaves `tr` untouched) when there is nothing to convert.
 */
export function applyHeadingsToDiagram(state: EditorState, tr: Transaction, nodeTypeName = 'mermaid'): boolean {
  const run = findHeadingRun(state);
  const nodeType = state.schema.nodes[nodeTypeName];
  if (!run || !nodeType) return false;
  const node = nodeType.create({
    code: run.source,
    headingType: suggestHeadingType(run.source),
    headingOptions: '',
  });
  tr.replaceRangeWith(run.from, run.to, node);
  const start = tr.mapping.map(run.from, -1);
  const inserted = tr.doc.nodeAt(start);
  if (inserted?.type === nodeType) tr.setSelection(NodeSelection.create(tr.doc, start));
  tr.scrollIntoView();
  return true;
}
