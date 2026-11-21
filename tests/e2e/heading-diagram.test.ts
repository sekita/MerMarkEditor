import { test, expect, type Page } from '@playwright/test';
import { setupTauriMocks } from './helpers/tauri-mock';
import { openCodeView, openVisualView, getCodeEditorValue } from './helpers/code-editor';

const path = '/test/heading-diagram.md';

const fence = (info: string, lines: string[]): string =>
  ['```heading2diagram ' + info, ...lines, '```'].join('\n');

const meeting = [
  '# サブ;会議の準備',
  '## 議題の確定',
  '## スタ;資料作成:#FAF',
  '### 前回議事録',
  '### |確認|実線矢印;提案書',
];

const starSource = [
  '# 円形;会議の準備:#ffd',
  '## 議題の確定',
  '## |前回議事録|実線矢印;資料作成',
  '## 角丸;備品確認',
];

const diagrams = (page: Page) => page.locator('.ProseMirror .mermaid-wrapper');

test('heading-format blocks render as diagrams for every Mermaid-backed type', async ({ page }, testInfo) => {
  const doc = [
    '# Heading diagrams',
    fence('hier-flow --direction LR', meeting),
    fence('hier-block --layout tight', meeting),
    fence('struct-flow --line solidArrow', ['# 受付', '## 確認', '### 承認', '# 発送']),
    fence('fishBone', ['# 図表作成が容易', '## 環境構築が容易', '### 低コスト', '## 操作が容易', '### 直感的']),
    fence('pie', ['# 作業時間の内訳', '## 資料作成:60:#aff', '## 会場手配:40:#afa']),
    fence('venn', ['# 紙:30:#f88', '# 電子:20:#88f', '## 紙と電子:10']),
    fence('quadrant', [
      '# 費用が低い', '## 効果が小さい:#fee', '### 見送り', '### 現状維持', '## 効果が大きい', '### 優先実施',
      '# 費用が高い', '## 効果が小さい', '### 中止', '## 効果が大きい', '### 段階導入', '### 試行',
    ]),
    fence('star --degree 30', starSource),
    'End.',
  ].join('\n\n');
  await setupTauriMocks(page, { initialFs: { [path]: doc }, openFilePath: path });
  await page.goto('/');

  await expect(diagrams(page)).toHaveCount(8);
  const types = ['hier-flow', 'hier-block', 'struct-flow', 'fishBone', 'pie', 'venn', 'quadrant', 'star'];
  for (const [index, type] of types.entries()) {
    const diagram = diagrams(page).nth(index);
    await expect(diagram, type).toHaveAttribute('data-heading-type', type);
    await diagram.scrollIntoViewIfNeeded();
    await expect(diagram.locator('.mermaid-content svg'), `${type} renders an SVG`).toBeVisible();
    await expect(diagram.locator('.mermaid-error'), `${type} has no render error`).toHaveCount(0);
  }
  // The diagram shows the heading text, and the headings stay out of the document outline.
  await expect(diagrams(page).first().locator('.mermaid-content svg')).toContainText('会議の準備');
  await expect(diagrams(page).first().locator('.mermaid-content svg')).toContainText('確認');
  await expect(page.locator('.ProseMirror h1')).toHaveCount(1);
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);

  for (const [index, type] of types.entries()) {
    await diagrams(page).nth(index).scrollIntoViewIfNeeded();
    await diagrams(page).nth(index).screenshot({ path: testInfo.outputPath(`type-${type}.png`) });
  }
});

test('edit a heading-format block: text, type and options, then save the heading source', async ({ page }, testInfo) => {
  const original = ['Intro', '', fence('hier-flow', meeting), '', 'Outro'].join('\n');
  const fs = await setupTauriMocks(page, { initialFs: { [path]: original }, openFilePath: path });
  await page.goto('/');
  const diagram = diagrams(page).first();
  await expect(diagram.locator('.mermaid-content svg')).toContainText('会議の準備');
  await page.waitForTimeout(400); // initial hydration suppresses dirty events

  await diagram.hover();
  await diagram.getByTitle('Edit', { exact: true }).click();
  const editor = page.locator('.editor-fullscreen');
  await expect(editor.locator('.editor-topbar-title')).toHaveText('Heading Diagram Editor');
  const textarea = editor.locator('textarea');
  await expect(textarea).toHaveValue(meeting.join('\n'));
  const preview = editor.locator('.editor-preview-content svg');
  await expect(preview).toContainText('提案書');

  // Live preview follows the text.
  await textarea.fill([...meeting, '## 六角;会場手配:#0FF'].join('\n'));
  await expect(preview).toContainText('会場手配');

  // Options offered depend on the type; changing them redraws.
  await expect(editor.getByTestId('heading-option-curve')).toBeVisible();
  await editor.getByTestId('heading-type-select').selectOption('hier-block');
  await expect(editor.getByTestId('heading-option-curve')).toHaveCount(0);
  await editor.getByTestId('heading-option-direction').selectOption('LR');
  await editor.getByTestId('heading-option-layout').selectOption('tight');
  await expect(preview).toContainText('会場手配');

  // The generated Mermaid can be inspected.
  await editor.getByRole('button', { name: 'Generated code' }).click();
  await expect(editor.getByTestId('heading-generated-code')).toContainText('block\ncolumns 4');
  await editor.getByRole('button', { name: 'Generated code' }).click();
  await page.screenshot({ path: testInfo.outputPath('heading-editor.png') });

  // A type whose condition the text violates explains why, and typos are warned about.
  await editor.getByTestId('heading-type-select').selectOption('pie');
  await expect(editor.getByTestId('heading-error')).toContainText('入力条件違反: pie:');
  await editor.getByTestId('heading-type-select').selectOption('hier-block');
  await expect(editor.getByTestId('heading-error')).toHaveCount(0);
  await textarea.fill([...meeting, '## 六角;会場手配:#0FF', '##typo'].join('\n'));
  await expect(editor.getByTestId('heading-warnings')).toContainText('line 7: "#" の直後に空白が無い');
  await textarea.fill([...meeting, '## 六角;会場手配:#0FF'].join('\n'));
  await expect(editor.getByTestId('heading-warnings')).toHaveCount(0);

  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(diagram).toHaveAttribute('data-heading-type', 'hier-block');
  await expect(diagram.locator('.mermaid-content svg')).toContainText('会場手配');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const expected = [
    'Intro', '',
    fence('hier-block --direction LR --layout tight', [...meeting, '## 六角;会場手配:#0FF']),
    '', 'Outro',
  ].join('\n');
  await expect.poll(() => fs.getFs()[path]).toBe(expected);

  // The source view shows (and can edit) the heading text; the diagram survives the round trip.
  await openCodeView(page);
  expect(await getCodeEditorValue(page)).toContain('```heading2diagram hier-block --direction LR --layout tight\n# サブ;会議の準備');
  await page.waitForTimeout(500); // allow the view's cursor/scroll restoration to finish
  await openVisualView(page);
  await expect(diagrams(page).first().locator('.mermaid-content svg')).toContainText('会場手配');

  await page.reload();
  await expect(diagrams(page).first()).toHaveAttribute('data-heading-type', 'hier-block');
  await expect(diagrams(page).first().locator('.mermaid-content svg')).toContainText('会場手配');
});

test('star: the numeric options are typed in, checked and saved', async ({ page }, testInfo) => {
  const original = ['Intro', '', fence('star', starSource), '', 'Outro'].join('\n');
  const fs = await setupTauriMocks(page, { initialFs: { [path]: original }, openFilePath: path });
  await page.goto('/');
  const diagram = diagrams(page).first();
  await expect(diagram.locator('.mermaid-content svg')).toContainText('備品確認');
  await page.waitForTimeout(400); // initial hydration suppresses dirty events

  await diagram.hover();
  await diagram.getByTitle('Edit', { exact: true }).click();
  const editor = page.locator('.editor-fullscreen');
  await expect(editor.getByTestId('heading-type-select')).toHaveValue('star');
  await expect(editor.getByTestId('heading-option-direction')).toHaveCount(0);
  const degree = editor.getByTestId('heading-option-degree');
  await expect(degree).toHaveValue('0');
  await expect(editor.getByTestId('heading-option-radius')).toHaveAttribute('placeholder', 'auto');

  // An invalid number is marked and not applied; a valid one is.
  await degree.fill('abc');
  await degree.press('Enter');
  await expect(degree).toHaveClass(/invalid/);
  await degree.fill('45');
  await degree.press('Enter');
  await expect(degree).not.toHaveClass(/invalid/);
  await expect(degree).toHaveValue('45');
  await editor.getByTestId('heading-option-line').selectOption('dotted');
  await expect(editor.getByTestId('heading-error')).toHaveCount(0);
  await expect(editor.locator('.editor-preview-content svg')).toContainText('会議の準備');
  await page.screenshot({ path: testInfo.outputPath('star-editor.png') });

  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const expected = ['Intro', '', fence('star --line dotted --degree 45', starSource), '', 'Outro'].join('\n');
  await expect.poll(() => fs.getFs()[path]).toBe(expected);
});

test('an untouched document with a heading-format block saves byte-identically', async ({ page }) => {
  // Hand-written info string (default option spelled out, tilde fence) must not be rewritten.
  const original = 'Intro\n\n~~~heading2diagram hier-flow --layout normal --direction LR\n# A\n## B\n~~~\n\nOutro text\n';
  const fs = await setupTauriMocks(page, { initialFs: { [path]: original }, openFilePath: path });
  await page.goto('/');
  await expect(diagrams(page).first().locator('.mermaid-content svg')).toContainText('A');
  await page.waitForTimeout(400);
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toBe(original.replace('Outro text', 'Outro text!'));
});

test('toolbar inserts a heading-format block; PlantUML types show the generated code; convert to Mermaid', async ({ page }, testInfo) => {
  const fs = await setupTauriMocks(page, { initialFs: { [path]: 'Start\n' }, openFilePath: path });
  await page.goto('/');
  await expect(page.locator('.ProseMirror p').first()).toHaveText('Start');
  await page.waitForTimeout(400);
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('End');
  await page.locator('.heading-diagram-btn').click();

  const diagram = diagrams(page).first();
  await expect(diagram).toHaveAttribute('data-heading-type', 'hier-flow');
  await expect(diagram.locator('.mermaid-content svg')).toContainText('会議の準備');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toContain('```heading2diagram hier-flow\n# 会議の準備\n## 議題の確定');

  // PlantUML-backed type: no preview, the generated code is shown instead.
  await diagram.hover();
  await diagram.getByTitle('Edit', { exact: true }).click();
  const editor = page.locator('.editor-fullscreen');
  await editor.getByTestId('heading-type-select').selectOption('hier-mind');
  await expect(editor.getByTestId('heading-generated-code')).toContainText('@startmindmap');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(diagram.locator('.heading-generated-code')).toContainText('@startmindmap');
  await expect(diagram.locator('.heading-generated-code')).toContainText('* 会議の準備');
  await diagram.screenshot({ path: testInfo.outputPath('plantuml-code.png') });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toContain('```heading2diagram hier-mind\n# 会議の準備');

  // Sample button + convert to plain Mermaid for manual fine-tuning.
  await diagram.hover();
  await diagram.getByTitle('Edit', { exact: true }).click();
  await editor.getByTestId('heading-type-select').selectOption('pie');
  await editor.getByRole('button', { name: 'Sample', exact: true }).click();
  await expect(editor.locator('.editor-preview-content svg')).toContainText('作業時間の内訳');
  await editor.getByRole('button', { name: 'Convert to Mermaid' }).click();
  await expect(editor.locator('.editor-topbar-title')).toHaveText('Mermaid Editor');
  await expect(editor.locator('textarea')).toHaveValue(/pie showData\ntitle 作業時間の内訳/);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(diagram).not.toHaveAttribute('data-heading-type', /.+/);
  await expect(diagram.locator('.mermaid-content svg')).toContainText('作業時間の内訳');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toContain('```mermaid\n%%{init: {"theme":"base"');
  expect(fs.getFs()[path]).not.toContain('heading2diagram');
});

test('compare tab: every type and option value side by side, click to adopt', async ({ page }, testInfo) => {
  const original = ['Intro', '', fence('hier-flow', meeting), '', 'Outro'].join('\n');
  const fs = await setupTauriMocks(page, { initialFs: { [path]: original }, openFilePath: path });
  await page.goto('/');
  const diagram = diagrams(page).first();
  await expect(diagram.locator('.mermaid-content svg')).toContainText('会議の準備');
  await page.waitForTimeout(400);

  await diagram.hover();
  await diagram.getByTitle('Edit', { exact: true }).click();
  const editor = page.locator('.editor-fullscreen');
  await editor.getByTestId('heading-tab-gallery').click();
  const gallery = editor.getByTestId('heading-gallery');
  await expect(gallery).toBeVisible();

  // Type cards: only the types the text fits; Mermaid ones drawn, PlantUML ones as code.
  const typeCard = (type: string) => gallery.getByTestId(`heading-gallery-type:${type}`);
  for (const type of ['hier-mindlabel', 'hier-block', 'hier-flow', 'fishBone', 'struct-flow']) {
    await expect(typeCard(type), type).toBeVisible();
  }
  await expect(typeCard('pie')).toHaveCount(0);
  await expect(typeCard('hier-mind')).toHaveCount(0); // labels present -> hier-mindlabel
  await expect(typeCard('hier-flow')).toHaveClass(/current/);
  await expect(typeCard('hier-block').locator('svg')).toContainText('会議の準備');
  await expect(typeCard('hier-mindlabel')).toContainText('@startmindmap');

  // Option cards for the current type (hier-flow has 5 options, 29 values).
  const optionCards = gallery.locator('[data-testid^="heading-gallery-option:"]');
  await expect(optionCards).toHaveCount(5 + 6 + 6 + 2 + 10);
  await expect(gallery.locator('[data-testid^="heading-gallery-option:"] svg')).toHaveCount(29, { timeout: 30_000 });
  await expect(gallery.getByTestId('heading-gallery-option:direction:TB')).toHaveClass(/current/);
  await page.screenshot({ path: testInfo.outputPath('gallery-hier-flow.png') });

  // Click an option card: the option pickers follow, and the gallery re-centres on it.
  await gallery.getByTestId('heading-gallery-option:direction:LR').click();
  await expect(editor.getByTestId('heading-option-direction')).toHaveValue('LR');
  await expect(gallery.getByTestId('heading-gallery-option:direction:LR')).toHaveClass(/current/);
  await expect(gallery.getByTestId('heading-gallery-option:direction:TB')).not.toHaveClass(/current/);

  // Click a type card: the type changes and the option section switches to it.
  await typeCard('hier-block').click();
  await expect(editor.getByTestId('heading-type-select')).toHaveValue('hier-block');
  await expect(optionCards).toHaveCount(5 + 6 + 6 + 2);
  await expect(gallery.getByTestId('heading-gallery-option:direction:LR')).toHaveClass(/current/); // carried over
  await gallery.getByTestId('heading-gallery-option:layout:tight').click();
  await expect(gallery.locator('[data-testid^="heading-gallery-option:"] svg')).toHaveCount(19, { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('gallery-hier-block.png') });

  // Editing the text refreshes the gallery.
  await editor.locator('textarea').fill([...meeting, '## 追加項目'].join('\n'));
  await expect(typeCard('hier-block').locator('svg')).toContainText('追加項目');

  // Double-click: adopt and go back to the full-size preview.
  await gallery.getByTestId('heading-gallery-option:line:dottedArrow').dblclick();
  await expect(gallery).toHaveCount(0);
  await expect(editor.getByTestId('heading-option-line')).toHaveValue('dottedArrow');
  await expect(editor.locator('.editor-preview-content svg')).toContainText('追加項目');

  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toBe([
    'Intro', '',
    fence('hier-block --direction LR --layout tight --line dottedArrow', [...meeting, '## 追加項目']),
    '', 'Outro',
  ].join('\n'));
});

const outlineFile = [
  '分類・階層図 hier-mind, hier-block, hier-flow 構造化フローチャート struct-flow 因果関係 fishbone',
  '',
  '# A1',
  '## A11',
  '## A12',
  '### A121',
  '',
].join('\n');

test('convert headings in the document into a heading-format diagram', async ({ page }) => {
  const fs = await setupTauriMocks(page, { initialFs: { [path]: outlineFile }, openFilePath: path });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1')).toHaveText('A1');
  await page.waitForTimeout(400);
  const button = page.locator('.headings-to-diagram-btn');

  // Not available while the cursor is in ordinary text.
  await page.locator('.ProseMirror p').first().click();
  await expect(button).toBeDisabled();

  // Cursor in any heading: the whole run of headings becomes one diagram.
  await page.locator('.ProseMirror h2').first().click();
  await expect(button).toBeEnabled();
  await button.click();
  const diagram = diagrams(page).first();
  await expect(diagram).toHaveAttribute('data-heading-type', 'hier-flow');
  await expect(diagram.locator('.mermaid-content svg')).toContainText('A121');
  await expect(page.locator('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')).toHaveCount(0);
  await expect(page.locator('.ProseMirror p').first()).toContainText('分類・階層図');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fs.getFs()[path]).toBe([
    '分類・階層図 hier-mind, hier-block, hier-flow 構造化フローチャート struct-flow 因果関係 fishbone',
    '',
    fence('hier-flow', ['# A1', '## A11', '## A12', '### A121']),
    '',
  ].join('\n'));

  // Undo brings the headings back.
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ProseMirror h3')).toHaveText('A121');
  await expect(diagrams(page)).toHaveCount(0);
});

test('preview the whole file as a heading diagram without changing it', async ({ page }, testInfo) => {
  const multiRoot = outlineFile + '# B1\n## B11\n';
  const fs = await setupTauriMocks(page, { initialFs: { [path]: multiRoot }, openFilePath: path });
  await page.goto('/');
  await expect(page.locator('.ProseMirror h1').first()).toHaveText('A1');
  await page.waitForTimeout(400);

  await page.locator('.heading-preview-btn').click();
  const preview = page.getByTestId('heading-file-preview');
  await expect(preview).toBeVisible();
  await expect(page.locator('.heading-preview-btn')).toHaveClass(/active/);
  // Two roots: hier-flow does not fit, so struct-flow is picked.
  await expect(preview.getByTestId('heading-type-select')).toHaveValue('struct-flow');
  await expect(preview.getByTestId('heading-file-diagram').locator('svg')).toContainText('B11');
  // The descriptive first line is ignored with a warning, as heading2diagram.py does.
  await preview.getByTestId('heading-file-warnings-toggle').click();
  await expect(preview.getByTestId('heading-file-warnings')).toContainText('line 1: 見出し行でも空行でもない行である。無視する');

  // A type the input does not fit explains why.
  await preview.getByTestId('heading-type-select').selectOption('hier-flow');
  await expect(preview.getByTestId('heading-file-error')).toContainText('ルートがちょうど1個である必要がある（ルートが2個ある）');

  // Gallery: pick a type and an option by clicking.
  await preview.getByTestId('heading-file-tab-gallery').click();
  const gallery = preview.getByTestId('heading-gallery');
  await expect(gallery.getByTestId('heading-gallery-type:struct-flow').locator('svg')).toContainText('A121');
  await gallery.getByTestId('heading-gallery-type:struct-flow').click();
  await expect(preview.getByTestId('heading-type-select')).toHaveValue('struct-flow');
  await gallery.getByTestId('heading-gallery-option:layout:tight').dblclick();
  await expect(preview.getByTestId('heading-option-layout')).toHaveValue('tight');
  await expect(preview.getByTestId('heading-file-diagram').locator('svg')).toContainText('A121');
  await page.screenshot({ path: testInfo.outputPath('heading-file-preview.png') });

  // Editing the file text on the left redraws the diagram.
  const code = page.locator('.split-editor-code .cm-content');
  await code.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('## B12');
  await expect(preview.getByTestId('heading-file-diagram').locator('svg')).toContainText('B12');

  // Switch the pane back to Markdown and again to the diagram.
  await page.getByTestId('split-preview-mode-markdown').click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.split-editor-preview .ProseMirror h1').first()).toHaveText('A1');
  await page.getByTestId('split-preview-mode-heading').click();
  await expect(page.getByTestId('heading-file-preview').getByTestId('heading-option-layout')).toHaveValue('tight');

  // Turning the preview off returns to the normal editor; the file on disk was never written.
  await page.locator('.heading-preview-btn').click();
  await expect(page.getByTestId('heading-file-preview')).toHaveCount(0);
  await expect(page.locator('.split-editor-area')).toHaveCount(0);
  expect(fs.getFs()[path]).toBe(multiRoot);

  // The chosen type and options are remembered for the file.
  await page.reload();
  await expect(page.locator('.ProseMirror h1').first()).toHaveText('A1');
  await page.locator('.heading-preview-btn').click();
  await expect(page.getByTestId('heading-file-preview').getByTestId('heading-type-select')).toHaveValue('struct-flow');
  await expect(page.getByTestId('heading-file-preview').getByTestId('heading-option-layout')).toHaveValue('tight');
});
