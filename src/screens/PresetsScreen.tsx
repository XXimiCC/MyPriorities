import { useState } from 'react';

import { Sheet } from '../components/Sheet';
import { colorOf } from '../domain/palette';
import { PRESETS, type Preset } from '../domain/presets';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import { confirmDialog, haptics } from '../telegram/sdk';
import './PresetsScreen.css';

interface Props {
  onApplied(): void;
  /** Первый запуск: тот же экран, но с приветствием вместо обычной шапки. */
  intro?: boolean;
}

export function PresetsScreen({ onApplied, intro = false }: Props): JSX.Element {
  const { settings, actions } = useStore();
  const [preview, setPreview] = useState<Preset | null>(null);

  const apply = (preset: Preset): void => {
    void (async () => {
      // При первом запуске заменять нечего — подтверждение только мешает.
      const ok = intro || (await confirmDialog(t('presets.applyConfirm', { name: preset.name })));
      if (!ok) return;
      actions.applyPreset(preset.id);
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
        <p className="edit__hint">{intro ? t('presets.intro') : t('presets.hint')}</p>

        <ul className="presets">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                className={`pcard press${settings.presetId === preset.id ? ' pcard--current' : ''}`}
                type="button"
                style={{ '--accent': colorOf(preset.accentId).hex } as React.CSSProperties}
                onClick={() => setPreview(preset)}
              >
                <PresetIcon preset={preset} />
                <span className="pcard__name">{preset.name}</span>
                <span className="pcard__tagline">{preset.tagline}</span>
                {settings.presetId === preset.id && (
                  <span className="pcard__badge">{t('presets.current')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Sheet open={Boolean(preview)} title={preview?.name} onClose={() => setPreview(null)}>
        {preview && (
          <div className="ppreview" style={{ '--accent': colorOf(preview.accentId).hex } as React.CSSProperties}>
            <PresetIcon preset={preview} size={56} />
            <p className="ppreview__tagline">{preview.tagline}</p>

            <ol className="ppreview__list">
              {preview.priorities.map((item, index) => (
                <li key={item.title} style={{ '--accent': colorOf(item.colorId).hex } as React.CSSProperties}>
                  <span className="ppreview__index">{index + 1}</span>
                  <span className="erow__swatch" />
                  {item.title}
                </li>
              ))}
            </ol>

            <button className="pform__submit press" type="button" onClick={() => apply(preview)}>
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
