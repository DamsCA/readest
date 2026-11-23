import { createSupabaseAdminClient } from '@/utils/supabase';

export const USAGE_TYPES = {
  TRANSLATION_CHARS: 'translation_chars',
} as const;

export const QUOTA_TYPES = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export type Reservation = { status: 'ok' | 'over' | 'error'; total: number };

export class UsageStatsManager {
  // Reserve `amount` against `cap` BEFORE doing the paid work: the amount is
  // counted first (one atomic upsert), then the period's total is read back,
  // so parallel requests cannot all pass the same check. Over the cap the
  // amount is handed back. Any database error also hands it back and answers
  // 'error': the caller refuses, a hiccup must never lift a cap (fail closed).
  static async reserve(
    userId: string,
    usageType: string,
    amount: number,
    period: 'daily' | 'monthly',
    cap: number,
    metadata: Record<string, string | number> = {},
  ): Promise<Reservation> {
    try {
      const supabase = createSupabaseAdminClient();
      const inc = await supabase.rpc('increment_daily_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: amount,
        p_metadata: metadata,
      });
      if (inc.error) return { status: 'error', total: 0 };
      const cur = await supabase.rpc('get_current_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_period: period,
      });
      const total = Number(cur.data);
      if (cur.error || !Number.isFinite(total)) {
        await UsageStatsManager.release(userId, usageType, amount);
        return { status: 'error', total: 0 };
      }
      if (total > cap) {
        await UsageStatsManager.release(userId, usageType, amount);
        return { status: 'over', total: total - amount };
      }
      return { status: 'ok', total };
    } catch {
      return { status: 'error', total: 0 };
    }
  }

  // Hand back a reservation whose work did not happen (upstream failure).
  static async release(userId: string, usageType: string, amount: number): Promise<void> {
    try {
      await createSupabaseAdminClient().rpc('increment_daily_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: -amount,
        p_metadata: { source: 'release' },
      });
    } catch {
      // Nothing more to do: the reader just loses that amount for the period.
    }
  }

  static async trackUsage(
    userId: string,
    usageType: string,
    increment: number = 1,
    metadata: Record<string, string | number> = {},
  ): Promise<number> {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc('increment_daily_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_usage_date: new Date().toISOString().split('T')[0],
        p_increment: increment,
        p_metadata: metadata,
      });

      if (error) {
        console.error('Usage tracking error:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Usage tracking failed:', error);
      return 0;
    }
  }

  static async getCurrentUsage(
    userId: string,
    usageType: string,
    period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc('get_current_usage', {
        p_user_id: userId,
        p_usage_type: usageType,
        p_period: period,
      });

      if (error) {
        console.error('Get current usage error:', error);
        return 0;
      }

      return data || 0;
    } catch (error) {
      console.error('Get current usage failed:', error);
      return 0;
    }
  }
}
