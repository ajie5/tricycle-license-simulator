<script setup lang="ts">
/* 章节掌握状态标签：按已练题量与正确率给出结论 */
defineProps<{ seen: number; total: number; acc: number }>();
</script>

<template>
  <span v-if="!seen" class="tag">未开始</span>
  <span v-else-if="seen >= total && acc >= 85" class="tag tag-ok">已掌握</span>
  <span v-else-if="acc >= 85" class="tag tag-accent">正确率高</span>
  <span v-else class="tag tag-warn">待巩固</span>
</template>
