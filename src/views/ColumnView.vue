<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/store/app';
import { ARTICLES } from '@/data/content';
import OdIcon from '@/components/OdIcon.vue';

const store = useAppStore();
const router = useRouter();

const CATS = ['全部', '日常使用', '安全驾驶', '法规常识'];
const category = computed(() => (CATS.includes(store.colCat) ? store.colCat : '全部'));
const openArticle = computed(() => ARTICLES.find((a) => a.id === store.colOpen) || null);
const readCount = computed(() => ARTICLES.filter((a) => store.readCol[a.id]).length);

const list = computed(() => ARTICLES.filter((a) => category.value === '全部' || a.cat === category.value));
const featured = computed(() => list.value[0] || null);
const rest = computed(() => list.value.slice(1));
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">安全驾驶专栏</h1>
      <p class="page-sub">
        不针对考试，只讲清一台三轮车每天都会遇到的风险 · 已读 {{ readCount }} / {{ ARTICLES.length }} 篇
      </p>
    </div>
    <div class="page-tools">
      <button class="btn btn-secondary" type="button" @click="router.push('/tutorial')">去看实操教程</button>
    </div>
  </div>

  <div v-if="openArticle" class="article-page">
    <button class="back-link" type="button" @click="store.closeArticle()">
      <OdIcon name="arrowLeft" size="14px" /> 返回专栏列表
    </button>
    <div class="card doc-body">
      <div class="chips">
        <span class="tag tag-accent">{{ openArticle.cat }}</span>
        <span class="tag">{{ openArticle.meta }}</span>
        <span class="tag tag-ok"><OdIcon name="check" size="13px" /> 已读</span>
      </div>
      <h2>{{ openArticle.title }}</h2>
      <p class="dek">{{ openArticle.dek }}</p>
      <div class="prose" v-html="openArticle.body" />
      <div class="doc-foot">
        <span class="src">{{ openArticle.meta }} · {{ openArticle.cat }}</span>
        <button class="btn btn-secondary btn-sm" type="button" @click="store.closeArticle()">返回专栏列表</button>
      </div>
    </div>
  </div>

  <template v-else>
    <div class="chips">
      <button
        v-for="c in CATS"
        :key="c"
        class="chip"
        type="button"
        :class="{ 'is-active': category === c }"
        @click="store.setColCat(c)"
      >
        {{ c }}
      </button>
    </div>

    <button
      v-if="featured"
      class="feature mt-16"
      type="button"
      @click="store.openArticle(featured.id)"
    >
      <span class="kicker on-dark"><i></i>{{ category === '全部' ? '本期特稿' : category }}</span>
      <span class="feature-title">{{ featured.title }}</span>
      <span class="feature-copy">{{ featured.dek }}</span>
      <span class="feature-meta">
        <span>{{ featured.meta }}</span>
        <span>{{ store.readCol[featured.id] ? '已读' : '未读' }}</span>
      </span>
    </button>

    <div class="article-grid mt-16">
      <button
        v-for="a in rest"
        :key="a.id"
        class="article-card"
        type="button"
        @click="store.openArticle(a.id)"
      >
        <span class="article-cat">{{ a.cat }}</span>
        <span class="article-title">{{ a.title }}</span>
        <span class="article-dek">{{ a.dek }}</span>
        <span class="article-meta">
          <span>{{ a.meta }}</span>
          <span>{{ store.readCol[a.id] ? '已读' : '未读' }}</span>
        </span>
      </button>
    </div>
  </template>
</template>
