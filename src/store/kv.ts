/**
 * Договор хранилища «ключ → строка».
 *
 * Лежит отдельно от реализаций намеренно: за этим интерфейсом уже стоят
 * CloudStorage, локальная копия и память, а впереди — сетевой бэкенд. Пока
 * договор один, подмена транспорта остаётся правкой одной строки.
 */

/** Две копии одного ключа: облачная и локальная. Слияние — забота слоя выше. */
export interface ValuePair {
  local?: string;
  remote?: string;
}

export interface KeyValueStore {
  readonly kind: 'cloud' | 'local';
  get(keys: string[]): Promise<Record<string, string>>;
  /**
   * То же чтение, но обе копии по отдельности.
   *
   * Нужно там, где «облако побеждает целиком» теряет данные: месяц истории —
   * это один ключ, и запись со второго устройства затирала всё, что накопило
   * первое. Кто и как сливает содержимое, знает persistence, а не транспорт.
   */
  getPair(keys: string[]): Promise<Record<string, ValuePair>>;
  set(key: string, value: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
  /** Облако было выбрано, но отказало на ходу — синхронизации между устройствами нет. */
  isDegraded(): boolean;
}
