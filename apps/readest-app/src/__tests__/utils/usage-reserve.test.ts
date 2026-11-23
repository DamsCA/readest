import { describe, it, expect, vi, beforeEach } from 'vitest';

// UsageStatsManager.reserve counts first, then reads the period total back:
// over the cap the amount is handed back; any database error refuses.

const db = vi.hoisted(() => ({
  rows: 0,
  incrementFails: false,
  readFails: false,
  calls: [] as Array<{ fn: string; inc?: number }>,
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (fn: string, args: { p_increment?: number }) => {
      db.calls.push({ fn, inc: args.p_increment });
      if (fn === 'increment_daily_usage') {
        if (db.incrementFails) return { data: null, error: { message: 'down' } };
        db.rows += args.p_increment!;
        return { data: db.rows, error: null };
      }
      if (db.readFails) return { data: null, error: { message: 'down' } };
      return { data: db.rows, error: null };
    },
  }),
}));

import { UsageStatsManager } from '@/utils/usage';

describe('UsageStatsManager.reserve', () => {
  beforeEach(() => {
    db.rows = 0;
    db.incrementFails = false;
    db.readFails = false;
    db.calls = [];
  });

  it('keeps the amount when the total stays under the cap', async () => {
    expect(await UsageStatsManager.reserve('u', 't', 40, 'monthly', 100)).toEqual({
      status: 'ok',
      total: 40,
    });
    expect(db.rows).toBe(40);
  });

  it('hands the amount back over the cap', async () => {
    db.rows = 90;
    expect((await UsageStatsManager.reserve('u', 't', 40, 'monthly', 100)).status).toBe('over');
    expect(db.rows).toBe(90);
  });

  it('lets parallel requests through only up to the cap', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => UsageStatsManager.reserve('u', 't', 30, 'monthly', 100)),
    );
    expect(results.filter((r) => r.status === 'ok').length).toBeLessThanOrEqual(3);
    expect(db.rows).toBeLessThanOrEqual(100);
  });

  it('refuses when the count cannot be written or read', async () => {
    db.incrementFails = true;
    expect((await UsageStatsManager.reserve('u', 't', 10, 'daily', 100)).status).toBe('error');
    db.incrementFails = false;
    db.readFails = true;
    expect((await UsageStatsManager.reserve('u', 't', 10, 'daily', 100)).status).toBe('error');
    expect(db.rows).toBe(0);
  });
});
