<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAppStore } from '@/store/app';
import { SUBJECTS } from '@/data/content';
import { NAV_GROUPS } from '@/data/navigation';

const store = useAppStore();
const route = useRoute();
const current = computed(() => String(route.name || 'home'));

const allItems = NAV_GROUPS.flatMap((g) => g.items);
const brand = computed(() => allItems.find((i) => i.view === current.value)?.label || '学习总览');

const stats = computed(() => store.statsOf(store.subject));
</script>

<template>
  <header class="topbar" data-od-id="app-topbar">
    <div class="top-context">
      <span class="top-brand" aria-hidden="true">D</span>
      <div class="top-context-text">
        <strong>{{ brand }}</strong>
        <span>{{ store.region }} · {{ SUBJECTS[store.subject].name }}</span>
      </div>
    </div>
    <div class="top-actions">
      <span class="top-stat">
        累计 <b>{{ stats.seen }}</b> 题 · 正确率 <b>{{ stats.acc }}%</b>
      </span>
      <div class="seg seg-sm" role="group" aria-label="切换科目">
        <button
          type="button"
          :class="{ 'is-active': store.subject === 'k1' }"
          :aria-pressed="store.subject === 'k1'"
          @click="store.setSubject('k1')"
        >
          科目一
        </button>
        <button
          type="button"
          :class="{ 'is-active': store.subject === 'k4' }"
          :aria-pressed="store.subject === 'k4'"
          @click="store.setSubject('k4')"
        >
          科目四
        </button>
      </div>
      <span class="avatar" title="本机学习档案">学</span>
    </div>
  </header>
</template>
