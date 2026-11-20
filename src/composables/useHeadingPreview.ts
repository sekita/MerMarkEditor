/**
 * Per-file state of the whole-file heading preview (Code + Preview pane shown
 * as a heading2diagram diagram instead of rendered Markdown).
 *
 * The file itself is never touched: the chosen type and options are kept in
 * localStorage, keyed by file path (or tab id for unsaved documents).
 */
import { reactive } from 'vue';
import type { ExplicitHeadingOptions } from '../utils/heading2diagram';

export interface HeadingPreviewSettings {
  enabled: boolean;
  typeId: string | null;
  options: ExplicitHeadingOptions;
  /** Last use, for trimming old entries. */
  usedAt: number;
}

const STORAGE_KEY = 'mermark.headingPreview.v1';
const MAX_ENTRIES = 200;

function load(): Record<string, HeadingPreviewSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const state = reactive<Record<string, HeadingPreviewSettings>>(load());

function persist(): void {
  try {
    const entries = Object.entries(state)
      .filter(([key]) => !key.startsWith('tab:')) // unsaved documents: session only
      .sort((a, b) => b[1].usedAt - a[1].usedAt)
      .slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // storage unavailable or full: keep the in-memory state only
  }
}

function entry(key: string): HeadingPreviewSettings {
  if (!state[key]) state[key] = { enabled: false, typeId: null, options: {}, usedAt: Date.now() };
  return state[key];
}

export function useHeadingPreview() {
  return {
    get: (key: string): HeadingPreviewSettings | null => state[key] ?? null,
    isEnabled: (key: string): boolean => !!state[key]?.enabled,
    setEnabled(key: string, enabled: boolean): void {
      const item = entry(key);
      item.enabled = enabled;
      item.usedAt = Date.now();
      persist();
    },
    update(key: string, settings: { typeId?: string; options?: ExplicitHeadingOptions }): void {
      const item = entry(key);
      if (settings.typeId !== undefined) item.typeId = settings.typeId;
      if (settings.options !== undefined) item.options = { ...settings.options };
      item.usedAt = Date.now();
      persist();
    },
  };
}
