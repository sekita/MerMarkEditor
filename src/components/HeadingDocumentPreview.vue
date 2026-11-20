<script setup lang="ts">
/**
 * Whole-file heading preview: treats the document text as heading2diagram
 * input (exactly what `heading2diagram.py FILE` would read) and shows the
 * resulting diagram, with type / option pickers and the comparison gallery.
 * Read-only: the file is never modified; settings live in useHeadingPreview.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import mermaid from "mermaid";
import { useI18n } from "../i18n";
import { useZoomPan } from "../composables/useZoomPan";
import { useHeadingPreview } from "../composables/useHeadingPreview";
import HeadingDiagramGallery from "./HeadingDiagramGallery.vue";
import HeadingDiagramOptionBar from "./HeadingDiagramOptionBar.vue";
import {
  convertHeadingBlock,
  isHeadingTypeId,
  parseHeadingInfo,
  suggestHeadingType,
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
  markdown: string;
  /** File path, or `tab:<id>` for unsaved documents. */
  previewKey: string;
}>();

const { t } = useI18n();
const headingPreview = useHeadingPreview();

// Debounced source: conversion + Mermaid layout on every keystroke is wasteful.
const source = ref(props.markdown);
let sourceTimeout: ReturnType<typeof setTimeout> | null = null;
watch(() => props.markdown, (text) => {
  if (sourceTimeout) clearTimeout(sourceTimeout);
  sourceTimeout = setTimeout(() => { source.value = text; }, 300);
});

const ensureSettings = () => {
  const saved = headingPreview.get(props.previewKey);
  if (!saved?.typeId || !isHeadingTypeId(saved.typeId)) {
    headingPreview.update(props.previewKey, { typeId: suggestHeadingType(props.markdown), options: {} });
  }
};
watch(() => props.previewKey, () => {
  source.value = props.markdown;
  ensureSettings();
  needsFit = true;
});
ensureSettings();

const typeId = computed<string>(() => headingPreview.get(props.previewKey)?.typeId ?? suggestHeadingType(source.value));
const options = computed<ExplicitHeadingOptions>(() => {
  // Normalised through the parser so stale or hand-edited storage is harmless.
  const stored = headingPreview.get(props.previewKey)?.options ?? {};
  const optionString = Object.entries(stored).map(([name, value]) => `--${name} ${value}`).join(" ");
  return parseHeadingInfo(`${typeId.value} ${optionString}`).options;
});
const setType = (value: string) => headingPreview.update(props.previewKey, { typeId: value });
const setOptions = (value: ExplicitHeadingOptions) => headingPreview.update(props.previewKey, { options: value });

const conversion = computed(() => convertHeadingBlock(source.value, typeId.value, options.value));

const tab = ref<"preview" | "gallery">("preview");
const showCode = ref(false);
const showWarnings = ref(false);
const renderError = ref<string | null>(null);
const showCodePane = computed(() => conversion.value.ok && (showCode.value || conversion.value.language !== "mermaid"));

const viewportRef = ref<HTMLDivElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const {
  zoomPercent, transformStyle, zoomIn, zoomOut, resetZoom, fitToView,
  startPan, doPan, endPan, handleWheel,
} = useZoomPan();
const fit = () => fitToView(containerRef.value, viewportRef.value);
let needsFit = true;

const isDark = ref(isDocumentDark());
let renderToken = 0;

const render = async () => {
  const token = ++renderToken;
  renderError.value = null;
  await nextTick();
  const container = containerRef.value;
  if (!container || tab.value !== "preview") return;
  const result = conversion.value;
  if (!result.ok || result.language !== "mermaid") {
    container.innerHTML = "";
    return;
  }
  ensureElkLayoutLoaders();
  initializeMermaidForEditor(isDark.value);
  try {
    const { svg } = await mermaid.render(`mermaid-heading-file-${token}`, result.code.replace(/\\n/g, "<br/>"));
    if (token !== renderToken) return;
    container.innerHTML = svg;
    await fixMermaidViewBox(container);
    if (isDark.value) repaintMermaidDark(container);
    if (needsFit) {
      needsFit = false;
      await fit();
    }
  } catch (e: unknown) {
    if (token !== renderToken) return;
    container.innerHTML = "";
    renderError.value = e instanceof Error ? e.message : t.value.diagramError;
  }
};

watch(conversion, render);
watch(isDark, render);
watch(typeId, () => { needsFit = true; });
watch(tab, (value) => { if (value === "preview") render(); });
watch(showCodePane, (value) => { if (!value) render(); });

const adopt = (item: HeadingGalleryItem) => {
  headingPreview.update(props.previewKey, { typeId: item.typeId, options: item.options });
};
const adoptAndPreview = (item: HeadingGalleryItem) => {
  adopt(item);
  tab.value = "preview";
};

let darkObserver: MutationObserver | null = null;
onMounted(() => {
  render();
  darkObserver = new MutationObserver(() => { isDark.value = isDocumentDark(); });
  darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
});
onUnmounted(() => {
  renderToken++;
  if (sourceTimeout) clearTimeout(sourceTimeout);
  darkObserver?.disconnect();
});
</script>

<template>
  <div class="heading-file-preview" data-testid="heading-file-preview">
    <div class="heading-file-controls">
      <HeadingDiagramOptionBar
        :source="source"
        :type-id="typeId"
        :options="options"
        @update:type-id="setType"
        @update:options="setOptions"
      />
    </div>
    <div class="heading-file-toolbar">
      <div class="heading-file-tabs" role="tablist">
        <button
          role="tab"
          class="heading-file-tab"
          :class="{ active: tab === 'preview' }"
          :aria-selected="tab === 'preview'"
          data-testid="heading-file-tab-preview"
          @click="tab = 'preview'"
        >{{ t.headingDiagramPreviewTab }}</button>
        <button
          role="tab"
          class="heading-file-tab"
          :class="{ active: tab === 'gallery' }"
          :aria-selected="tab === 'gallery'"
          :title="t.headingDiagramGalleryHint"
          data-testid="heading-file-tab-gallery"
          @click="tab = 'gallery'"
        >{{ t.headingDiagramGalleryTab }}</button>
      </div>
      <template v-if="tab === 'preview'">
        <button class="heading-file-btn" :title="t.zoomOut" @click="zoomOut">−</button>
        <span class="heading-file-zoom">{{ zoomPercent }}%</span>
        <button class="heading-file-btn" :title="t.zoomIn" @click="zoomIn">+</button>
        <button class="heading-file-btn" @click="resetZoom">{{ t.reset }}</button>
        <button class="heading-file-btn" @click="fit">{{ t.fit }}</button>
        <button
          class="heading-file-btn"
          :class="{ active: showCodePane }"
          :disabled="!conversion.ok || conversion.language !== 'mermaid'"
          @click="showCode = !showCode"
        >{{ t.headingDiagramGeneratedCode }}</button>
      </template>
      <button
        v-if="conversion.warnings.length"
        class="heading-file-btn heading-file-warning-btn"
        :class="{ active: showWarnings }"
        data-testid="heading-file-warnings-toggle"
        @click="showWarnings = !showWarnings"
      >⚠ {{ conversion.warnings.length }}</button>
      <span class="heading-file-note" :title="t.headingPreviewFileNote">{{ t.headingPreviewFileNote }}</span>
    </div>
    <ul v-if="showWarnings && conversion.warnings.length" class="heading-file-warnings" data-testid="heading-file-warnings">
      <li v-for="(warning, index) in conversion.warnings" :key="index">{{ warning }}</li>
    </ul>

    <HeadingDiagramGallery
      v-if="tab === 'gallery'"
      :source="source"
      :type-id="typeId"
      :options="options"
      @select="adopt"
      @select-and-preview="adoptAndPreview"
    />
    <template v-else>
      <div v-if="!conversion.ok || renderError" class="heading-file-error" data-testid="heading-file-error">
        {{ conversion.error ?? renderError }}
      </div>
      <div v-if="showCodePane" class="heading-file-code-pane">
        <div v-if="conversion.language !== 'mermaid'" class="heading-file-code-note">{{ t.headingDiagramPlantumlNote }}</div>
        <pre class="heading-file-code" data-testid="heading-file-code">{{ conversion.code }}</pre>
      </div>
      <div
        v-show="!showCodePane && conversion.ok"
        ref="viewportRef"
        class="heading-file-viewport"
        @mousedown="startPan"
        @mousemove="doPan"
        @mouseup="endPan"
        @mouseleave="endPan"
        @wheel="handleWheel"
      >
        <div ref="containerRef" class="heading-file-content" data-testid="heading-file-diagram" :style="transformStyle"></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.heading-file-preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--bg-primary);
}

.heading-file-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-secondary);
}

.heading-file-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-primary);
}

.heading-file-tabs {
  display: inline-flex;
  margin-right: 6px;
  border: 1px solid var(--border-primary);
  border-radius: 5px;
  overflow: hidden;
  flex-shrink: 0;
}

.heading-file-tab {
  padding: 3px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: none;
  cursor: pointer;
}

.heading-file-tab + .heading-file-tab {
  border-left: 1px solid var(--border-primary);
}

.heading-file-tab.active {
  color: #fff;
  background: var(--primary);
}

.heading-file-btn {
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  cursor: pointer;
}

.heading-file-btn.active {
  color: var(--primary);
  border-color: var(--primary);
}

.heading-file-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.heading-file-warning-btn {
  color: var(--warning-color, #b45309);
}

.heading-file-zoom {
  min-width: 40px;
  font-size: 12px;
  text-align: center;
  color: var(--text-secondary);
}

.heading-file-note {
  flex: 1 1 220px;
  min-width: 0;
  text-align: right;
  overflow: hidden;
  font-size: 11px;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.heading-file-warnings {
  flex-shrink: 0;
  max-height: 25%;
  margin: 0;
  overflow: auto;
  padding: 6px 12px 6px 30px;
  font-size: 12px;
  color: var(--warning-color, #b45309);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
}

.heading-file-error {
  margin: 12px;
  padding: 10px 12px;
  font-size: 13px;
  white-space: pre-wrap;
  color: var(--error-color, #dc2626);
  background: color-mix(in srgb, var(--error-color, #dc2626) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--error-color, #dc2626) 40%, transparent);
  border-radius: 6px;
}

.heading-file-code-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.heading-file-code-note {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.heading-file-code {
  margin: 0;
  padding: 12px;
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  user-select: text;
}

.heading-file-viewport {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.heading-file-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100%;
  padding: 20px;
  transition: transform 0.1s ease-out;
}
</style>
