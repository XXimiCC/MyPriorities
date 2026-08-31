/**
 * «Скачать копию» — один обработчик на два экрана.
 *
 * Жил в настройках, пока копию предлагали только оттуда. Теперь то же самое
 * предлагает строка «только это устройство» на экране статистики, а два
 * одинаковых обработчика однажды разъедутся — и разойдутся они именно в том,
 * что здесь дописано последним: в отметке о снятой копии.
 */

import { t } from '../i18n';
import { alertDialog } from '../telegram/sdk';
import { saveFile } from '../wallpaper/save';
import type { StoreActions } from '../store/useStore';

export async function exportCopy(actions: StoreActions): Promise<void> {
  const json = actions.exportData();
  const blob = new Blob([json], { type: 'application/json' });
  const outcome = await saveFile(blob, 'my-priorities-backup.json', 'application/json');
  actions.award('r2');
  actions.markOnce('exported');
  if (outcome !== 'manual') return;

  // Долгое нажатие спасает картинку, но не JSON. Буфер обмена — единственный
  // путь забрать копию из клиента, который не умеет сохранять файлы.
  try {
    await navigator.clipboard.writeText(json);
    await alertDialog(t('settings.exportCopied'));
  } catch {
    await alertDialog(t('settings.exportFailed'));
  }
}
