import { Component, type ReactNode } from 'react';

import { t } from '../i18n';
import './LazyBoundary.css';

/**
 * Граница вокруг ленивого куска приложения.
 *
 * Без неё сорвавшийся import() снимает всё дерево целиком: React не знает, чем
 * заменить упавшую ветку, и оставляет пустой #root — чёрный экран, из которого
 * нет выхода, кроме перезагрузки. А сорваться он может обыденно: файлы чанков
 * названы по хешу содержимого, и после выкатки новой версии имена, зашитые в
 * уже открытую вкладку, на сервере не отвечают.
 *
 * Поэтому и текст такой: чинится это именно перезагрузкой — она заберёт свежий
 * документ со свежими именами. Ошибка при этом уходит в консоль целиком: тикет
 * из панели отладки должен нести причину, а не «раздел не загрузился».
 */
interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class LazyBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[lazy] кусок приложения не загрузился', error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="lazyfail">
        <p className="lazyfail__text">{t('app.chunkFailed')}</p>
        <button
          className="btn-accent press"
          type="button"
          onClick={() => window.location.reload()}
        >
          {t('app.chunkReload')}
        </button>
      </div>
    );
  }
}
