import { useEffect, useMemo, useRef, useState } from 'react';

import { BatteryIcon } from './BatteryIcon';
import { Sheet } from './Sheet';
import { batteryTheme } from '../domain/palette';
import { BATTERY_LEVELS, type BatteryLevel } from '../domain/types';
import { alertDialog, haptics } from '../telegram/sdk';
import { renderWallpaper } from '../wallpaper/render';
import {
  SIZE_PRESETS,
  canvasToBlob,
  deviceSize,
  saveFile,
  waitForFonts,
  type ScreenSize,
} from '../wallpaper/save';
import './WallpaperSheet.css';

interface Props {
  open: boolean;
  initialLevel: BatteryLevel;
  onClose(): void;
}

export function WallpaperSheet({ open, initialLevel, onClose }: Props): JSX.Element {
  return (
    <Sheet open={open} title="Обои с зарядом" onClose={onClose}>
      {/* key сбрасывает состояние при каждом открытии: иначе шторка помнит
          прошлый выбор уровня, хотя заряд с тех пор мог смениться. */}
      {open && <WallpaperMaker key={initialLevel} initialLevel={initialLevel} />}
    </Sheet>
  );
}

function WallpaperMaker({ initialLevel }: { initialLevel: BatteryLevel }): JSX.Element {
  const sizes = useMemo<ScreenSize[]>(() => [deviceSize(), ...SIZE_PRESETS], []);
  const [level, setLevel] = useState<BatteryLevel>(initialLevel);
  const [sizeId, setSizeId] = useState(sizes[0]!.id);
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [manual, setManual] = useState(false);

  const size = sizes.find((s) => s.id === sizeId) ?? sizes[0]!;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Картинка готовится заранее и целиком: к моменту нажатия «Сохранить» blob
  // уже должен существовать, иначе Safari не пустит navigator.share после await.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await waitForFonts();
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvasRef.current = canvas;
      renderWallpaper(canvas, { width: size.width, height: size.height, level });

      try {
        const blob = await canvasToBlob(canvas);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreview((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { url, blob };
        });
      } catch (error) {
        console.warn('[wallpaper] не удалось собрать картинку', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [level, size.width, size.height]);

  const theme = batteryTheme(level);

  return (
    <div style={{ '--accent': theme.hex } as React.CSSProperties}>
      <div className="wp__preview">
        {preview ? (
          <img src={preview.url} alt={`Обои: ${theme.title}`} />
        ) : (
          <span className="wp__spinner" aria-label="Готовим картинку" />
        )}
      </div>

      <div className="wp__levels">
        {BATTERY_LEVELS.map((option) => (
          <button
            key={option}
            className={`wp__level press${option === level ? ' wp__level--on' : ''}`}
            style={{ '--accent': batteryTheme(option).hex } as React.CSSProperties}
            type="button"
            aria-label={batteryTheme(option).title}
            onClick={() => {
              haptics.select();
              setLevel(option);
            }}
          >
            <BatteryIcon level={option} width={40} dimmed={option !== level} />
          </button>
        ))}
      </div>

      <div className="divider-label">
        <span>Размер</span>
      </div>

      <div className="wp__sizes">
        {sizes.map((option) => (
          <button
            key={option.id}
            className={`wp__size${option.id === sizeId ? ' wp__size--on' : ''}`}
            type="button"
            onClick={() => {
              haptics.select();
              setSizeId(option.id);
            }}
          >
            <span>{option.label}</span>
            <small>
              {option.width}×{option.height}
            </small>
          </button>
        ))}
      </div>

      <button
        className="pform__submit press wp__save"
        type="button"
        disabled={!preview}
        onClick={() => {
          if (!preview) return;
          haptics.bump();
          void (async () => {
            const outcome = await saveFile(preview.blob, `priorities-${theme.label.toLowerCase()}.png`);
            if (outcome === 'manual') setManual(true);
          })();
        }}
      >
        Сохранить обои
      </button>

      {manual && preview && (
        <div className="wp__manual" role="dialog" aria-modal="true">
          <button className="sheet__scrim" type="button" aria-label="Закрыть" onClick={() => setManual(false)} />
          <div className="wp__manual-body">
            <p>Нажмите на картинку и удерживайте, затем выберите «Сохранить в Фото».</p>
            <img src={preview.url} alt="Обои для сохранения" />
            <button
              className="edit__add"
              type="button"
              onClick={() => {
                setManual(false);
                void alertDialog('Готово. Поставьте картинку обоями в настройках устройства.');
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
