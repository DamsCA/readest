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
  /** One line under the price: what the plan changes for the reader. */
  pitch?: string;
  /** Colour of the ticks, and of the action button. */
  checkColor?: string;
  buttonColor?: string;
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
    // Lis et Lead's two plans. The texts sell the reading, not the machinery
    // (23 Nov 2026: « des textes marketing de haut niveau… qui donnent envie de
    // prendre un abonnement »): the free plan gives a real taste of everything,
    // Plus keeps it for the whole book. No caps or figures for the reader: those
    // are in the CGV.
    case 'free':
      return {
        name: _('Gratuit'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-[#f3ecdd] text-[#16241f] border-[#16241f]/10',
        hintColor: 'text-[#16241f]/70',
        checkColor: 'text-[#16241f]/60',
        price: 0,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        pitch: _('Pour découvrir, sur vos propres livres.'),
        features: [
          {
            label: _('Votre bibliothèque, partout'),
            description: _(
              'Vos livres, votre page, vos surlignages et vos notes vous suivent sur tous vos appareils.',
            ),
          },
          {
            label: _('Traduction standard'),
            description: _(
              'Une traduction automatique classique, pour comprendre. Et chaque jour, un avant-goût de la traduction IA.',
            ),
          },
          {
            label: _('Voix standard'),
            description: _(
              'Des voix de synthèse pour écouter vos livres, et un avant-goût des voix premium.',
            ),
          },
          {
            label: _('« Ça marche », offert'),
            description: _(
              'Le petit classique de R. H. Jarrett vous attend dans votre bibliothèque.',
            ),
          },
        ],
      };
    case 'plus':
      return {
        name: _('Plus'),
        plan: planCode,
        type: 'subscription',
        color: 'bg-[#16241f] text-[#f3ecdd] border-[#e8c06a]/40',
        hintColor: 'text-[#f3ecdd]/70',
        checkColor: 'text-[#e8c06a]',
        buttonColor: 'bg-[#e8c06a] text-[#16241f] hover:bg-[#f3d58f]',
        price: availablePlan?.price || 699,
        currency,
        productId: availablePlan?.productId,
        interval: interval === 'month' ? _('month') : _('year'),
        pitch: _('Les grands livres du monde, comme s’ils avaient été écrits en français.'),
        features: [
          {
            label: _('Tout le gratuit, et en plus :'),
          },
          {
            label: _('Une traduction digne d’un traducteur'),
            description: _(
              'Le sens, le ton et les expressions : « il pleut des cordes », jamais « il pleut des chats et des chiens ». Du vrai français, du premier chapitre au dernier.',
            ),
          },
          {
            label: _('Des voix qui donnent vie au livre'),
            description: _(
              'Des voix premium expressives, qui respirent avec le texte. Vos trajets, votre sport, vos tâches deviennent des heures de lecture.',
            ),
          },
          {
            label: _('Toute votre bibliothèque en ligne'),
            description: _('Tous vos livres retrouvés intacts, sur chaque appareil.'),
          },
          {
            label: _('Sans engagement'),
            description: _(
              'Vous arrêtez quand vous voulez, depuis votre compte, et Plus reste actif jusqu’au bout de la période payée.',
            ),
          },
        ],
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
