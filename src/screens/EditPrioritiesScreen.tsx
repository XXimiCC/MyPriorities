import { useState } from 'react';

import { Sheet } from '../components/Sheet';
import { useReorder } from '../components/useReorder';
import { NEON_PALETTE, colorOf } from '../domain/palette';
import { MAX_PRIORITIES, MIN_PRIORITIES, type Priority } from '../domain/types';
import { useStore } from '../store/useStore';
import { confirmDialog, haptics } from '../telegram/sdk';
import { plural } from './HomeScreen';
import './EditPrioritiesScreen.css';

export function EditPrioritiesScreen(): JSX.Element {
  const { settings, actions } = useStore();
  const [editing, setEditing] = useState<Priority | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useReorder(settings.priorities, actions.reorder);
  const atLimit = settings.priorities.length >= MAX_PRIORITIES;
  const atMinimum = settings.priorities.length <= MIN_PRIORITIES;

  return (
    <>
      <header className="header">
        <h1 className="header__title">Приоритеты</h1>
        <span className="edit__counter">
          {settings.priorities.length} из {MAX_PRIORITIES}
        </span>
      </header>

      <div className="app__body">
        <p className="edit__hint">
          Потяните за ручку, чтобы поменять порядок. Нажмите на строку, чтобы переименовать или сменить цвет.
        </p>

        <ul className="edit__list" ref={list.containerRef}>
          {settings.priorities.map((priority, index) => {
            const color = colorOf(priority.colorId);
            return (
              <li
                key={priority.id}
                className={`erow${list.dragIndex === index ? ' erow--dragging' : ''}`}
                style={{ ...list.rowStyle(index), '--accent': color.hex } as React.CSSProperties}
              >
                <span className="erow__handle" {...list.handleProps(index)} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M8 7h8M8 12h8M8 17h8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>

                <button className="erow__body" type="button" onClick={() => setEditing(priority)}>
                  <span className="erow__swatch" />
                  <span className="erow__title">{priority.title}</span>
                </button>

                <span className="erow__arrows">
                  <button
                    type="button"
                    aria-label="Выше"
                    disabled={index === 0}
                    onClick={() => {
                      haptics.tap();
                      list.move(index, index - 1);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Ниже"
                    disabled={index === settings.priorities.length - 1}
                    onClick={() => {
                      haptics.tap();
                      list.move(index, index + 1);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path d="M6 10l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>

                <button
                  className="erow__delete"
                  type="button"
                  aria-label={`Удалить ${priority.title}`}
                  disabled={atMinimum}
                  onClick={() => {
                    void (async () => {
                      const ok = await confirmDialog(
                        `Удалить «${priority.title}»? Накопленное время сохранится и останется видно в статистике.`,
                      );
                      if (!ok) return;
                      haptics.warning();
                      actions.deletePriority(priority.id);
                    })();
                  }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>

        <button
          className="edit__add press"
          type="button"
          disabled={atLimit}
          onClick={() => setAdding(true)}
        >
          {atLimit ? `Максимум ${MAX_PRIORITIES} приоритетов` : 'Добавить приоритет'}
        </button>

        {settings.archived.length > 0 && (
          <>
            <div className="divider-label">
              <span>
                Архив: {settings.archived.length}{' '}
                {plural(settings.archived.length, 'приоритет', 'приоритета', 'приоритетов')}
              </span>
            </div>
            <p className="edit__hint">
              Удалённые приоритеты хранят своё время. Добавьте приоритет с тем же названием — история вернётся.
            </p>
            <ul className="edit__archive">
              {settings.archived.map((priority) => (
                <li key={priority.id} style={{ '--accent': colorOf(priority.colorId).hex } as React.CSSProperties}>
                  <span className="erow__swatch" />
                  {priority.title}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <PriorityEditor
        priority={editing}
        onClose={() => setEditing(null)}
        onSave={(title, colorId) => {
          actions.updatePriority(editing!.id, { title, colorId });
          setEditing(null);
        }}
      />

      <AddPriority
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(title) => {
          const created = actions.addPriority(title);
          if (created) haptics.success();
          setAdding(false);
        }}
      />
    </>
  );
}

function ColorPicker({ value, onChange }: { value: number; onChange(id: number): void }): JSX.Element {
  return (
    <div className="picker">
      {NEON_PALETTE.map((color, index) => (
        <button
          key={color.hex}
          type="button"
          className={`picker__dot${index === value ? ' picker__dot--on' : ''}`}
          style={{ '--accent': color.hex } as React.CSSProperties}
          aria-label={color.name}
          aria-pressed={index === value}
          onClick={() => {
            haptics.select();
            onChange(index);
          }}
        />
      ))}
    </div>
  );
}

function PriorityEditor({
  priority,
  onClose,
  onSave,
}: {
  priority: Priority | null;
  onClose(): void;
  onSave(title: string, colorId: number): void;
}): JSX.Element {
  // key на форме сбрасывает поля при смене приоритета: без него в шторке
  // остаётся название предыдущего.
  return (
    <Sheet open={Boolean(priority)} title="Приоритет" onClose={onClose}>
      {priority && (
        <PriorityForm
          key={priority.id}
          initialTitle={priority.title}
          initialColor={priority.colorId}
          submitLabel="Сохранить"
          onSubmit={onSave}
        />
      )}
    </Sheet>
  );
}

function AddPriority({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose(): void;
  onAdd(title: string): void;
}): JSX.Element {
  return (
    <Sheet open={open} title="Новый приоритет" onClose={onClose}>
      {open && (
        <PriorityForm
          initialTitle=""
          initialColor={-1}
          submitLabel="Добавить"
          hideColor
          onSubmit={(title) => onAdd(title)}
        />
      )}
    </Sheet>
  );
}

function PriorityForm({
  initialTitle,
  initialColor,
  submitLabel,
  hideColor = false,
  onSubmit,
}: {
  initialTitle: string;
  initialColor: number;
  submitLabel: string;
  hideColor?: boolean;
  onSubmit(title: string, colorId: number): void;
}): JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [colorId, setColorId] = useState(initialColor);

  const accent = colorId >= 0 ? colorOf(colorId).hex : 'var(--text)';
  const canSubmit = title.trim().length > 0;

  return (
    <form
      className="pform"
      style={{ '--accent': accent } as React.CSSProperties}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(title, colorId);
      }}
    >
      <input
        className="pform__input"
        value={title}
        maxLength={24}
        autoComplete="off"
        placeholder="Например, Работа"
        onChange={(event) => setTitle(event.target.value)}
      />

      {!hideColor && <ColorPicker value={colorId} onChange={setColorId} />}

      <button className="pform__submit press" type="submit" disabled={!canSubmit}>
        {submitLabel}
      </button>
    </form>
  );
}
