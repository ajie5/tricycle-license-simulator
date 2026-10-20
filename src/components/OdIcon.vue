/* 图标组件：统一以 24×24 线性图标呈现，尺寸通过 CSS 变量控制 */
<script setup lang="ts">
import { computed } from 'vue';

const ICONS: Record<string, string> = {
  home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-5.5h5V20"/>',
  practice:
    '<path d="M8 6h11M8 12h11M8 18h11"/><circle cx="4.4" cy="6" r="1"/><circle cx="4.4" cy="12" r="1"/><circle cx="4.4" cy="18" r="1"/>',
  exam: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9 3h6"/>',
  practical:
    '<path d="M5 19V9.5M5 9.5 12 5l7 4.5M12 5v14"/><circle cx="5" cy="20.5" r="1.6"/><circle cx="12" cy="21" r="1.6"/><circle cx="19" cy="20.5" r="1.6"/>',
  collect: '<path d="M12 4v11"/><path d="m8.5 11.5 3.5 3.5 3.5-3.5"/><path d="M4.5 19.5h15"/>',
  tutorial: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="m10 9.5 5 3.5-5 3.5z"/>',
  column:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z"/>',
  bank: '<ellipse cx="12" cy="6.5" rx="7.5" ry="2.8"/><path d="M4.5 6.5v11c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-11"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.8l5.9-.9z"/>',
  flag: '<path d="M6 21V4h11l-1.8 4L17 12H6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13" stroke-width="2.2"/>',
  pin: '<path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  alert: '<path d="M12 4 3.6 20h16.8z"/><path d="M12 10v4"/><circle cx="12" cy="17.2" r=".7" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".7" fill="currentColor" stroke="none"/>',
};

const props = withDefaults(
  defineProps<{
    /** 图标名 */
    name: string;
    /** 尺寸，数字按 px 处理 */
    size?: string | number;
  }>(),
  { size: '1.1em' }
);

const style = computed(() => ({
  '--od-icon-size': typeof props.size === 'number' ? `${props.size}px` : props.size,
}));
</script>

<template>
  <svg
    class="od-icon"
    :style="style"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="ICONS[name] || ''"
  />
</template>
