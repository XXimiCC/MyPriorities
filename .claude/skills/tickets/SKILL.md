---
name: tickets
description: Разобрать тикеты из встроенной панели отладки «Моих Приоритетов» — забрать с сервера, воспроизвести, починить, закрыть. Использовать, когда просят «разбери тикеты», «что там в отладке», «почини баг из панели» или называют номер тикета.
allowed-tools: Bash(npm run tickets:pull), Bash(npm run tickets:list), Bash(npm run tickets:close:*), Bash(npm run test), Bash(npm run build), Bash(npm run dev), Read, Edit, Write, Glob, Grep
---

# Разбор тикетов

Тикет — это жалоба, снятая прямо в работающем приложении: кадр экрана с
разметкой, описание словами и весь технический контекст момента. Задача —
починить то, на что жалуются, и закрыть тикет.

## Порядок

1. **Забрать.** `npm run tickets:pull`. Команда раскладывает по `.tickets/<id>/`
   три файла: `ticket.md`, `shot.<webp|jpg|png>`, `payload.json`.

   Приезжают только тикеты, отобранные руками на странице разбора
   (`/devkit/admin`) — это очередь на починку, а не весь входящий поток. Пусто —
   так и скажи: значит, ничего не отбирали. Не подменяй это на `--open`
   самовольно, отбор делает человек.

2. **Прочитать.** Сперва `ticket.md` — он написан для чтения сверху вниз, самое
   полезное вверху. Затем **обязательно посмотри картинку** инструментом Read:
   на ней разметка, ради которой человек и рисовал. `payload.json` открывай
   только тогда, когда нужно точное число, которого нет в `ticket.md`.

3. **Найти код.** Поле «Экран» указывает файл:

   | Экран | Файл |
   |---|---|
   | `home` | [HomeScreen.tsx](src/screens/HomeScreen.tsx) |
   | `stats` | [StatsScreen.tsx](src/screens/StatsScreen.tsx) |
   | `charge` | [ChargeScreen.tsx](src/screens/ChargeScreen.tsx) |
   | `skills` | [SkillsScreen.tsx](src/screens/SkillsScreen.tsx) |
   | `settings` | [SettingsScreen.tsx](src/screens/SettingsScreen.tsx) |
   | `onboarding` | [OnboardingScreen.tsx](src/screens/OnboardingScreen.tsx) |
   | `edit` | [EditPrioritiesScreen.tsx](src/screens/EditPrioritiesScreen.tsx) |
   | `presets` | [PresetsScreen.tsx](src/screens/PresetsScreen.tsx) |
   | `achievements` | [AchievementsScreen.tsx](src/screens/AchievementsScreen.tsx) |
   | `demo` | [DemoScreen.tsx](src/screens/DemoScreen.tsx) |
   | `brand` | [BrandKit.tsx](src/brandkit/BrandKit.tsx) |

   Раздел «Куда ткнули» точнее экрана: имя класса из пути приводит к файлу за
   один поиск — `prow__plus` → `PriorityRow.css` → `PriorityRow.tsx`.

   Раздел «Журнал» — то, что случилось перед жалобой. Ошибка с приставкой
   `[sync]`, `[store]` или `[pwa]` называет подсистему прямо.

4. **Воспроизвести.**
   - Логика — сперва падающий тест рядом с модулем: в этом проекте тестируются
     чистые функции в node, без DOM (см. [architecture.md](docs/dev/architecture.md)).
   - Вёрстка и поведение — `npm run dev` с `?mock=1` и тем же экраном. Данные
     синтетические, писать они ничего не будут.

5. **Починить в границах тикета.** Соглашения проекта обязательны:
   русские комментарии про «почему», именованные экспорты, `interface Props` над
   компонентом, CSS рядом с компонентом, **никаких новых зависимостей**.

6. **Проверить.** `npm run test` и `npm run build` должны пройти оба.

7. **Закрыть.** `npm run tickets:close -- <id> "<одна строка по-русски, что сделано>"`.
   Не воспроизводится или чинить нечего — `--wontfix` и причина той же строкой.
   Команда закрывает тикет на сервере и убирает локальную копию.

## Правила

- `.tickets/` **не коммитить**: внутри кадры экрана с настоящими данными.
  Каталог уже в `.gitignore` — не выводи его оттуда.
- Границы не расширять. Тикет про одну кнопку — это правка про одну кнопку;
  всё замеченное по дороге отдельным разговором, а не отдельным коммитом внутри
  этого.
- Один тикет — один коммит. Сообщение в стиле репозитория: фраза о том, что
  изменилось и почему, а не ярлык вроде «fix: button».
- Тикетов несколько — разбирать по одному до конца, а не чинить всё сразу.
