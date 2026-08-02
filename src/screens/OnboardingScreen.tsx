import { useState } from 'react';

import { BatteryIcon } from '../components/BatteryIcon';
import { NEON_PALETTE, colorOf } from '../domain/palette';
import { PresetsScreen } from './PresetsScreen';
import { haptics } from '../telegram/sdk';
import './OnboardingScreen.css';

interface Slide {
  eyebrow: string;
  title: string;
  text: string;
  art: JSX.Element;
}

/** Полоски-приоритеты с перекосом — тем самым, который приложение и показывает. */
function BarsArt(): JSX.Element {
  const bars = [
    { colorId: 1, fill: 1, label: 'Работа' },
    { colorId: 9, fill: 0.42, label: 'Семья' },
    { colorId: 0, fill: 0.26, label: 'Здоровье' },
    { colorId: 6, fill: 0.64, label: 'Отдых' },
  ];
  return (
    <div className="onb__bars">
      {bars.map((bar) => {
        const color = colorOf(bar.colorId);
        return (
          <div
            key={bar.label}
            className="onb__bar"
            style={{ '--accent': color.hex, '--accent-soft': color.soft } as React.CSSProperties}
          >
            <span className="onb__bar-label">{bar.label}</span>
            <span className="prow__track">
              <span className="prow__fill" style={{ width: `${bar.fill * 100}%` }} />
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
      <span className="onb__click-eq">= 30 минут</span>
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
  {
    eyebrow: 'Зачем это',
    title: 'Куда на самом деле уходит жизнь',
    text: 'Планы врут, а отметки — нет. Приложение не говорит, как надо жить: оно показывает, как вы живёте на самом деле, и даёт увидеть перекос своими глазами.',
    art: <BarsArt />,
  },
  {
    eyebrow: 'Как отмечать',
    title: 'Один клик — полчаса жизни',
    text: 'Уделили приоритету сфокусированный блок — нажмите «+». Полоса заполняется относительно лидера: тот, кто съедает больше всех, всегда во всю ширину, остальные — в его долях.',
    art: <ClickArt />,
  },
  {
    eyebrow: 'Ваш ресурс',
    title: 'Заряд — это про вас, не про телефон',
    text: 'Отмечайте состояние, когда оно менялось: полный заряд, средний, на нуле или восстановление. Приложение считает время между переключениями и покажет, сколько вы прожили на нуле.',
    art: <ChargeArt />,
  },
];

export function OnboardingScreen(): JSX.Element {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];

  // Последний шаг — выбор набора: он же и завершает онбординг, выставляя onboarded.
  if (!slide) return <PresetsScreen intro onApplied={() => undefined} />;

  return (
    <>
      <header className="header">
        <h1 className="header__title">Мои приоритеты</h1>
        <button
          className="onb__skip"
          type="button"
          onClick={() => {
            haptics.select();
            setStep(SLIDES.length);
          }}
        >
          Пропустить
        </button>
      </header>

      <div className="app__body onb__body">
        <div className="onb__art">{slide.art}</div>
        <p className="eyebrow onb__eyebrow">{slide.eyebrow}</p>
        <h2 className="onb__title">{slide.title}</h2>
        <p className="onb__text">{slide.text}</p>
      </div>

      <div className="app__sticky onb__dots" role="presentation">
        {SLIDES.map((item, index) => (
          <span key={item.eyebrow} className={index === step ? 'onb__dot onb__dot--on' : 'onb__dot'} />
        ))}
      </div>

      <div className="app__footer">
        <button
          className="onb__next"
          type="button"
          onClick={() => {
            haptics.tap();
            setStep(step + 1);
          }}
        >
          {step === SLIDES.length - 1 ? 'Выбрать приоритеты' : 'Дальше'}
        </button>
      </div>
    </>
  );
}
