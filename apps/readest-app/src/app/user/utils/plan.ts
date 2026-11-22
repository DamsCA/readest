import type { StripeAvailablePlan } from '@/libs/payment/stripe/client';
import type { AvailablePlan, PlanInterval, PlanType, QuotaFeature, UserPlan } from '@/types/quota';
import { stubTranslation as _ } from '@/utils/misc';

type FeatureType = {
  label: string;
  description?: string;
};

type ProductInfo = {
  id: string;
  name: string;
  feature: QuotaFeature;
  price: number; // in cents
  currency: string;
};

export type PlanDetails = {
  name: string;
  plan: UserPlan;
  type: PlanType;
  color: string;
  hintColor: string;
  price: number; // in cents
  currency: string;
  productId?: string;
  interval: string;
  features: FeatureType[];
  limits?: Record<string, string | number>;
  products?: ProductInfo[];
};

const getProductFeature = (productId: string): QuotaFeature | undefined => {
  const features: QuotaFeature[] = ['storage', 'translation', 'tokens', 'customization'];
  const lowerId = productId.toLowerCase();
  for (const feature of features) {
    if (lowerId.includes(feature)) {
      return feature;
    }
  }

  return undefined;
};

export function getPlanDetails(
  planCode: UserPlan,
  availablePlans: (AvailablePlan & StripeAvailablePlan)[],
  interval: PlanInterval = 'month',
): PlanDetails {
  const availablePlan = availablePlans.find(
    (plan) => plan.plan === planCode && (!plan.interval || plan.interval === interval),
  );
  const currency = availablePlans?.[0]?.currency ?? 'USD';
  switch (planCode) {
    case 'purchase': {
      const purchasableProducts: ProductInfo[] = availablePlans
        .filter((plan) => plan.plan === planCode)
        .sort((a, b) => a.price - b.price)
        .map((plan) => {
          return {
            id: plan.productId,
            name: plan.productName,
            feature: plan.metadata?.feature || getProductFeature(plan.productId) || 'generic',
            price: plan.price,
            currency: plan.currency,
          } as ProductInfo;
        });
      return {
        name: _('Lifetime Plan'),
        plan: planCode,
        type: 'purchase',
        color: 'bg-green-100 text-green-800',
        hintColor: 'text-green-800/75',
        price: availablePlan?.price || 1999,
        currency,
        productId: availablePlan?.productId,
        interval: _('lifetime'),
        features: [
          {
            label: _('One-Time Payment'),
            description: _(
              'Make a single payment to enjoy lifetime access to specific features on all devices. Purchase specific features or services only when you need them.',
            ),
          },
          {
            label: _('Expand Cloud Sync Storage'),
            description: _(
              'Expand your cloud storage forever with a one-time purchase. Each additional purchase adds more space.',
            ),
          },
          {
            label: _('Unlock All Customization Options'),
            description: _(
              'Unlock additional themes, fonts, layout options and read aloud, translators, cloud storage services.',
            ),
          },
        ],
        products: purchasableProducts,
      };
    }
    // Lis et Lead's two plans (22 Nov 2026): the free plan shows what it lacks,
    // so the difference with Plus is felt in reading, not just read about.
    case 'free':
      return {
        name: _('Gratuit'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-gray-200 text-gray-800',
        hintColor: 'text-gray-800/75',
        price: 0,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Votre bibliothèque partout'),
            description: _(
              'Vos livres, votre progression, vos surlignages et vos notes sur tous vos appareils.',
            ),
          },
          {
            label: _('Traduction standard'),
            description: _(
              'Une traduction automatique classique, souvent mot à mot. Pour goûter la traduction IA : 20 paragraphes par jour.',
            ),
          },
          {
            label: _('Voix standard'),
            description: _(
              'Des voix de synthèse classiques pour écouter vos livres. Pour goûter les voix premium : 2 minutes par mois.',
            ),
          },
          {
            label: _('Un livre offert'),
            description: _('« Ça marche », dans votre bibliothèque dès l’inscription.'),
          },
        ],
        limits: {
          [_('Stockage en ligne')]: '500 Mo',
          [_('Traduction IA')]: _('20 paragraphes par jour'),
        },
      };
    case 'plus':
      return {
        name: _('Plus'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-blue-200 text-blue-800',
        hintColor: 'text-blue-800/75',
        price: availablePlan?.price || 499,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Tout le gratuit, et en plus :'),
          },
          {
            label: _('Traduction IA naturelle'),
            description: _(
              'Les expressions rendues comme par un traducteur humain : « il pleut des cordes », pas « il pleut des chats et des chiens ». Jusqu’à 300 000 caractères par jour.',
            ),
          },
          {
            label: _('Voix naturelles premium'),
            description: _(
              'Des voix expressives, proches d’un vrai lecteur, pour écouter vos livres : 1 heure par mois.',
            ),
          },
          {
            label: _('Stockage en ligne'),
            description: _('Jusqu’à 5 Go pour toute votre bibliothèque.'),
          },
        ],
        limits: {
          [_('Stockage en ligne')]: '5 Go',
          [_('Traduction IA')]: _('300 000 caractères par jour'),
        },
      };
    case 'pro':
      return {
        name: _('Pro Plan'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-purple-200 text-purple-800',
        hintColor: 'text-purple-800/75',
        price: availablePlan?.price || 999,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        features: [
          {
            label: _('Includes All Plus Plan Benefits'),
          },
          {
            label: _('Early Feature Access'),
            description: _(
              'Be the first to explore new features, updates, and innovations before anyone else.',
            ),
          },
          {
            label: _('Advanced AI Tools'),
            description: _(
              'Harness powerful AI tools for smarter reading, translation, and content discovery.',
            ),
          },
          {
            label: _('DeepL Pro Access'),
            description: _(
              'Translate up to 500,000 characters daily with the most accurate translation engine available.',
            ),
          },
          {
            label: _('Cloud Sync Storage'),
            description: _(
              'Securely store and access your entire reading collection with up to 20 GB of cloud storage.',
            ),
          },
        ],
        limits: {
          [_('Cloud Sync Storage')]: '20 GB',
          [_('AI Translations (per day)')]: '500K',
        },
      };
    default:
      return getPlanDetails('free', availablePlans);
  }
}
