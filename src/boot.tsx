import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/*
 * Общий слой идёт ПЕРЕД приложением, а не после: порядок импортов — это и
 * порядок стилевых листов, а значит и порядок каскада. Пока кнопка и поле жили
 * в стилях экрана правки приоритетов, они грузились после соседей, и трём
 * экранам приходилось утяжелять селектор, чтобы отбить собственную же кнопку
 * (.achs .edit__add и его два брата). Общий слой первым — и обычный класс
 * экрана снова побеждает без ухищрений.
 *
 * Токены ui.css не тянет: они приезжают с global.css ниже, а переменные из
 * :root применяются независимо от того, в каком листе объявлены. Второй импорт
 * того же файла означал бы вторую копию токенов в собранном CSS.
 *
 * global.css при этом остаётся последним — именно там, где стоял. Каркас
 * (.app, .app__body, шапка, таб-бар) намеренно сильнее стилей экранов, и
 * менять это на ходу нельзя: на нём держится вёрстка каждого экрана.
 *
 * Весь каскад целиком живёт в этом файле, а не разъезжается по нему и main.tsx:
 * между ними проходит граница чанка, и половина листов приезжала бы отдельным
 * файлом — то есть в другом порядке.
 */
import './styles/ui.css';

import { App, readCurrentRoute } from './App';
import { BUILD_ID, BUILD_TIME } from './build';
import { DEMO_MODE, GUEST_MODE } from './demo/mode';
import { mountDevkit } from './devkit';
import { readDiagnosticSnapshot } from './devkitHost';
import { useLocale } from './i18n/useLocale';
import { StoreProvider } from './store/useStore';
import { ensureSession } from './sync/auth';
import {
  backButton,
  clientInfo,
  haptics,
  initTelegram,
  isTelegram,
  sdkMissing,
  startParam,
} from './telegram/sdk';
import './styles/global.css';

/** Приглашение тестировщику: t.me/<бот>/app?startapp=test_<ключ>. */
const TEST_PREFIX = 'test_';

/**
 * Показать панель себе: t.me/<бот>/app?startapp=devkit.
 *
 * Внутри клиента на компьютере это единственный надёжный способ. Адресную
 * строку там не поправить, сенсорного экрана нет, а сочетание клавиш клиент
 * может забрать себе — ссылку же он открывает всегда.
 */
const DEVKIT_PARAM = 'devkit';

/**
 * Смена языка — пересборка дерева, а не перерисовка.
 *
 * Модульных вызовов t() в приложении нет, но два списка обёрнуты в memo
 * (components/PriorityRow.tsx, skills/SkillRow.tsx) и на смену языка не
 * откликнутся: пропсы у них те же. Сегодня оба живут на вкладках, которых при
 * нажатии не видно, но это совпадение, а не правило. Ключ по коду языка снимает
 * вопрос целиком — новое дерево, и ни одна строка не может остаться прежней.
 *
 * Провайдер стоит НАД ключом: хранилище поднимается из IndexedDB асинхронно, и
 * пересобрать его вместе с приложением значило бы показать «Загрузка» тому, кто
 * всего лишь нажал «English».
 */
function Root(): JSX.Element {
  const locale = useLocale();
  return (
    <StoreProvider>
      <App key={locale} />
    </StoreProvider>
  );
}

/**
 * Старт приложения. Зовётся из main.tsx — и только после того, как решится
 * судьба SDK Telegram: от него зависят и выбор хранилища, и всё ниже.
 */
export function start(): void {
  // До первого рендера: клиент должен успеть перекрасить шапку и отдать безопасные зоны.
  initTelegram();

  /**
   * Кэш приложения — только в обычном браузере и только на верхнем уровне.
   *
   * Три условия, и у каждого своя причина:
   *
   *   isTelegram — внутри клиента установка PWA невозможна, ярлык на домашний
   *     экран ставит сам Telegram (см. homeScreen в telegram/sdk.ts). Зато второй
   *     слой кэша поверх вебвью, которое и так кэширует агрессивно, сделал бы
   *     вопрос «доехала ли сборка» неотвечаемым — а он единственная причина, по
   *     которой в приложении вообще живёт BUILD_ID.
   *   DEMO_MODE — демо не оставляет следов на устройстве. Это уже решено на
   *     границе хранилища (store/local/db.ts), и воркер стал бы единственным
   *     исключением из правила: чужие данные ушли бы, а кэш остался.
   *   верхний уровень — приложение встраивают фреймом в лендинг, а Safari
   *     отказывает регистрации в кросс-доменном iframe исключением.
   *
   * Адрес считается от document.baseURI, а не пишется как '/sw.js': это сохраняет
   * обещание base: './' о том, что сборка переживает размещение в подкаталоге.
   * Строка запроса с отметкой сборки — версия воркера, см. public/sw.js.
   *
   * Регистрация после load, чтобы установка не конкурировала за сеть с первым
   * рендером; ошибка не всплывает — приложение полностью работоспособно без кэша.
   *
   * Проверка readyState обязательна: start() зовётся из промиса (main.tsx) и
   * вполне может выполниться уже ПОСЛЕ load — тогда подписка не сработает
   * никогда, и воркер тихо не встанет ни в одной сессии.
   */
  if ('serviceWorker' in navigator && !isTelegram && !DEMO_MODE && window.top === window.self) {
    const install = (): void => {
      const worker = new URL(`sw.js?v=${encodeURIComponent(BUILD_ID)}`, document.baseURI);
      void navigator.serviceWorker.register(worker).catch((error: unknown) => {
        console.warn('[pwa] воркер не встал', error);
      });
    };
    if (document.readyState === 'complete') install();
    else window.addEventListener('load', install, { once: true });
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Не найден корневой элемент #root');

  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );

  /*
   * Панель отладки — после приложения и в своём корне.
   *
   * Весь клей с приложением собран здесь: сам каталог devkit/ не импортирует
   * отсюда ничего и переносится в другой проект целиком (см. devkit/index.ts).
   *
   * Адрес свой, а не VITE_SYNC_URL: тот гасится в демо (demo/mode.ts →
   * sync/transport.ts), и панель молча исчезала бы ровно там, где чаще всего
   * смотрят на интерфейс. Откат на адрес синхронизации — решение приложения,
   * а не панели: в этом проекте сервер один и тот же, и настраивать два
   * одинаковых адреса незачем.
   */
  mountDevkit({
    endpoint: import.meta.env.VITE_DEVKIT_URL ?? import.meta.env.VITE_SYNC_URL ?? '',
    app: 'mypri',
    build: { id: BUILD_ID, time: BUILD_TIME },
    route: readCurrentRoute,
    snapshot: readDiagnosticSnapshot,
    client: () => ({
      platform: clientInfo.platform,
      version: clientInfo.version,
      telegram: clientInfo.isTelegram,
      /* Полноэкранный режим включает клиент, а не приложение, и от него зависят
         сразу две жалобы: неподвижное окно на компьютере и спрятанная панель
         навигации на Android. В тикете это должно быть видно. */
      fullscreen: clientInfo.openedFullscreen,
      /* Мы внутри клиента, но SDK не доехал. Без этой отметки «данные не
         синхронизируются» неотличимо от «облако отказало». */
      sdkMissing,
    }),
    flags: () => ({
      demo: DEMO_MODE,
      guest: GUEST_MODE,
      pwa: window.matchMedia('(display-mode: standalone)').matches,
    }),
    authToken: () => ensureSession().then((session) => session?.access),
    /* Внутри мини-аппа параметр приезжает не адресной строкой, а через клиент:
       t.me/<бот>/app?startapp=test_<ключ>. Тот же приём, что у ссылок демо. */
    invite: () => (startParam?.startsWith(TEST_PREFIX) ? startParam.slice(TEST_PREFIX.length) : undefined),
    visible: () => startParam === DEVKIT_PARAM,
    haptics,
    backButton,
    // Демо не оставляет следов на устройстве: очередь тикетов не исключение.
    ephemeral: DEMO_MODE,
  });
}
