<script setup>
/*
 * Состав всех готовых наборов. Цвет приоритета — тот же, каким он встанет
 * в приложении: список набора узнаётся по палитре не хуже, чем по названиям.
 */
defineProps({
  presets: { type: Array, required: true },
});
</script>

<template>
  <div class="plist">
    <section v-for="preset in presets" :key="preset.id" class="plist__item">
      <h3 class="plist__name" :style="{ color: preset.accent }">{{ preset.name }}</h3>
      <p class="plist__tagline">{{ preset.tagline }}</p>
      <ol class="plist__row">
        <li v-for="item in preset.priorities" :key="item.title" :style="{ color: item.hex }">
          {{ item.title }}
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.plist__item {
  padding: 16px 0;
  border-top: 1px solid var(--vp-c-divider);
}

.plist__name {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.plist__tagline {
  margin: 2px 0 10px;
  font-size: 14px;
  color: var(--vp-c-text-3);
}

.plist__row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: priority;
  font-size: 14px;
}

.plist__row li {
  margin: 0;
  counter-increment: priority;
}

.plist__row li::before {
  content: counter(priority) '. ';
  color: var(--vp-c-text-3);
}
</style>
