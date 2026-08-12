import { useState } from 'react';

import { s } from './strings';
import './ComposeSheet.css';

interface Props {
  /** Адрес готового кадра — ровно того, что уедет. Нет — кадра не будет вовсе. */
  preview?: string;
  /** Одна строка контекста: экран, сборка, платформа, число ошибок. */
  summary: string;
  busy: boolean;
  status?: string;
  onEdit(): void;
  onSend(note: string): void;
  onCancel(): void;
}

/**
 * Описание и отправка.
 *
 * Кадр показан в полный размер до нажатия «Отправить» — это не украшение, а
 * единственная гарантия приватности, которую тут вообще можно дать: вырез
 * экрана приложения о личных приоритетах содержит ровно то, что человек в него
 * написал. Уходит только то, на что он посмотрел.
 */
export function ComposeSheet({
  preview,
  summary,
  busy,
  status,
  onEdit,
  onSend,
  onCancel,
}: Props): JSX.Element {
  const [note, setNote] = useState('');

  return (
    <div className="dkc">
      <div className="dkc__scroll">
        {preview ? (
          <button className="dkc__preview" type="button" onClick={onEdit}>
            <img src={preview} alt="" />
          </button>
        ) : (
          <p className="dkc__warn">{s.noShot}</p>
        )}

        <textarea
          className="dkc__note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={s.notePlaceholder}
          rows={4}
          autoFocus
          enterKeyHint="send"
        />

        <p className="dkc__meta">{summary}</p>
        <p className="dkc__privacy">{s.privacy}</p>
      </div>

      <footer className="dkc__bar">
        <button className="dk-btn" type="button" onClick={onCancel} disabled={busy}>
          {s.cancel}
        </button>
        <span className="dkc__status">{status}</span>
        <button
          className="dk-btn dk-btn--main"
          type="button"
          onClick={() => onSend(note.trim())}
          disabled={busy || note.trim().length === 0}
        >
          {busy ? s.sending : s.send}
        </button>
      </footer>
    </div>
  );
}
