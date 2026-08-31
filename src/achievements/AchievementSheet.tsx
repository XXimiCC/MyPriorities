import { useState } from 'react';

import { Sheet } from '../components/Sheet';
import { formatDayFull } from '../domain/date';
import { t } from '../i18n';
import { alertDialog, confirmDialog, haptics } from '../telegram/sdk';
import { canvasToBlob, saveFile, waitForFonts } from '../wallpaper/save';
import { renderCard } from './card';
import { accentOf, GROUP_ICONS } from './icons';
import { titleOf } from './note';
import type { Achievement } from './types';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

interface Props {
  item: Achievement | null;
  gotOn?: string;
  note: string;
  onClose(): void;
  onMark(): void;
  onUnmark(): void;
}

export function AchievementSheet({ item, gotOn, note, onClose, onMark, onUnmark }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const color = item ? accentOf(item.group) : undefined;

  const share = (): void => {
    if (!item || !color || busy) return;
    setBusy(true);
    void (async () => {
      try {
        await waitForFonts();
        const canvas = document.createElement('canvas');
        renderCard(canvas, {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          title: titleOf(item),
          note,
          footer: gotOn ? t('ach.gotOn', { day: formatDayFull(gotOn) }) : t('ach.locked'),
          eyebrow: t(`ach.g.${item.group}`),
          accent: color.hex,
          accentSoft: color.soft,
          icon: GROUP_ICONS[item.group],
        });

        // Blob готовится до saveFile: после await Safari считает жест
        // потраченным и отклоняет шторку шаринга.
        const blob = await canvasToBlob(canvas);
        const outcome = await saveFile(blob, `${item.id}.png`);
        if (outcome === 'manual') await alertDialog(t('ach.shareManual'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Sheet open={Boolean(item)} title={t('ach.title')} onClose={onClose}>
      {item && color && (
        <div className="achs" style={{ '--accent': color.hex } as React.CSSProperties}>
          <span className={`achs__badge${gotOn ? ' achs__badge--on' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {GROUP_ICONS[item.group].map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
          </span>

          <b className="achs__title">{titleOf(item)}</b>
          <p className="achs__note">{note}</p>
          <p className="achs__meta">
            {gotOn ? t('ach.gotOn', { day: formatDayFull(gotOn) }) : t('ach.locked')}
          </p>
          <p className="achs__kind">
            {item.kind === 'auto' && t('ach.autoNote')}
            {item.kind === 'deed' && t('ach.deedNote')}
            {item.kind === 'manual' && t('ach.manualNote')}
          </p>

          {item.kind === 'manual' &&
            (gotOn ? (
              <button
                className="btn press"
                type="button"
                onClick={() => {
                  haptics.tap();
                  onUnmark();
                }}
              >
                {t('ach.unmark')}
              </button>
            ) : (
              <button
                className="btn press"
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await confirmDialog(t('ach.markConfirm', { title: titleOf(item) }));
                    if (!ok) return;
                    haptics.success();
                    onMark();
                  })();
                }}
              >
                {t('ach.mark')}
              </button>
            ))}

          {gotOn && (
            <button className="btn press achs__gap" type="button" disabled={busy} onClick={share}>
              {t('ach.share')}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
