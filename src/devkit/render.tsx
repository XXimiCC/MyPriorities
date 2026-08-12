import { createRoot } from 'react-dom/client';

import { DevkitLayer } from './DevkitLayer';

/**
 * Единственное место, где панель трогает React.
 *
 * Вынесено из mount.ts намеренно: постановка панели обязана быть дешёвой на
 * любом сайте. Документация собрана на Vue, лендинг — вообще без фреймворка, и
 * тянуть туда React ради кнопки, которую большинство посетителей никогда не
 * нажмёт, значило бы платить сорок пять килобайт за инструмент отладки.
 *
 * Здесь же он приезжает ленивым куском вместе с самим слоем — и только тогда,
 * когда панель впервые открыли.
 */
export function renderDevkit(shell: HTMLElement, onClose: () => void): () => void {
  const root = createRoot(shell);
  root.render(<DevkitLayer onClose={onClose} />);
  return () => root.unmount();
}
