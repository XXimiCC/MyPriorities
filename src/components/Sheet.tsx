import { useEffect, type ReactNode } from 'react';

import { t } from '../i18n';
import { backButton } from '../telegram/sdk';
import './Sheet.css';

interface Props {
  open: boolean;
  title?: string;
  onClose(): void;
  children: ReactNode;
}

/** Нижняя шторка. Пока она открыта, системная «назад» закрывает её, а не экран. */
export function Sheet({ open, title, onClose, children }: Props): JSX.Element | null {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const restoreBack = backButton.show(onClose);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      restoreBack();
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet__scrim" onClick={onClose} type="button" aria-label={t('common.close')} />
      <div className="sheet__panel">
        <span className="sheet__grip" aria-hidden="true" />
        {title && <h2 className="sheet__title">{title}</h2>}
        <div className="sheet__content">{children}</div>
      </div>
    </div>
  );
}
