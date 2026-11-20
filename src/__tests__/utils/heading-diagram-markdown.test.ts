import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdown-converter';

const attr = (html: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? null;

describe('heading2diagram blocks in Markdown', () => {
  const source = [
    '# Title',
    '',
    '```heading2diagram hier-flow --direction LR',
    '# 会議の準備',
    '## スタ;資料作成:#FAF',
    '### |確認|実線矢印;提案書',
    '```',
    '',
    'After.',
  ].join('\n');

  it('loads a heading2diagram fence as a diagram node carrying the heading source', () => {
    const html = markdownToHtml(source);
    expect(html).toContain('data-type="mermaid"');
    expect(attr(html, 'data-heading-type')).toBe('hier-flow');
    expect(attr(html, 'data-heading-options')).toBe('--direction LR');
    expect(decodeURIComponent(attr(html, 'data-code')!)).toBe(
      '# 会議の準備\n## スタ;資料作成:#FAF\n### |確認|実線矢印;提案書',
    );
    // The headings inside the block must not become document headings.
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).not.toContain('<pre>');
  });

  it('saves the node back as the same fence', () => {
    expect(htmlToMarkdown(markdownToHtml(source))).toBe(source);
  });

  it('defaults to hier-flow and normalises the info string on save', () => {
    const md = '```heading2diagram\n# A\n## B\n```';
    const html = markdownToHtml(md);
    expect(attr(html, 'data-heading-type')).toBe('hier-flow');
    expect(attr(html, 'data-heading-options')).toBeNull();
    expect(htmlToMarkdown(html)).toBe('```heading2diagram hier-flow\n# A\n## B\n```');
  });

  it('drops options that do not apply to the type or equal the default', () => {
    const html = markdownToHtml('```heading2diagram pie --direction LR --layout normal\n# T\n## a:1\n```');
    expect(attr(html, 'data-heading-type')).toBe('pie');
    expect(attr(html, 'data-heading-options')).toBeNull();
  });

  it('keeps per-diagram attributes written before the fence', () => {
    const md = 'Text\n\n<!--mermaid-attrs:userWidth=480,printScale=50-->\n```heading2diagram struct-flow --layout tight\n# A\n# B\n```';
    const html = markdownToHtml(md);
    expect(attr(html, 'data-user-width')).toBe('480');
    expect(attr(html, 'data-print-scale')).toBe('50');
    expect(html).not.toContain('mermaid-attrs');
    expect(htmlToMarkdown(html)).toBe(md);
  });

  it('accepts tilde fences and keeps an empty block', () => {
    const html = markdownToHtml('~~~heading2diagram venn\n~~~');
    expect(attr(html, 'data-heading-type')).toBe('venn');
    expect(htmlToMarkdown(html)).toBe('```heading2diagram venn\n\n```');
  });

  it('uses a longer fence when the source contains a backtick fence line', () => {
    const html = '<div data-type="mermaid" data-heading-type="fishBone" data-code="'
      + encodeURIComponent('# A\n```\n## B') + '"></div>';
    const md = htmlToMarkdown(html);
    expect(md).toBe('````heading2diagram fishBone\n# A\n```\n## B\n````');
    expect(decodeURIComponent(attr(markdownToHtml(md), 'data-code')!)).toBe('# A\n```\n## B');
  });

  it('leaves ordinary Mermaid and code fences alone', () => {
    const md = '```mermaid\ngraph LR\n  A --> B\n```';
    const html = markdownToHtml(md);
    expect(html).not.toContain('data-heading-type');
    expect(htmlToMarkdown(html)).toBe(md);
  });

  it('shows a heading2diagram fence nested in another code block as code', () => {
    const md = '````md\n```heading2diagram hier-flow\n# A\n```\n````';
    const html = markdownToHtml(md);
    expect(html).not.toContain('data-heading-type');
    expect(html).toContain('<pre>');
  });

  it('does not treat dollar signs in headings as math', () => {
    const md = '```heading2diagram hier-flow\n# cost $5 and $6\n## x\n```';
    const html = markdownToHtml(md);
    expect(decodeURIComponent(attr(html, 'data-code')!)).toBe('# cost $5 and $6\n## x');
    expect(htmlToMarkdown(html)).toBe(md);
  });
});
