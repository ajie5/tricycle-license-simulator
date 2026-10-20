<script setup lang="ts">
import { computed } from 'vue';
import { clamp } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    /** 进度百分比 0—100 */
    value: number;
    /** 变体：neutral 深灰进度、thin 细条 */
    variant?: 'default' | 'neutral' | 'thin';
  }>(),
  { variant: 'default' }
);

const classes = computed(() => [
  'progress',
  props.variant === 'neutral' ? 'neutral' : '',
  props.variant === 'thin' ? 'thin' : '',
]);
const width = computed(() => `${clamp(props.value, 0, 100)}%`);
</script>

<template>
  <span :class="classes"><i :style="{ width }" /></span>
</template>
