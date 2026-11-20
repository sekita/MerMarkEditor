import { describe, it, expect } from 'vitest';
import {
  buildHeadingInfo,
  buildHeadingOptionString,
  convertHeadingBlock,
  parseHeadingInfo,
  runHeading2Diagram,
  validHeadingTypes,
  type ExplicitHeadingOptions,
} from '../../utils/heading2diagram';

// Inputs and reference outputs copied verbatim from
// https://github.com/sekita/heading2diagram/tree/main/examples (v1.0.2).
const fixtures = import.meta.glob('../fixtures/heading2diagram/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const fixture = (name: string): string => {
  const text = fixtures[`../fixtures/heading2diagram/${name}`];
  if (text === undefined) throw new Error(`missing fixture ${name}`);
  return text.replace(/\r\n/g, '\n');
};

// Same table as tests/test_examples.py in the reference repository.
const referenceCases: Array<[string, string, string, ExplicitHeadingOptions]> = [
  ['example1.md', 'out1_hier-block.md', 'hier-block', {}],
  ['example1.md', 'out1_hier-flow.md', 'hier-flow', {}],
  ['example1.md', 'out1_hier-mind.md', 'hier-mind', {}],
  ['example1.md', 'out1_struct-flow_tight.md', 'struct-flow', { layout: 'tight' }],
  ['example2.md', 'out2_hier-block_LR_tight.md', 'hier-block', { direction: 'LR', layout: 'tight' }],
  ['example2.md', 'out2_hier-flow_LR.md', 'hier-flow', { direction: 'LR' }],
  ['example2.md', 'out2_hier-mindlabel_LR.md', 'hier-mindlabel', { direction: 'LR' }],
  ['example2.md', 'out2_struct-flow_tight.md', 'struct-flow', { layout: 'tight' }],
  ['example3.md', 'out3_fishBone.md', 'fishBone', {}],
  ['example3.md', 'out3_hier-flow_RL_thickArrow_arrowReverse.md', 'hier-flow',
    { direction: 'RL', line: 'thickArrow', arrowDirection: 'reverse' }],
  ['example4.md', 'out4_venn.md', 'venn', {}],
  ['example5.md', 'out5_table1c.md', 'table1c', {}],
  ['example6.md', 'out6_quadrant.md', 'quadrant', {}],
  ['example7.md', 'out7_pie.md', 'pie', {}],
];

describe('heading2diagram port', () => {
  it.each(referenceCases)('%s -> %s matches the reference output', (input, output, typeId, options) => {
    const result = runHeading2Diagram(fixture(input), [typeId], options);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.outputText).toBe(fixture(output));
  });

  it('generates every applicable type when none is requested', () => {
    const result = runHeading2Diagram(fixture('example1.md'));
    expect(result.exitCode).toBe(0);
    expect(result.blocks.map(b => b.typeId)).toEqual(
      ['hier-mind', 'hier-block', 'hier-flow', 'fishBone', 'table', 'struct-flow'].filter(
        id => id !== 'table', // example1 has level-3 headings, so table is skipped
      ),
    );
    expect(result.warnings.some(w => w.includes('図種 pie の入力条件を満たさないためスキップする'))).toBe(true);
  });

  it('fails an explicitly requested type whose condition is violated', () => {
    const result = runHeading2Diagram('# A\n# B', ['hier-flow']);
    expect(result.exitCode).toBe(1);
    expect(result.outputText).toBe('');
    expect(result.errors).toEqual(['図種 hier-flow の入力条件を満たさない: ルートがちょうど1個であること（ルートが2個ある）']);
  });

  it('reports an input without any usable heading', () => {
    const result = runHeading2Diagram('plain text\n#\n');
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['有効な見出し行（テキストが空でない見出し行）が1行も無い']);
  });

  it('repairs level jumps and warns once per message', () => {
    const result = runHeading2Diagram('### A\n# B\n### C\n#D\nnot a heading', ['struct-flow']);
    expect(result.exitCode).toBe(0);
    expect(result.log).toEqual([
      'warning: 4行目: "#" の直後に空白が無い（見出し行の書き間違いの可能性）。この行を無視する',
      'warning: 5行目: 見出し行でも空行でもない行を無視する',
      'warning: 1行目: 先頭の見出し行のレベルが3である（レベル飛び）。ルート（レベル1）として扱う',
      'warning: 3行目: レベル飛び（直前の見出し行のレベル1に対してレベル3）。直前の見出し行の節の子（レベル2）として扱う',
    ]);
  });

  it('switches hier-mind to hier-mindlabel when labels are present', () => {
    const result = runHeading2Diagram('# A\n## |x|B', ['hier-mind']);
    expect(result.blocks[0].typeId).toBe('hier-mindlabel');
    expect(result.blocks[0].language).toBe('plantuml');
    expect(result.outputText.startsWith('## hier-mindlabel\n```plantuml\n@startmindmap')).toBe(true);
  });

  it('does not treat object prototype names as modifiers', () => {
    const result = runHeading2Diagram('# constructor;A', ['fishBone']);
    expect(result.blocks[0].body).toBe('ishikawa-beta\n  constructor;A');
  });

  it('measures full-width characters as two columns when centring tables', () => {
    const result = runHeading2Diagram('# 項目\n## A\n# x\n## 長い値です', ['tablec']);
    expect(result.blocks[0].body).toBe('@startsalt\n{#\n| 項目 | \u3000\u3000A\n| x\u3000 | 長い値です\n}\n@endsalt');
  });
});

describe('heading2diagram editor API', () => {
  it('parses a fence info string', () => {
    expect(parseHeadingInfo('hier-flow --direction LR --layout tight')).toEqual({
      typeId: 'hier-flow',
      options: { direction: 'LR', layout: 'tight' },
      problems: [],
    });
    expect(parseHeadingInfo('-t pie').typeId).toBe('pie');
    expect(parseHeadingInfo('--line=thick struct-flow')).toEqual({
      typeId: 'struct-flow', options: { line: 'thick' }, problems: [],
    });
  });

  it('falls back to hier-flow and reports unknown tokens', () => {
    expect(parseHeadingInfo('')).toEqual({ typeId: 'hier-flow', options: {}, problems: [] });
    const info = parseHeadingInfo('flowchart --direction XX --bogus 1');
    expect(info.typeId).toBe('hier-flow');
    expect(info.options).toEqual({});
    expect(info.problems).toEqual(['flowchart', '--direction XX', '--bogus 1']);
  });

  it('builds a canonical info string', () => {
    expect(buildHeadingInfo('hier-flow', { direction: 'LR', layout: 'normal', curve: 'step' }))
      .toBe('hier-flow --direction LR --curve step');
    // direction is meaningless for struct-flow and pie takes no options
    expect(buildHeadingInfo('struct-flow', { direction: 'LR', line: 'thickArrow' })).toBe('struct-flow --line thickArrow');
    expect(buildHeadingInfo('pie', { direction: 'LR' })).toBe('pie');
    expect(buildHeadingOptionString('hier-block', { direction: 'RL' })).toBe('--direction RL');
    expect(buildHeadingOptionString('pie', {})).toBe('');
  });

  it('round-trips info strings', () => {
    const info = 'hier-block --direction BT --layout spacyXY --line dottedArrow --arrowDirection reverse';
    const parsed = parseHeadingInfo(info);
    expect(buildHeadingInfo(parsed.typeId, parsed.options)).toBe(info);
  });

  it('converts a block to Mermaid', () => {
    const result = convertHeadingBlock('# A\n## B', 'hier-flow', '--direction LR');
    expect(result.ok).toBe(true);
    expect(result.language).toBe('mermaid');
    expect(result.code).toContain('flowchart LR\nN1["A"] --- N1_1["B"]');
  });

  it('marks PlantUML output so the editor shows it as code', () => {
    const result = convertHeadingBlock('# A\n## B', 'table');
    expect(result.ok).toBe(true);
    expect(result.language).toBe('plantuml');
    expect(result.code).toBe('@startsalt\n{#\n| A | B\n}\n@endsalt');
  });

  it('returns the violated condition as an error', () => {
    const result = convertHeadingBlock('# A\n## B', 'quadrant');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('');
    expect(result.error).toContain('図種 quadrant の入力条件を満たさない');
  });

  it('lists the types a source can be drawn as', () => {
    expect(validHeadingTypes('# A\n## B:1\n## C:2')).toEqual([
      'hier-mind', 'hier-mindlabel', 'hier-block', 'hier-flow', 'fishBone', 'pie',
      'table', 'tablec', 'table1', 'table1c', 'table2', 'table2c', 'table3', 'table3c', 'struct-flow',
    ]);
  });
});
