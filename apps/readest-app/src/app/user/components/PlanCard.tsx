import { IoCheckmark } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import { PlanDetails } from '../utils/plan';
import { PlanType } from '@/types/quota';
import PlanActionButton from './PlanActionButton';
import PurchaseCallToActions from './PurchaseCallToActions';

interface PlanCardProps {
  plan: PlanDetails;
  isUserPlan: boolean;
  comingSoon?: boolean;
  upgradable?: boolean;
  index: number;
  currentPlanIndex: number;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
  onSelectPlan: (index: number) => void;
}

const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  isUserPlan,
  comingSoon,
  upgradable,
  index,
  currentPlanIndex,
  onSubscribe,
  onSelectPlan,
}) => {
  const _ = useTranslation();
  const { price, currency } = plan;
  const money = (cents: number) =>
    new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: Math.round(cents) % 100 === 0 ? 0 : 2,
    }).format(Math.round(cents) / 100);
  const formattedPrice = money(price);
  // A paid plan reads by the month, and by the day: « 5 €/mois, moins de
  // 17 centimes par jour » weighs less than « 59,99 €/an ».
  const yearly = plan.interval === 'year';
  const shownPrice = yearly ? money(price / 12) : formattedPrice;
  // Always strictly above the real figure, so « moins de » stays true.
  const perDay = Math.floor(price / (yearly ? 365 : 30)) + 1;

  return (
    <div
      key={plan.plan}
      className='w-full flex-shrink-0 px-4 py-6 sm:w-auto sm:max-w-96 sm:flex-1 sm:px-2'
      style={{ scrollSnapAlign: 'start' }}
    >
      <div
        className={`rounded-xl border-2 p-4 ${plan.color} ${index === currentPlanIndex ? 'ring-2 ring-[#e8c06a]' : ''}`}
      >
        <div className='mb-6 text-center'>
          <h4 className='mb-2 text-2xl font-bold'>{_(plan.name)}</h4>
          <div className='text-3xl font-bold'>
            {plan.plan !== 'purchase' && price === 0 ? (
              // The free plan has no billing period: "0,00 €/année" read oddly.
              <>0 €</>
            ) : plan.plan !== 'purchase' ? (
              <>
                {shownPrice}
                <span className='text-lg font-normal'>/{_('month')}</span>
              </>
            ) : (
              <span className='text-lg font-normal'>{_('On-Demand Purchase')}</span>
            )}
          </div>
          {plan.plan !== 'purchase' && price > 0 && (
            <p className={`mt-1 text-sm ${plan.hintColor}`}>
              {yearly
                ? _('{{price}} par an, soit moins de {{cents}} centimes par jour', {
                    price: formattedPrice,
                    cents: perDay,
                  })
                : _('Moins de {{cents}} centimes par jour', { cents: perDay })}
            </p>
          )}
          {plan.pitch && (
            <p className='mx-auto mt-4 max-w-xs font-serif text-lg italic leading-snug'>
              {_(plan.pitch)}
            </p>
          )}
        </div>

        <div role='none' className='mb-6 space-y-3' onClick={() => onSelectPlan(index)}>
          {plan.features.map((feature, featureIndex) => (
            <div key={featureIndex} className='flex flex-col'>
              <div className='flex items-center gap-2'>
                <IoCheckmark
                  className={`h-5 w-5 flex-shrink-0 ${plan.checkColor ?? 'text-green-500'}`}
                />
                <span className='font-medium'>{_(feature.label)}</span>
              </div>
              {feature.description && (
                <div className={`ms-7 text-sm sm:text-xs ${plan.hintColor}`}>
                  {_(feature.description)}
                </div>
              )}
            </div>
          ))}
        </div>

        {plan.limits && Object.keys(plan.limits).length > 0 && (
          <div
            role='none'
            className='mb-6 rounded-lg bg-white/50 p-4'
            onClick={() => onSelectPlan(index)}
          >
            <h5 className='mb-3 font-semibold'>{_('Plan Limits')}</h5>
            <div className='space-y-2'>
              {Object.entries(plan.limits).map(([key, value]) => (
                <div key={key} className='flex justify-between text-sm'>
                  <span>{_(key)}:</span>
                  <span className='font-medium'>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {plan.plan === 'purchase' && (
          <PurchaseCallToActions plan={plan} onSubscribe={onSubscribe} />
        )}

        {plan.plan !== 'purchase' && (
          <PlanActionButton
            plan={plan}
            comingSoon={comingSoon}
            upgradable={upgradable}
            isUserPlan={isUserPlan}
            onSubscribe={onSubscribe}
            onSelectPlan={onSelectPlan}
          />
        )}
      </div>
    </div>
  );
};

export default PlanCard;
