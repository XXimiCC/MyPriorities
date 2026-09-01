import { useState } from 'react';

import { Sheet } from '../components/Sheet';
import { FROM_DEMO } from '../demo/mode';
import { findProfile } from '../demo/profiles';
import { colorOf } from '../domain/palette';
import { PRESETS, type Preset } from '../domain/presets';
import { t, type StringKey } from '../i18n';
import { useStore } from '../store/useStore';
import { confirmDialog, haptics } from '../telegram/sdk';
import './PresetsScreen.css';

interface Props {
  onApplied(): void;
  /** Первый запуск: тот же экран, но с приветствием вместо обычной шапки. */
  intro?: boolean;
}

/**
 * Набор, на котором построено демо, из которого человек только что вышел.
 *
 * Считается один раз на модуль: и адрес, и профили неизменны за сеанс.
 * `undefined` — обычный вход, список остаётся ровно тем же, что был.
 */
const SUGGESTED = findProfile(FROM_DEMO)?.script.presetId;

/**
 * Тот же список, но предложенный набор впереди.
 *
 * Порядок остальных не меняется — они сдвигаются на одну позицию, и только.
 * Отметить, не подняв, значило бы не отметить вовсе: набор демо «Выгорание»
 * стоит в списке десятым, то есть ниже сгиба на любом экране.
 */
const ORDERED = SUGGESTED
  ? [...PRESETS].sort((a, b) => Number(b.id === SUGGESTED) - Number(a.id === SUGGESTED))
  : PRESETS;

export function PresetsScreen({ onApplied, intro = false }: Props): JSX.Element {
  const { settings, actions } = useStore();
  const [preview, setPreview] = useState<Preset | null>(null);

  /* Подсказка живёт только на первом запуске: сборники, открытые из настроек,
     к чужой ссылке отношения не имеют. */
  const suggested = intro ? SUGGESTED : undefined;
  const cards = suggested ? ORDERED : PRESETS;
  const hint: StringKey = suggested
    ? 'presets.introFromDemo'
    : intro
      ? 'presets.intro'
      : 'presets.hint';

  const apply = (preset: Preset): void => {
    void (async () => {
      // При первом запуске заменять нечего — подтверждение только мешает.
      const ok = intro || (await confirmDialog(t('presets.applyConfirm', { name: t(preset.nameKey) })));
      if (!ok) return;
      actions.applyPreset(preset.id);
      actions.award('r5');
      haptics.success();
      setPreview(null);
      onApplied();
    })();
  };

  return (
    <>
      <header className="header">
        <h1 className="header__title">{intro ? t('app.title') : t('presets.title')}</h1>
      </header>

      <div className="app__body">
        <p className="edit__hint">{t(hint)}</p>

        <ul className="presets">
          {cards.map((preset) => {
            /* Предложенный и выбранный не встречаются: на первом запуске
               выбранного ещё нет, а вне его нет предложенного. */
            const badge: StringKey | undefined =
              preset.id === suggested
                ? 'presets.fromDemo'
                : settings.presetId === preset.id
                  ? 'presets.current'
                  : undefined;

            return (
              <li key={preset.id}>
                <button
                  className={`pcard press${badge ? ' pcard--current' : ''}`}
                  type="button"
                  style={{ '--accent': colorOf(preset.accentId).hex } as React.CSSProperties}
                  onClick={() => setPreview(preset)}
                >
                  <PresetIcon preset={preset} />
                  <span className="pcard__name">{t(preset.nameKey)}</span>
                  <span className="pcard__tagline">{t(preset.taglineKey)}</span>
                  {badge && <span className="pcard__badge">{t(badge)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <Sheet open={Boolean(preview)} title={preview ? t(preview.nameKey) : undefined} onClose={() => setPreview(null)}>
        {preview && (
          <div className="ppreview" style={{ '--accent': colorOf(preview.accentId).hex } as React.CSSProperties}>
            <PresetIcon preset={preview} size={56} />
            <p className="ppreview__tagline">{t(preview.taglineKey)}</p>

            <ol className="ppreview__list">
              {preview.priorities.map((item, index) => (
                <li key={item.titleKey} style={{ '--accent': colorOf(item.colorId).hex } as React.CSSProperties}>
                  <span className="ppreview__index">{index + 1}</span>
                  <span className="swatch" />
                  {t(item.titleKey)}
                </li>
              ))}
            </ol>

            <button className="btn-accent press ppreview__apply" type="button" onClick={() => apply(preview)}>
              {t('presets.apply')}
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** Иконка набора — те же штрихованные пути, что лежат в presets.ts, со свечением. */
export function PresetIcon({ preset, size = 30 }: { preset: Preset; size?: number }): JSX.Element {
  return (
    <svg
      className="picon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {preset.icon.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
