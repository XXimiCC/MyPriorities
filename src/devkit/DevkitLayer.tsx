import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnnotateLayer } from './AnnotateLayer';
import { readBreadcrumbs } from './breadcrumbs';
import { CaptureFailed, captureStill, exportShot, type Still } from './capture';
import { ComposeSheet } from './ComposeSheet';
import { browserFacts, buildTicket, freezeContext, newTicketId, type Frozen } from './context';
import { describeTap } from './describe';
import { ask } from './host';
import { SelectLayer } from './SelectLayer';
import { checkAllowed, submit } from './send';
import { s } from './strings';
import { toast } from './toast';
import type { Rect, ShotError, ShotInfo, Stroke } from './types';
import './DevkitLayer.css';

interface Props {
  onClose(): void;
}

type Stage = 'shooting' | 'select' | 'draw' | 'compose';

interface Shot {
  blob: Blob;
  info: ShotInfo;
  preview: string;
}

function summarize(frozen: Frozen): string {
  const platform = frozen.env.client.platform;
  // Считаются именно ошибки: предупреждения в журнал тоже попадают, но обещать
  // человеку «ошибок: 1» из-за чужого console.warn — вранье в одну строку.
  const errors = frozen.log.filter((entry) => entry.kind !== 'action' && entry.kind !== 'warn').length;
  return [frozen.route, frozen.build.id, platform, errors ? `ошибок: ${errors}` : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Корень панели: съёмка → выбор области → разметка → отправка.
 *
 * Факты о моменте жалобы замораживаются первым делом, ещё до съёмки. Пока
 * человек выделяет и пишет, приложение живёт: срабатывают таймеры, исчезают
 * тосты, меняется вкладка. Тикет обязан описывать момент, когда стало не так.
 */
export function DevkitLayer({ onClose }: Props): JSX.Element {
  const [stage, setStage] = useState<Stage>('shooting');
  const [still, setStill] = useState<Still | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotError, setShotError] = useState<ShotError | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const alive = useRef(true);

  // Снимок момента — синхронно на первом рендере, до всякого ожидания.
  const frozen = useMemo<Frozen>(
    () => freezeContext({ facts: browserFacts(), log: readBreadcrumbs(Date.now()), target: describeTap() }),
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* Спрашиваем разрешение параллельно со съёмкой: отказ должен догнать человека
     до того, как он потратит время на разметку и описание, а не после. */
  useEffect(() => {
    void checkAllowed().then((allowed) => {
      if (alive.current && allowed === false) setStatus(s.refused);
    });
  }, []);

  useEffect(() => {
    const root = ask('captureRoot', (h) => h.captureRoot?.()) ?? document.getElementById('root') ?? document.body;

    captureStill(root)
      .then((taken) => {
        if (!alive.current) return;
        setStill(taken);
        setStage('select');
      })
      .catch((error: unknown) => {
        if (!alive.current) return;
        // Кадра не будет — но тикет уйдёт. Это и есть разница между
        // инструментом и обузой.
        console.warn('[devkit] кадр не снялся', error);
        setShotError(error instanceof CaptureFailed ? error.reason : 'raster-failed');
        setStage('compose');
      });
  }, []);

  // Освобождать адрес предпросмотра обязательно: иначе кадр остаётся в памяти
  // вкладки до перезагрузки.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.preview);
    };
  }, [shot]);

  const back = useCallback(() => {
    setStage((current) => {
      if (current === 'compose' && still) return 'draw';
      if (current === 'draw') return 'select';
      onClose();
      return current;
    });
  }, [onClose, still]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') back();
    };
    document.addEventListener('keydown', onKey);
    const restoreBack = ask('backButton', (h) => h.backButton?.show(back));

    return () => {
      document.removeEventListener('keydown', onKey);
      restoreBack?.();
    };
  }, [back]);

  const toCompose = useCallback(async () => {
    if (!still || !crop) return;
    setBusy(true);
    try {
      const made = await exportShot(still, crop, strokes);
      if (!alive.current) return;
      setShot({ ...made, preview: URL.createObjectURL(made.blob) });
      setShotError(undefined);
    } catch (error) {
      console.warn('[devkit] кадр не сохранился', error);
      setShot(null);
      setShotError(error instanceof CaptureFailed ? error.reason : 'encode-failed');
    } finally {
      if (alive.current) {
        setBusy(false);
        setStage('compose');
      }
    }
  }, [crop, still, strokes]);

  const send = useCallback(
    async (note: string) => {
      setBusy(true);
      setStatus(undefined);

      const ticket = buildTicket(frozen, {
        id: newTicketId(),
        note,
        shot: shot?.info,
        shotError,
      });

      const { outcome, reason } = await submit(ticket, shot?.blob);
      if (!alive.current) return;

      const short = ticket.id.slice(0, 8);

      /*
       * Отказ оставляет панель открытой: написанное не должно пропасть вместе
       * с сообщением о том, что оно никуда не ушло. Причина — дословно, чтобы
       * «не вошёл», «не пустили» и «нет сети» различались с первого взгляда.
       */
      if (outcome === 'refused') {
        ask('haptics', (h) => h.haptics?.warning());
        setBusy(false);
        setStatus(reason ? `${s.notSent}: ${reason}` : s.refused);
        return;
      }

      /* Успех и отложенная отправка закрывают панель, но говорят разное — и
         оба называют номер. Пока они выглядели одинаково, потерянный тикет
         ничем не отличался от доехавшего. */
      ask('haptics', (h) => h.haptics?.success());
      toast(outcome === 'sent' ? s.sent(short) : s.queued(short), outcome === 'sent' ? 'ok' : 'warn');
      onClose();
    },
    [frozen, onClose, shot, shotError],
  );

  return (
    <div className="dk" role="dialog" aria-modal="true" aria-label={s.launcher}>
      <header className="dk__bar">
        <span className="dk__title">{s.launcher}</span>
        <button className="dk__icon" type="button" onClick={onClose} aria-label={s.cancel}>
          ×
        </button>
      </header>

      {stage === 'shooting' && (
        <div className="dk__wait">
          <span className="dk__spinner" aria-hidden="true" />
          <p className="dk__meta">{s.shooting}</p>
        </div>
      )}

      {stage === 'select' && still && (
        <SelectLayer
          still={still}
          onCancel={onClose}
          onPick={(picked) => {
            setCrop(picked);
            setStrokes([]);
            setStage('draw');
          }}
        />
      )}

      {stage === 'draw' && still && crop && (
        <AnnotateLayer
          still={still}
          crop={crop}
          strokes={strokes}
          onChange={setStrokes}
          onBack={() => setStage('select')}
          onNext={() => void toCompose()}
        />
      )}

      {stage === 'compose' && (
        <ComposeSheet
          preview={shot?.preview}
          summary={summarize(frozen)}
          busy={busy}
          status={status}
          onEdit={back}
          onCancel={onClose}
          onSend={(note) => void send(note)}
        />
      )}
    </div>
  );
}
