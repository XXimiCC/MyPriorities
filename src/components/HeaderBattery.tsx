/**
 * Батарейка в шапке. Стоит на каждой вкладке: состояние меняется чаще всего не
 * тогда, когда вы открыли экран «Заряд», а тогда, когда оно изменилось — и
 * искать для этого нужную вкладку не должно быть нужно.
 */

import { useMemo, useState } from 'react';

import { BatteryIcon } from './BatteryIcon';
import { BatterySheet } from './BatterySheet';
import { usePickBattery } from './BatteryPrompt';
import { currentBatteryLevel } from '../domain/stats';
import { t } from '../i18n';
import { useStore } from '../store/useStore';

export function HeaderBattery(): JSX.Element {
  const { journal } = useStore();
  const pick = usePickBattery();
  const [open, setOpen] = useState(false);

  const level = useMemo(() => currentBatteryLevel(journal), [journal]);

  return (
    <>
      <button
        className={`header__battery press${level ? '' : ' header__battery--ask'}`}
        onClick={() => setOpen(true)}
        type="button"
        aria-label={t('home.battery')}
      >
        {level ? (
          <BatteryIcon level={level} width={36} />
        ) : (
          <span className="header__battery-empty">
            <svg viewBox="0 0 24 24" width="11" height="13" aria-hidden="true">
              <path d="M13.4 2.5 5.4 13.6h4.9L9.8 21.5l8-11.2h-5.2z" fill="currentColor" />
            </svg>
            {t('home.batteryEmpty')}
          </span>
        )}
      </button>

      <BatterySheet
        open={open}
        current={level}
        onPick={(next) => {
          pick(next);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
