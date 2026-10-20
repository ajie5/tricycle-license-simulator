<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useAppStore } from '@/store/app';
import { NAV_GROUPS } from '@/data/navigation';
import OdIcon from '@/components/OdIcon.vue';
import { BANK_VERSION } from '@/data/lookups';

const store = useAppStore();
const route = useRoute();
const current = computed(() => String(route.name || 'home'));
</script>

<template>
  <aside class="sidebar" data-od-id="app-sidebar">
    <RouterLink class="brand" to="/home" aria-label="返回学习总览">
      <span class="brand-mark">D</span>
      <span class="brand-text">
        <strong>三轮车驾考</strong>
        <span>D 照 · 三轮摩托车</span>
      </span>
    </RouterLink>

    <RouterLink class="region-card" to="/bank" title="题库与地区设置">
      <span class="region-label">当前题库</span>
      <span class="region-line">
        <OdIcon name="pin" size="15px" />
        <b>{{ store.region }}</b>
        <span class="region-arrow"><OdIcon name="chevronRight" size="14px" /></span>
      </span>
      <span class="region-meta">{{ BANK_VERSION }} · 已校验</span>
    </RouterLink>

    <nav class="nav" aria-label="主导航">
      <template v-for="group in NAV_GROUPS" :key="group.label">
        <p class="nav-label">{{ group.label }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.view"
          class="nav-item"
          :class="{ 'is-active': current === item.view }"
          :to="'/' + item.view"
          :aria-current="current === item.view ? 'page' : undefined"
          :title="item.label"
        >
          <span class="nav-index">{{ item.index }}</span>
          <OdIcon :name="item.icon" size="18px" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </template>
    </nav>

    <div class="sidebar-foot">
      <i class="foot-dot"></i>省级题库已校验
      <p>离线可用 · 无广告 · 无需登录</p>
    </div>
  </aside>
</template>
