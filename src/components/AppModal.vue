<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useAppStore } from '@/store/app';

const store = useAppStore();
const { modal } = storeToRefs(store);
</script>

<template>
  <div class="scrim" :hidden="!modal.open" @click.self="store.closeModal()">
    <div class="modal" tabindex="-1" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ modal.title }}</h3>
      </div>
      <div class="modal-body" v-html="modal.body" />
      <div class="modal-foot">
        <button
          v-for="action in modal.actions"
          :key="action.action + action.label"
          type="button"
          class="btn"
          :class="{
            'btn-primary': action.kind === 'primary',
            'btn-secondary': action.kind === 'secondary',
            'btn-danger': action.kind === 'danger',
          }"
          @click="store.handleModalAction(action.action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </div>
</template>
