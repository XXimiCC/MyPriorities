import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';

import AchGroup from './AchGroup.vue';
import PresetList from './PresetList.vue';
import ShotList from './ShotList.vue';
import './custom.css';

/*
 * Компоненты регистрируются глобально, чтобы страницы-справочники могли звать
 * их прямо из markdown. Все нужны по одной причине: markdown-таблица с v-for
 * внутри распадается — markdown-it закрывает <table> после заголовка, и
 * сгенерированные строки оказываются снаружи.
 */
const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('AchGroup', AchGroup);
    app.component('PresetList', PresetList);
    app.component('ShotList', ShotList);
  },
};

export default theme;
