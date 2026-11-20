<script setup lang="ts">
/**
 * Comparison gallery for heading-format (heading2diagram) sources: draws the
 * source with every applicable diagram type and with each value of each
 * option of the current type. Clicking a card emits `select`; double-click
 * emits `select-and-preview` (the parent usually switches back to its
 * full-size preview).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import mermaid from "mermaid";
import { useI18n } from "../i18n";
import {
  buildHeadingGallery,
  buildHeadingOptionString,
  meaningfulOptions,
  type ExplicitHeadingOptions,
  type HeadingGalleryItem,
} from "../utils/heading2diagram";
import {
  ensureElkLayoutLoaders,
  fixMermaidViewBox,
  initializeMermaidForEditor,
  isDocumentDark,
  repaintMermaidDark,
} from "../utils/mermaid-render-helpers";

const props = defineProps<{
  source: string;
  typeId: string;
  options: ExplicitHeadingOptions;
}>();

const emit = defineEmits<{
  select: [item: HeadingGalleryItem];
  "select-and-preview": [item: HeadingGalleryItem];
}>();

const { t } = useI18n();

// Debounced copy of the source: the gallery redraws dozens of diagrams.
const galleryCode = ref(props.source);
let codeTimeout: ReturnType<typeof setTimeout> | null = null;
watch(() => props.source, (code) => {
  if (codeTimeout) clearTimeout(codeTimeout);
  codeTimeout = setTimeout(() => { galleryCode.value = code; }, 500);
});

const items = computed<HeadingGalleryItem[]>(() =>
  buildHeadingGallery(galleryCode.value, props.typeId, props.options),
);
const typeItems = computed(() => items.value.filter((item) => item.group === "type"));
const optionGroups = computed(() =>
  (meaningfulOptions[props.typeId] ?? [])
    .map((name) => ({ name, items: items.value.filter((item) => item.optionName === name) }))
    .filter((group) => group.items.length > 0),
);

/** Card errors (conversion or Mermaid) by item key. */
const errors = ref<Record<string, string>>({});
const thumbs = new Map<string, HTMLElement>();
const setThumb = (key: string, el: unknown) => {
  if (el instanceof HTMLElement) thumbs.set(key, el);
  else thumbs.delete(key);
};
/** Rendered (and post-processed) SVG markup by theme + Mermaid source. */
const svgCache = new Map<string, string>();
let renderToken = 0;
const isDark = ref(isDocumentDark());

const render = async () => {
  const token = ++renderToken;
  const list = items.value;
  const nextErrors: Record<string, string> = {};
  for (const item of list) {
    if (!item.conversion.ok) nextErrors[item.key] = item.conversion.error ?? t.value.diagramError;
  }
  errors.value = nextErrors;
  if (!list.length) return;
  await nextTick();
  ensureElkLayoutLoaders();
  initializeMermaidForEditor(isDark.value);
  for (const [index, item] of list.entries()) {
    if (token !== renderToken) return; // superseded by a newer render
    if (!item.conversion.ok || item.conversion.language !== "mermaid") continue;
    const el = thumbs.get(item.key);
    if (!el) continue;
    const code = item.conversion.code;
    const cacheKey = `${isDark.value ? "dark" : "light"}\n${code}`;
    const cached = svgCache.get(cacheKey);
    if (cached !== undefined) {
      el.innerHTML = cached;
      continue;
    }
    el.innerHTML = '<span class="heading-gallery-loading">…</span>';
    try {
      const { svg } = await mermaid.render(`mermaid-gallery-${token}-${index}`, code.replace(/\\n/g, "<br/>"));
      if (token !== renderToken) return;
      el.innerHTML = svg;
      await fixMermaidViewBox(el);
      if (isDark.value) repaintMermaidDark(el);
      if (svgCache.size > 300) svgCache.clear();
      svgCache.set(cacheKey, el.innerHTML);
    } catch (e: unknown) {
      if (token !== renderToken) return;
      el.innerHTML = "";
      errors.value = { ...errors.value, [item.key]: e instanceof Error ? e.message : t.value.diagramError };
    }
  }
};

watch(items, () => { render(); });
watch(isDark, () => { render(); });

let darkObserver: MutationObserver | null = null;
onMounted(() => {
  render();
  darkObserver = new MutationObserver(() => { isDark.value = isDocumentDark(); });
  darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});
onUnmounted(() => {
  renderToken++;
  if (codeTimeout) clearTimeout(codeTimeout);
  darkObserver?.disconnect();
});

const cardTitle = (item: HeadingGalleryItem): string =>
  [item.typeId, buildHeadingOptionString(item.typeId, item.options)].filter(Boolean).join(" ");
</script>

<template>
  <div class="heading-gallery" data-testid="heading-gallery">
    <section class="heading-gallery-section">
      <h3 class="heading-gallery-title">{{ t.headingDiagramGalleryTypes }}</h3>
      <div v-if="!typeItems.length" class="heading-gallery-empty">{{ t.headingDiagramGalleryEmpty }}</div>
      <div class="heading-gallery-grid">
        <button
          v-for="item in typeItems"
          :key="item.key"
          class="heading-gallery-card"
          :class="{ current: item.current }"
          :title="cardTitle(item)"
          :data-testid="`heading-gallery-${item.key}`"
          @click="emit('select', item)"
          @dblclick="emit('select-and-preview', item)"
        >
          <div v-if="item.conversion.language !== 'mermaid'" class="heading-gallery-code">{{ item.conversion.code }}</div>
          <div v-else :ref="(el) => setThumb(item.key, el)" class="heading-gallery-thumb"></div>
          <div v-if="errors[item.key]" class="heading-gallery-error">{{ errors[item.key] }}</div>
          <div class="heading-gallery-label">
            <span>{{ item.label }}</span>
            <span v-if="item.conversion.language !== 'mermaid'" class="heading-gallery-tag">PlantUML</span>
            <span v-if="item.current" class="heading-gallery-tag current">{{ t.headingDiagramGalleryCurrent }}</span>
          </div>
        </button>
      </div>
    </section>
    <section v-if="optionGroups.length" class="heading-gallery-section">
      <h3 class="heading-gallery-title">{{ t.headingDiagramGalleryOptions }} — {{ typeId }}</h3>
      <div v-for="group in optionGroups" :key="group.name" class="heading-gallery-option-group">
        <h4 class="heading-gallery-subtitle">--{{ group.name }}</h4>
        <div class="heading-gallery-grid">
          <button
            v-for="item in group.items"
            :key="item.key"
            class="heading-gallery-card"
            :class="{ current: item.current }"
            :title="cardTitle(item)"
            :data-testid="`heading-gallery-${item.key}`"
            @click="emit('select', item)"
            @dblclick="emit('select-and-preview', item)"
          >
            <div v-if="item.conversion.ok && item.conversion.language !== 'mermaid'" class="heading-gallery-code">{{ item.conversion.code }}</div>
            <div v-else-if="item.conversion.ok" :ref="(el) => setThumb(item.key, el)" class="heading-gallery-thumb"></div>
            <div v-if="errors[item.key]" class="heading-gallery-error">{{ errors[item.key] }}</div>
            <div class="heading-gallery-label">
              <span>{{ item.label }}</span>
              <span v-if="item.current" class="heading-gallery-tag current">{{ t.headingDiagramGalleryCurrent }}</span>
            </div>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.heading-gallery {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 24px;
}

.heading-gallery-section + .heading-gallery-section {
  margin-top: 20px;
}

.heading-gallery-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.heading-gallery-subtitle {
  margin: 12px 0 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: "Fira Code", "Consolas", monospace;
  color: var(--text-secondary);
}

.heading-gallery-empty {
  font-size: 12px;
  color: var(--text-muted);
}

.heading-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.heading-gallery-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  text-align: left;
  color: inherit;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.heading-gallery-card:hover {
  border-color: var(--primary);
}

.heading-gallery-card.current {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 35%, transparent);
}

.heading-gallery-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 140px;
  overflow: hidden;
  pointer-events: none;
}

.heading-gallery-thumb :deep(svg) {
  max-width: 100% !important;
  max-height: 140px;
  width: auto;
  height: auto;
}

.heading-gallery-loading {
  color: var(--text-muted);
}

.heading-gallery-code {
  height: 140px;
  margin: 0;
  overflow: hidden;
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 10px;
  line-height: 1.35;
  white-space: pre;
  color: var(--text-secondary);
}

.heading-gallery-error {
  max-height: 60px;
  overflow: hidden;
  font-size: 11px;
  color: var(--error-color, #dc2626);
}

.heading-gallery-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: "Fira Code", "Consolas", monospace;
  color: var(--text-primary);
}

.heading-gallery-tag {
  padding: 0 5px;
  font-size: 10px;
  font-family: inherit;
  color: var(--text-muted);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.heading-gallery-tag.current {
  color: var(--primary);
  border-color: var(--primary);
}
</style>
