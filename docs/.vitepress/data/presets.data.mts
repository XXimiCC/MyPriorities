/*
 * Готовые наборы — из src/domain/presets.ts.
 *
 * Десять наборов по семь приоритетов — это семьдесят строк, которые никто не
 * станет править руками дважды.
 */

import { PRESETS } from '../../../src/domain/presets';
import { NEON_PALETTE } from '../../../src/domain/palette';

export default {
  load() {
    return {
      count: PRESETS.length,
      presets: PRESETS.map((preset) => ({
        id: preset.id,
        name: preset.name,
        tagline: preset.tagline,
        accent: NEON_PALETTE[preset.accentId % NEON_PALETTE.length]!.hex,
        priorities: preset.priorities.map((item) => ({
          title: item.title,
          hex: NEON_PALETTE[item.colorId % NEON_PALETTE.length]!.hex,
        })),
      })),
    };
  },
};
