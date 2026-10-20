<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useAppStore } from '@/store/app';

const store = useAppStore();
const { message, messageOn } = storeToRefs(store);
</script>

<template>
  <div class="toast" :class="{ 'is-on': messageOn }" role="status">
    <span>{{ message }}</span>
  </div>
</template>
