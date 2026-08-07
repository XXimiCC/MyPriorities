<script setup>
/*
 * Таблица одной группы достижений.
 *
 * Отдельный компонент, а не markdown-таблица с v-for внутри: markdown-it
 * закрывает <table> сразу после заголовка, и сгенерированные <tr> оказываются
 * снаружи таблицы. Заголовки групп при этом остаются в markdown — ради якорей
 * и правого оглавления.
 */
defineProps({
  items: { type: Array, required: true },
});
</script>

<template>
  <table tabindex="0">
    <thead>
      <tr>
        <th>Название</th>
        <th>Условие</th>
        <th>Выдаётся</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="item in items" :key="item.id">
        <td>{{ item.title }}</td>
        <td>{{ item.note }}</td>
        <td>
          {{ item.kindLabel }}
          <template v-if="item.needsSkills"> · нужен модуль «Навыки»</template>
        </td>
      </tr>
    </tbody>
  </table>
</template>
