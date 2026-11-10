import { describe, it, expect, vi, afterEach } from 'vitest';
import { averApi } from '../aver-import';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = 'rpk_' + 'a'.repeat(43);
afterEach(() => vi.unstubAllEnvs());
describe('Aver partner credentials', () => {
  it('selects only this pharmacy credential and never falls back to the shared secret', () => {
    vi.stubEnv('AVER_PARTNER_KEYS', JSON.stringify({ [id]: token }));
    vi.stubEnv('AVER_SLIP_SECRET', 'old-global-secret');
    expect(averApi(id)?.secret).toBe(token);
    expect(averApi(other)).toBeNull();
    expect(averApi('__proto__')).toBeNull();
  });
  it('fails closed for missing, malformed and invalid registries', () => {
    for (const value of ['', '{', 'null', '[]', '{}', JSON.stringify({ [id]: 'old-global-secret' })]) {
      vi.stubEnv('AVER_PARTNER_KEYS', value);
      expect(averApi(id)).toBeNull();
    }
  });
});
