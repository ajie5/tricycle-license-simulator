/* 应用入口：注册 Pinia、路由与全局样式 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@/App.vue';
import { router } from '@/router';
import '@/styles/app.css';
import '@/styles/practical.css';
import '@/styles/media.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
