import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { QuotaType, UserPlan } from '@/types/quota';
import { getStoragePlanData, getTranslationPlanData, getUserProfilePlan } from '@/utils/access';
import { useTranslation } from './useTranslation';

export const useQuotaStats = (briefName = false) => {
  const _ = useTranslation();
  const { token, user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    if (!user || !token) return;

    const storagPlan = getStoragePlanData(token);
    const inGB = storagPlan.quota > 1e9;
    const storageQuota: QuotaType = {
      name: briefName ? _('Storage') : _('Cloud Sync Storage'),
      tooltip: _('{{percentage}}% of Cloud Sync Space Used.', {
        percentage: Math.round((storagPlan.usage / storagPlan.quota) * 100),
      }),
      used: parseFloat((storagPlan.usage / 1024 / 1024 / (inGB ? 1024 : 1)).toFixed(2)),
      total: Math.round((storagPlan.quota / 1024 / 1024 / (inGB ? 1024 : 1)) * 10) / 10,
      unit: inGB ? 'GB' : 'MB',
    };
    const translationPlan = getTranslationPlanData(token);
    const now = new Date();
    const translationResetAt = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const translationQuota: QuotaType = {
      name: briefName ? _('Translation') : _('Translation Characters'),
      tooltip: _('{{percentage}}% of Daily Translation Characters Used.', {
        percentage: Math.round((translationPlan.usage / translationPlan.quota) * 100),
      }),
      used: Math.round(translationPlan.usage / 1024),
      total: Math.round(translationPlan.quota / 1024),
      unit: 'K',
      resetAt: translationResetAt,
    };
    setUserProfilePlan(getUserProfilePlan(token));
    // Lis et Lead meters its AI translation on its own server (api/ai/translate),
    // not with this daily character quota: showing it ("0 / 10 K") only confused.
    void translationQuota;
    setQuotas([storageQuota]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    quotas,
    userProfilePlan,
  };
};
