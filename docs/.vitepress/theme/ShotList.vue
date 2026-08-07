<script setup>
/*
 * Таблица снимков одного прогона. Отдельный компонент по той же причине, что и
 * AchGroup: markdown-таблица с v-for внутри распадается.
 */
defineProps({
  shots: { type: Array, required: true },
});
</script>

<template>
  <table tabindex="0">
    <thead>
      <tr>
        <th>Имя</th>
        <th>Что на кадре</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="shot in shots" :key="shot.name">
        <td>
          <code>{{ shot.name }}</code>
          <template v-if="shot.tall"> · длинный</template>
          <template v-if="shot.cropped"> · кроп</template>
        </td>
        <td>{{ shot.note }}</td>
      </tr>
    </tbody>
  </table>
</template>
