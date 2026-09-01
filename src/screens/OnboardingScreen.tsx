import { useState } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { FROM_DEMO } from '../demo/mode';
import { NEON_PALETTE, colorOf } from '../domain/palette';
import { DEFAULT_BLOCK_MINUTES } from '../domain/types';
import { t, type StringKey } from '../i18n';
import { haptics } from '../telegram/sdk';
import { PresetsScreen } from './PresetsScreen';
import './OnboardingScreen.css';

interface Slide {
  eyebrow: StringKey;
  title: StringKey;
  text: StringKey;
  art: JSX.Element;
}

/** Полоски-приоритеты с перекосом — тем самым, который приложение и показывает. */
function BarsArt(): JSX.Element {
  const bars = [
    { colorId: 1, fill: 1 },
    { colorId: 9, fill: 0.42 },
    { colorId: 0, fill: 0.26 },
    { colorId: 6, fill: 0.64 },
  ];
  return (
    <div className="onb__bars">
      {bars.map((bar) => {
        const color = colorOf(bar.colorId);
        return (
          <div
            key={bar.colorId}
            className="onb__bar"
            style={{ '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties}
          >
            <span className="bar">
              <span className="bar__fill" style={{ width: `${bar.fill * 100}%` }} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ClickArt(): JSX.Element {
  return (
    <div className="onb__click">
      <span className="onb__click-btn" style={{ '--accent': NEON_PALETTE[1]!.hex } as React.CSSProperties}>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
          <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="onb__click-eq">{t('onb.2.equals', { minutes: DEFAULT_BLOCK_MINUTES })}</span>
    </div>
  );
}

function ChargeArt(): JSX.Element {
  return (
    <div className="onb__charge">
      <BatteryIcon level={3} width={92} />
      <BatteryIcon level={2} width={92} />
      <BatteryIcon level={1} width={92} />
    </div>
  );
}

const SLIDES: Slide[] = [
  { eyebrow: 'onb.1.eyebrow', title: 'onb.1.title', text: 'onb.1.text', art: <BarsArt /> },
  { eyebrow: 'onb.2.eyebrow', title: 'onb.2.title', text: 'onb.2.text', art: <ClickArt /> },
  { eyebrow: 'onb.3.eyebrow', title: 'onb.3.title', text: 'onb.3.text', art: <ChargeArt /> },
];

export function OnboardingScreen(): JSX.Element {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];

  // Последний шаг — выбор набора: он же и завершает онбординг, выставляя onboarded.
  if (!slide) return <PresetsScreen intro onApplied={() => undefined} />;

  return (
    <>
      <header className="header">
        <h1 className="header__title">{t('app.title')}</h1>
        <button
          className="onb__skip"
          type="button"
          onClick={() => {
            haptics.select();
            setStep(SLIDES.length);
          }}
        >
          {t('onb.skip')}
        </button>
      </header>

      <div className="app__body onb__body">
        {/*
          Шов между чужой историей и собственным пустым экраном. Только на
          первом шаге и только для вышедшего из демо: сказать «дальше твоя
          история» нужно там, где чужая только что закрылась, а не на каждом
          слайде.
        */}
        {FROM_DEMO && step === 0 && <p className="onb__bridge">{t('onb.fromDemo')}</p>}
        <div className="onb__art">{slide.art}</div>
        <p className="eyebrow onb__eyebrow">{t(slide.eyebrow)}</p>
        <h2 className="onb__title">{t(slide.title)}</h2>
        <p className="onb__text">{t(slide.text)}</p>
      </div>

      {/*
        Точки живут внутри нижней панели, а не отдельной полосой над ней: у
        панели есть растушёвка сверху (.app__footer::before) на 28 пикселей и
        z-index выше, чем у .app__sticky, — она ровно накрывала собой весь ряд
        точек, и шаги было не видно вообще.
      */}
      <div className="app__footer">
        <div className="onb__dots" role="presentation">
          {SLIDES.map((item, index) => (
            <span
              key={item.title}
              className={index === step ? 'onb__dot onb__dot--on' : 'onb__dot'}
            />
          ))}
        </div>

        <button
          className="onb__next"
          type="button"
          onClick={() => {
            haptics.tap();
            setStep(step + 1);
          }}
        >
          {step === SLIDES.length - 1 ? t('onb.start') : t('onb.next')}
        </button>
      </div>
    </>
  );
}
