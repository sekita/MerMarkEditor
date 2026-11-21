<script setup lang="ts">
/**
 * Type and option pickers for heading-format (heading2diagram) diagrams.
 * Types the source cannot be drawn as are marked; only the options the
 * selected type understands are offered. The numeric `star` options
 * (degree / span / radius / blockWidth) are free text inputs with presets;
 * an invalid number is marked and not applied.
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "../i18n";
import {
  defaultHeadingOptions,
  isNumericHeadingOption,
  isValidHeadingOptionValue,
  meaningfulOptions,
  mermaidHeadingTypeIds,
  optionChoices,
  plantumlTypeIds,
  typeIdList,
  validHeadingTypes,
  type ExplicitHeadingOptions,
  type HeadingOptionName,
} from "../utils/heading2diagram";

const props = defineProps<{
  source: string;
  typeId: string;
  options: ExplicitHeadingOptions;
}>();

const emit = defineEmits<{
  "update:typeId": [typeId: string];
  "update:options": [options: ExplicitHeadingOptions];
}>();

const { t } = useI18n();

const plantumlHeadingTypeIds = typeIdList.filter((id) => plantumlTypeIds.has(id));
const optionNames = computed<readonly HeadingOptionName[]>(() => meaningfulOptions[props.typeId] ?? []);
const applicableTypes = computed(() => new Set(validHeadingTypes(props.source)));
const typeLabel = (typeId: string): string =>
  applicableTypes.value.has(typeId) ? typeId : `${typeId} (${t.value.headingDiagramNotApplicable})`;

const optionValue = (name: HeadingOptionName): string => props.options[name] ?? defaultHeadingOptions[name];

const setOption = (name: HeadingOptionName, value: string) => {
  const next = { ...props.options };
  if (value === defaultHeadingOptions[name]) delete next[name];
  else next[name] = value;
  emit("update:options", next);
};

// Numeric options: the text being typed, kept until it is a valid number.
const numericDrafts = ref<Partial<Record<HeadingOptionName, string>>>({});
watch(() => props.options, () => { numericDrafts.value = {}; });
const numericText = (name: HeadingOptionName): string => numericDrafts.value[name] ?? optionValue(name);
const isNumericInvalid = (name: HeadingOptionName): boolean => {
  const text = numericText(name).trim();
  return text !== "" && !isValidHeadingOptionValue(name, text);
};
const setNumericOption = (name: HeadingOptionName, raw: string) => {
  const text = raw.trim();
  numericDrafts.value = { ...numericDrafts.value, [name]: raw };
  if (text === "") setOption(name, defaultHeadingOptions[name]);
  else if (isValidHeadingOptionValue(name, text)) setOption(name, text);
};
</script>

<template>
  <label class="heading-control">
    <span>{{ t.headingDiagramType }}</span>
    <select
      class="heading-select"
      :value="typeId"
      data-testid="heading-type-select"
      @change="emit('update:typeId', ($event.target as HTMLSelectElement).value)"
    >
      <optgroup label="Mermaid">
        <option v-for="id in mermaidHeadingTypeIds" :key="id" :value="id">{{ typeLabel(id) }}</option>
      </optgroup>
      <optgroup label="PlantUML">
        <option v-for="id in plantumlHeadingTypeIds" :key="id" :value="id">{{ typeLabel(id) }}</option>
      </optgroup>
    </select>
  </label>
  <label v-for="name in optionNames" :key="name" class="heading-control">
    <span>{{ name }}</span>
    <template v-if="isNumericHeadingOption(name)">
      <input
        class="heading-select heading-number"
        :class="{ invalid: isNumericInvalid(name) }"
        type="text"
        inputmode="decimal"
        :value="numericText(name)"
        :placeholder="defaultHeadingOptions[name] === '' ? t.headingDiagramAuto : defaultHeadingOptions[name]"
        :title="isNumericInvalid(name) ? t.headingDiagramInvalidNumber : ''"
        :list="optionChoices[name].length ? `heading-option-presets-${name}` : undefined"
        :data-testid="`heading-option-${name}`"
        @change="setNumericOption(name, ($event.target as HTMLInputElement).value)"
      />
      <datalist v-if="optionChoices[name].length" :id="`heading-option-presets-${name}`">
        <option v-for="choice in optionChoices[name]" :key="choice" :value="choice" />
      </datalist>
    </template>
    <select
      v-else
      class="heading-select"
      :value="optionValue(name)"
      :data-testid="`heading-option-${name}`"
      @change="setOption(name, ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="choice in optionChoices[name]" :key="choice" :value="choice">{{ choice }}</option>
    </select>
  </label>
</template>

<style scoped>
.heading-control {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.heading-select {
  padding: 3px 6px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

.heading-number {
  width: 64px;
}

.heading-number.invalid {
  border-color: var(--danger);
}
</style>
