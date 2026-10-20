<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { useAppStore } from '@/store/app';
import AppSidebar from '@/components/AppSidebar.vue';
import AppTopbar from '@/components/AppTopbar.vue';
import AppMobileNav from '@/components/AppMobileNav.vue';
import AppModal from '@/components/AppModal.vue';
import AppToast from '@/components/AppToast.vue';

const store = useAppStore();
const route = useRoute();
const current = computed(() => String(route.name || 'home'));

/** 标题同步到窗口标题 */
watch(
  () => route.meta.title,
  (title) => {
    document.title = `${title || '学习总览'} · 三轮车驾考`;
  },
  { immediate: true }
);

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timer = setInterval(() => store.tickClock(), 1000);
  document.addEventListener('keydown', onKeydown);
  // 启动时装载采集题库与采集状态（桌面端可用，浏览器端自动跳过）
  store.loadCollectedBank().then(() => store.refreshCollectorStatus());
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('keydown', onKeydown);
});

/** 全局快捷键：练习与模拟考试均可用键盘作答 */
function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  if (store.modal.open) {
    if (e.key === 'Escape') {
      e.preventDefault();
      store.closeModal();
    }
    return;
  }

  const k = e.key.toLowerCase();
  const digit = /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
  const letter = /^[a-f]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
  const pickIndex = digit > -1 ? digit : letter;

  if (current.value === 'practice' && store.practice && !store.practice.done) {
    if (k === 'f') {
      e.preventDefault();
      store.toggleFav();
    } else if (pickIndex > -1) {
      e.preventDefault();
      store.pickOption(pickIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (store.practice.checked) store.practiceNext();
      else if (store.practice.picked.length) store.checkPractice();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      store.practiceNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      store.practicePrev();
    }
    return;
  }

  if (current.value === 'exam' && store.exam && store.exam.state === 'running') {
    if (pickIndex > -1) {
      e.preventDefault();
      store.examPick(pickIndex);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      store.examMove(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      store.examMove(-1);
    }
  }
}
</script>

<template>
  <a class="skip" href="#viewport">跳到主要内容</a>
  <div class="app">
    <AppSidebar />
    <div class="main">
      <AppTopbar />
      <main id="viewport" class="viewport" tabindex="-1">
        <div class="canvas">
          <section :key="current" class="view is-active" :id="'view-' + current">
            <RouterView />
          </section>
        </div>
      </main>
    </div>
  </div>
  <AppMobileNav />
  <AppModal />
  <AppToast />
</template>
