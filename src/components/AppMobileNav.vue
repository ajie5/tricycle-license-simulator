<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { MOBILE_ITEMS } from '@/data/navigation';
import OdIcon from '@/components/OdIcon.vue';

const route = useRoute();
const current = computed(() => String(route.name || 'home'));
</script>

<template>
  <nav class="mobile-nav" aria-label="移动端导航">
    <RouterLink
      v-for="item in MOBILE_ITEMS"
      :key="item.view"
      class="nav-item"
      :class="{ 'is-active': current === item.view }"
      :to="'/' + item.view"
      :aria-current="current === item.view ? 'page' : undefined"
    >
      <span class="nav-index">{{ item.index }}</span>
      <OdIcon :name="item.icon" size="21px" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>
