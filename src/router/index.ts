/* 路由：使用 hash 模式，保证 Electron 以 file:// 加载打包产物时依然可用 */
import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/home' },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '学习总览' },
  },
  {
    path: '/practice',
    name: 'practice',
    component: () => import('@/views/PracticeView.vue'),
    meta: { title: '题库练习' },
  },
  {
    path: '/exam',
    name: 'exam',
    component: () => import('@/views/ExamView.vue'),
    meta: { title: '模拟考试' },
  },
  {
    path: '/practical',
    name: 'practical',
    component: () => import('@/views/PracticalView.vue'),
    meta: { title: '实操考试' },
  },
  {
    path: '/tutorial',
    name: 'tutorial',
    component: () => import('@/views/TutorialView.vue'),
    meta: { title: '图文 / 视频教程' },
  },
  {
    path: '/column',
    name: 'column',
    component: () => import('@/views/ColumnView.vue'),
    meta: { title: '安全驾驶专栏' },
  },
  {
    path: '/bank',
    name: 'bank',
    component: () => import('@/views/BankView.vue'),
    meta: { title: '题库与地区' },
  },
  {
    path: '/collect',
    name: 'collect',
    component: () => import('@/views/CollectView.vue'),
    meta: { title: '数据采集' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});
