import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/libs/payment/stripe/server';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

// The Stripe account also serves another business, whose default portal
// settings must stay as they are: Lis et Lead has its own configuration
// (tagged metadata.app = lisetlead), created the first time it is needed.
// Cancelling keeps Plus until the end of the paid period (CGV §4).
const PORTAL_APP = 'lisetlead';
let portalConfigurationId: string | null = null;
const getPortalConfiguration = async (origin: string) => {
  if (portalConfigurationId) return portalConfigurationId;
  const stripe = getStripe();
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 50 });
  const found = existing.data.find((c) => c.metadata?.['app'] === PORTAL_APP);
  if (found) {
    portalConfigurationId = found.id;
    return found.id;
  }
  const created = await stripe.billingPortal.configurations.create({
    name: 'Lis et Lead',
    metadata: { app: PORTAL_APP },
    business_profile: {
      headline: 'Lis et Lead : gérez votre abonnement Plus',
      privacy_policy_url: `${origin}/confidentialite`,
      terms_of_service_url: `${origin}/cgv`,
    },
    default_return_url: `${origin}/user`,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'unused', 'other'],
        },
      },
    },
  });
  portalConfigurationId = created.id;
  return created.id;
};

export async function POST(request: NextRequest) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: customerData } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!customerData?.stripe_customer_id) {
      throw new Error('Customer not found');
    }

    const stripe = getStripe();
    const origin = request.headers.get('origin') || '';
    const session = await stripe.billingPortal.sessions.create({
      customer: customerData.stripe_customer_id,
      configuration: await getPortalConfiguration(origin),
      return_url: `${origin}/user`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error creating portal session' }, { status: 500 });
  }
}
