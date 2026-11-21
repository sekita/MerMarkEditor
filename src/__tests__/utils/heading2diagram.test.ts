import { describe, it, expect } from 'vitest';
import {
  buildHeadingGallery,
  buildHeadingInfo,
  buildHeadingOptionString,
  convertHeadingBlock,
  parseHeadingInfo,
  isValidHeadingOptionValue,
  runHeading2Diagram,
  validHeadingTypes,
  type ExplicitHeadingOptions,
} from '../../utils/heading2diagram';

// Inputs and reference outputs copied verbatim from
// https://github.com/sekita/heading2diagram/tree/main/examples (v1.1.0).
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

// Same table as tests/test_examples.py in the reference repository
// (Japanese inputs, then the English ones with the `_en` suffix).
const buildCases = (suffix: string): Array<[string, string, string, ExplicitHeadingOptions]> => {
  const input = (n: number) => `example${n}${suffix}.md`;
  const output = (n: number, name: string) => `out${n}${suffix}_${name}.md`;
  return [
    [input(1), output(1, 'hier-block'), 'hier-block', {}],
    [input(1), output(1, 'hier-flow'), 'hier-flow', {}],
    [input(1), output(1, 'hier-mind'), 'hier-mind', {}],
    [input(1), output(1, 'struct-flow_tight'), 'struct-flow', { layout: 'tight' }],
    [input(2), output(2, 'hier-block_LR_tight'), 'hier-block', { direction: 'LR', layout: 'tight' }],
    [input(2), output(2, 'hier-flow_LR'), 'hier-flow', { direction: 'LR' }],
    [input(2), output(2, 'hier-mindlabel_LR'), 'hier-mindlabel', { direction: 'LR' }],
    [input(2), output(2, 'struct-flow_tight'), 'struct-flow', { layout: 'tight' }],
    [input(3), output(3, 'fishBone'), 'fishBone', {}],
    [input(3), output(3, 'hier-flow_RL_thickArrow_arrowReverse'), 'hier-flow',
      { direction: 'RL', line: 'thickArrow', arrowDirection: 'reverse' }],
    [input(4), output(4, 'venn'), 'venn', {}],
    [input(5), output(5, 'table1c'), 'table1c', {}],
    [input(6), output(6, 'quadrant'), 'quadrant', {}],
    [input(7), output(7, 'pie'), 'pie', {}],
    [input(8), output(8, 'star'), 'star', {}],
    [input(8), output(8, 'star_degree30_dotted'), 'star', { degree: '30', line: 'dotted' }],
  ];
};
const referenceCases = [...buildCases(''), ...buildCases('_en')];

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
      // example1 has level-3 headings, so table and star are skipped
      ['hier-mind', 'hier-block', 'hier-flow', 'fishBone', 'struct-flow'],
    );
    expect(result.warnings).toContain('入力条件違反のためスキップする: pie: レベル3以上の節が存在してはならない');
    expect(result.warnings).toContain('入力条件違反のためスキップする: star: レベル3以上の節が存在してはならない');
  });

  it('fails an explicitly requested type whose condition is violated', () => {
    const result = runHeading2Diagram('# A\n# B', ['hier-flow']);
    expect(result.exitCode).toBe(1);
    expect(result.outputText).toBe('');
    expect(result.errors).toEqual(['入力条件違反: hier-flow: ルートがちょうど1個である必要がある（ルートが2個ある）']);
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
      'warning: line 4: "#" の直後に空白が無い（見出し行の書き間違いの可能性）。無視する',
      'warning: line 5: 見出し行でも空行でもない行である。無視する',
      'warning: line 1: レベル飛び（レベル3、直前の見出しはレベル0）。レベル1として扱う',
      'warning: line 3: レベル飛び（レベル3、直前の見出しはレベル1）。レベル2として扱う',
    ]);
  });

  it('reads CR / CRLF line ends and full-width blank lines like the CLI', () => {
    const result = runHeading2Diagram('# A\r## B\r\n\u3000\n## C', ['fishBone']);
    expect(result.log).toEqual([]);
    expect(result.blocks[0].body).toBe('ishikawa-beta\n  A\n    B\n    C');
  });

  it('keeps going after a failed explicit type and reports every violation', () => {
    const result = runHeading2Diagram('# A\n# B', ['quadrant', 'hier-flow', 'struct-flow']);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      '入力条件違反: quadrant: レベル2の節が各ルートにちょうど2個必要である（"A" の子は0個）',
      '入力条件違反: hier-flow: ルートがちょうど1個である必要がある（ルートが2個ある）',
    ]);
  });

  it('switches hier-mind to hier-mindlabel when labels are present', () => {
    const result = runHeading2Diagram('# A\n## |x|B', ['hier-mind']);
    expect(result.warnings).toEqual(['hier-mind: 入力にラベルが含まれるため hier-mindlabel として生成する']);
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

describe('heading2diagram star (v1.1.0)', () => {
  const star = '# Center\n## A\n## |label|solidArrow;B\n## C';

  it('places the peripherals clockwise from the top', () => {
    const result = runHeading2Diagram(star, ['star'], { span: '1' });
    expect(result.exitCode).toBe(0);
    expect(result.blocks[0].heading).toBe('## star (--span 1)');
    expect(result.blocks[0].body.split('\n').slice(0, 2)).toEqual(['block', expect.stringMatching(/^columns \d+$/)]);
    expect(result.blocks[0].body).toContain('N1 -- "label" ---> N1_2');
    expect(result.blocks[0].body).not.toContain(':1'); // span 1 has no suffix
  });

  it('validates the numeric options like argparse (exit status 2)', () => {
    expect(runHeading2Diagram(star, ['star'], { degree: 'abc' }).errors)
      .toEqual(["argument --degree: 数値でない値である: 'abc'"]);
    expect(runHeading2Diagram(star, ['star'], { span: '0' }).errors)
      .toEqual(["argument --span: 1以上の整数を指定すること: '0'"]);
    const radius = runHeading2Diagram(star, ['star'], { radius: '-1' });
    expect(radius.exitCode).toBe(2);
    expect(radius.errors).toEqual(["argument --radius: 正の数を指定すること: '-1'"]);
    expect(runHeading2Diagram(star, ['star'], { direction: 'XX' }).errors[0])
      .toBe("argument --direction: invalid choice: 'XX' (choose from 'TB', 'TD', 'BT', 'LR', 'RL')");
  });

  it('reports a radius that makes blocks overlap', () => {
    const result = runHeading2Diagram(star, ['star'], { radius: '1.5' });
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual(['入力条件違反: star: --radius 1.5 では周辺ブロックや線ラベルが重なる']);
  });

  it('requires exactly two levels', () => {
    expect(convertHeadingBlock('# A', 'star').error).toBe('入力条件違反: star: レベル2の節が1個以上必要である');
    expect(convertHeadingBlock('# A\n## B\n### C', 'star').error).toBe('入力条件違反: star: レベル3以上の節が存在してはならない');
  });

  it('accepts the numbers Python accepts', () => {
    expect(isValidHeadingOptionValue('degree', '-22.5')).toBe(true);
    expect(isValidHeadingOptionValue('degree', '1e1')).toBe(true);
    expect(isValidHeadingOptionValue('degree', '３０')).toBe(true);
    expect(isValidHeadingOptionValue('degree', 'inf')).toBe(false);
    expect(isValidHeadingOptionValue('span', '2.0')).toBe(false);
    expect(isValidHeadingOptionValue('radius', '0')).toBe(false);
    expect(isValidHeadingOptionValue('blockWidth', '120')).toBe(true);
    expect(isValidHeadingOptionValue('layout', 'tight')).toBe(true);
    expect(isValidHeadingOptionValue('layout', '30')).toBe(false);
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

  it('handles the numeric star options in info strings', () => {
    expect(parseHeadingInfo('star --degree 30 --span=2 --radius auto')).toEqual({
      typeId: 'star', options: { degree: '30', span: '2' }, problems: ['--radius auto'],
    });
    // defaults (degree 0, span 4) are dropped, options star does not understand too
    expect(buildHeadingInfo('star', { degree: '0', span: '4', line: 'dotted', radius: '120', direction: 'LR' }))
      .toBe('star --line dotted --radius 120');
    expect(buildHeadingInfo('hier-flow', { degree: '30' })).toBe('hier-flow');
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
    expect(result.error).toContain('入力条件違反: quadrant:');
  });

  it('lists the types a source can be drawn as', () => {
    expect(validHeadingTypes('# A\n## B:1\n## C:2')).toEqual([
      'hier-mind', 'hier-mindlabel', 'hier-block', 'hier-flow', 'fishBone', 'pie',
      'table', 'tablec', 'table1', 'table1c', 'table2', 'table2c', 'table3', 'table3c', 'struct-flow', 'star',
    ]);
  });
});

describe('heading2diagram gallery', () => {
  const tree = '# A\n## B\n## C\n### D';

  it('lists every applicable type with the current options', () => {
    const items = buildHeadingGallery(tree, 'hier-flow', { direction: 'LR', layout: 'tight' });
    const types = items.filter(item => item.group === 'type');
    expect(types.map(item => item.typeId)).toEqual(validHeadingTypes(tree));
    const flow = types.find(item => item.typeId === 'hier-flow')!;
    expect(flow.current).toBe(true);
    expect(flow.options).toEqual({ direction: 'LR', layout: 'tight' });
    expect(flow.conversion.code).toContain('flowchart LR');
    // options a type does not understand are not carried over
    expect(types.find(item => item.typeId === 'struct-flow')!.options).toEqual({ layout: 'tight' });
    expect(types.find(item => item.typeId === 'fishBone')!.options).toEqual({});
    expect(types.filter(item => item.current)).toHaveLength(1);
  });

  it('leaves hier-mind out when labels turn it into hier-mindlabel', () => {
    const types = buildHeadingGallery('# A\n## |x|B', 'hier-flow')
      .filter(item => item.group === 'type').map(item => item.typeId);
    expect(types).toContain('hier-mindlabel');
    expect(types).not.toContain('hier-mind');
  });

  it('varies one option at a time for the current type', () => {
    const items = buildHeadingGallery(tree, 'hier-block', { direction: 'LR' })
      .filter(item => item.group === 'option');
    expect([...new Set(items.map(item => item.optionName))]).toEqual(['direction', 'layout', 'line', 'arrowDirection']);
    expect(items).toHaveLength(5 + 6 + 6 + 2);
    const tight = items.find(item => item.optionName === 'layout' && item.label === 'tight')!;
    expect(tight.options).toEqual({ direction: 'LR', layout: 'tight' });
    expect(tight.current).toBe(false);
    const tb = items.find(item => item.optionName === 'direction' && item.label === 'TB')!;
    expect(tb.options).toEqual({}); // back to the default
    expect(items.filter(item => item.current).map(item => item.key))
      .toEqual(['option:direction:LR', 'option:layout:normal', 'option:line:solid', 'option:arrowDirection:default']);
    expect(items.every(item => item.conversion.ok)).toBe(true);
  });

  it('uses the presets of the numeric options for star', () => {
    const items = buildHeadingGallery('# C\n## A\n## B\n## D', 'star', { degree: '30' })
      .filter(item => item.group === 'option');
    expect([...new Set(items.map(item => item.optionName))])
      .toEqual(['layout', 'line', 'arrowDirection', 'degree', 'span']);
    expect(items).toHaveLength(6 + 6 + 2 + 4 + 4);
    expect(items.find(item => item.key === 'option:degree:30')!.current).toBe(true);
    expect(items.find(item => item.key === 'option:degree:0')!.options).toEqual({});
    expect(items.every(item => item.conversion.ok)).toBe(true);
  });

  it('offers no option cards for types without options', () => {
    const items = buildHeadingGallery('# T\n## a:1\n## b:2', 'pie');
    expect(items.filter(item => item.group === 'option')).toEqual([]);
    expect(items.find(item => item.typeId === 'pie')!.current).toBe(true);
  });

  it('is empty when no type can draw the source', () => {
    expect(buildHeadingGallery('not a heading', 'hier-flow').filter(item => item.group === 'type')).toEqual([]);
  });
});
