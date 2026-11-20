import { afterEach, describe, expect, it } from 'vitest';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { applyHeadingsToDiagram, findHeadingRun } from '../../extensions/heading-diagram/headingsToDiagram';
import { suggestHeadingType } from '../../utils/heading2diagram';

// Minimal stand-in for MermaidExtension (the real one mounts a Vue node view).
const MermaidStub = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  addAttributes: () => ({ code: { default: '' }, headingType: { default: null }, headingOptions: { default: '' } }),
  parseHTML: () => [{ tag: 'div[data-type="mermaid"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { 'data-type': 'mermaid', ...HTMLAttributes }],
});

const editors: Editor[] = [];
function makeEditor(content: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit, MermaidStub], content });
  editors.push(editor);
  return editor;
}
afterEach(() => { while (editors.length) editors.pop()!.destroy(); });

/** Position inside the text of the n-th top-level block. */
function posIn(editor: Editor, blockIndex: number, offset = 1): number {
  let pos = 0;
  editor.state.doc.forEach((node, start, index) => { if (index === blockIndex) pos = start + 1 + Math.min(offset, node.content.size); });
  return pos;
}

function convert(editor: Editor): boolean {
  const tr = editor.state.tr;
  const done = applyHeadingsToDiagram(editor.state, tr);
  if (done) editor.view.dispatch(tr);
  return done;
}

const doc = '<p>説明文</p><h1>A1</h1><h2>A11</h2><h2>A12</h2><h3>|確認|実線矢印;A121:#f88</h3><p>後ろ</p>';

describe('headings to diagram', () => {
  it('converts the run of headings around the cursor', () => {
    const editor = makeEditor(doc);
    editor.commands.setTextSelection(posIn(editor, 2));
    expect(findHeadingRun(editor.state)?.source).toBe('# A1\n## A11\n## A12\n### |確認|実線矢印;A121:#f88');
    expect(convert(editor)).toBe(true);
    const json = editor.getJSON().content!;
    expect(json.map(n => n.type)).toEqual(['paragraph', 'mermaid', 'paragraph']);
    expect(json[1].attrs).toEqual({ code: '# A1\n## A11\n## A12\n### |確認|実線矢印;A121:#f88', headingType: 'hier-flow', headingOptions: '' });
    expect(editor.state.selection.constructor.name).toBe('NodeSelection');
    editor.commands.undo();
    expect(editor.getHTML()).toBe(doc);
  });

  it('does nothing when the cursor is not in a heading', () => {
    const editor = makeEditor(doc);
    editor.commands.setTextSelection(posIn(editor, 0));
    expect(findHeadingRun(editor.state)).toBeNull();
    expect(convert(editor)).toBe(false);
    expect(editor.getHTML()).toBe(doc);
  });

  it('converts only the selected headings', () => {
    const editor = makeEditor(doc);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posIn(editor, 2), posIn(editor, 3))));
    expect(findHeadingRun(editor.state)?.source).toBe('## A11\n## A12');
  });

  it('trims non-heading blocks at the edges of a select-all', () => {
    const editor = makeEditor(doc);
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    expect(convert(editor)).toBe(true);
    expect(editor.getJSON().content!.map(n => n.type)).toEqual(['paragraph', 'mermaid', 'paragraph']);
  });

  it('drops empty paragraphs between headings but refuses to swallow text', () => {
    const withEmpty = makeEditor('<h1>A</h1><p></p><h2>B</h2>');
    withEmpty.view.dispatch(withEmpty.state.tr.setSelection(new AllSelection(withEmpty.state.doc)));
    expect(findHeadingRun(withEmpty.state)?.source).toBe('# A\n## B');

    const withText = makeEditor('<h1>A</h1><p>本文</p><h2>B</h2>');
    withText.view.dispatch(withText.state.tr.setSelection(new AllSelection(withText.state.doc)));
    expect(findHeadingRun(withText.state)).toBeNull();
    // With the cursor only the adjacent run is taken, so the text stays.
    withText.commands.setTextSelection(posIn(withText, 0));
    expect(findHeadingRun(withText.state)?.source).toBe('# A');
  });

  it('does not take a block the selection merely touches', () => {
    const editor = makeEditor('<h1>A</h1><h2>B</h2><h2>C</h2>');
    // From inside A to the very start of C's text.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posIn(editor, 0), posIn(editor, 2, 0))));
    expect(findHeadingRun(editor.state)?.source).toBe('# A\n## B');
  });

  it('picks a type the headings can be drawn as', () => {
    expect(suggestHeadingType('# A\n## B')).toBe('hier-flow');
    expect(suggestHeadingType('# A\n# B')).toBe('struct-flow');
    expect(suggestHeadingType('plain')).toBe('hier-flow');
  });
});
