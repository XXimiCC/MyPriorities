/**
 * Куда ткнули перед жалобой — половина «рассказать».
 *
 * Путь до элемента и его разметка без текста — это то, с чего нейронка начнёт
 * поиск: имя класса вроде `prow__plus` приводит к файлу за один grep, а
 * описание словами — за десять минут.
 *
 * Текст из разметки вырезается ДО обрезки по длине, а не после: содержимое
 * кнопки — это чаще всего название приоритета, то есть ровно то, чего в тикете
 * быть не должно. Полезны здесь теги и классы.
 */

import { touchedElement } from './selector';

/** Сколько уровней пути записывать. Дальше начинается каркас, одинаковый везде. */
const MAX_LEVELS = 6;
const MAX_HTML = 500;

/** Что оставить в разметке: по этому ищут код. Всё остальное — либо текст, либо шум. */
const KEEP = /^(class|id|type|role|disabled|hidden|data-|aria-)/;

function step(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;

  const classes = Array.from(element.classList).slice(0, 2).join('.');
  const named = classes ? `${tag}.${classes}` : tag;

  const parent = element.parentElement;
  if (!parent) return named;

  // Номер нужен только там, где соседи неотличимы: строка списка среди строк.
  const twins = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (twins.length < 2) return named;
  return `${named}:nth-child(${Array.from(parent.children).indexOf(element) + 1})`;
}

export function cssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < MAX_LEVELS) {
    parts.unshift(step(current));
    if (current.id === 'root' || current.tagName === 'BODY') break;
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/** Разметка без текста и без всего, что текстом может оказаться. */
export function strippedHtml(element: Element): string {
  const clone = element.cloneNode(true) as Element;

  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (!KEEP.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) text.data = text.data.trim() ? '…' : '';

  return clone.outerHTML.slice(0, MAX_HTML);
}

/** Описать последнее касание. Ничего не трогали — вернётся undefined, и это нормально. */
export function describeTap(): { path: string; html: string } | undefined {
  const element = touchedElement();
  if (!element) return undefined;
  try {
    return { path: cssPath(element), html: strippedHtml(element) };
  } catch {
    // Разметка — не повод потерять тикет.
    return undefined;
  }
}
