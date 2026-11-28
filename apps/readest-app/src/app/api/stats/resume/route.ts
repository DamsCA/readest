import { NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { getStripe } from '@/libs/payment/stripe/server';
import { COOKIE_PROPRIETAIRE, empreinteReseau } from '@/utils/empreinte';

// The owner's dashboard (/stats), for the accounts listed in public.admins_stats
// only. Audience and sign-ups come from the database (stats_visites,
// docker/volumes/db/ouiread/ouiread-visites.sql); subscriptions and payments
// come from Stripe itself, since the database keeps no payment. The Stripe
// account also serves other products: only Lis et Lead's customers (table
// customers) are kept.
// Opening this page also stops counting the owner (24 Nov 2026): the device
// gets a cookie the audience route obeys, and today's network is listed in
// reseaux_proprietaire, which stats_visites leaves out.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

interface ClientStripe {
  stripe_customer_id: string;
  email: string | null;
  vous: boolean;
}

const date = (secondes: number | null | undefined) =>
  secondes
    ? new Date(secondes * 1000).toLocaleString('fr-FR', {
        timeZone: 'Indian/Reunion',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

const idClient = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) =>
  typeof c === 'string' ? c : (c?.id ?? null);

const argent = async (clients: ClientStripe[], jours: number) => {
  const parClient = new Map(clients.map((c) => [c.stripe_customer_id, c]));
  if (parClient.size === 0) {
    return { abonnes: 0, mensuel_recurrent: 0, encaisse: 0, abonnements: [], paiements: [] };
  }
  const stripe = getStripe();
  const maintenant = Math.floor(Date.now() / 1000);

  const subs = await stripe.subscriptions.list({ status: 'all', limit: 100 });
  const abonnements = subs.data
    .filter((s) => parClient.has(idClient(s.customer) ?? ''))
    .map((s) => {
      const client = parClient.get(idClient(s.customer) ?? '')!;
      const article = s.items.data[0];
      const prix = article?.price;
      const fin =
        (article as unknown as { current_period_end?: number })?.current_period_end ??
        (s as unknown as { current_period_end?: number }).current_period_end;
      return {
        email: client.email,
        vous: client.vous,
        statut: s.status,
        formule: prix?.recurring?.interval === 'year' ? 'annuel' : 'mensuel',
        montant: (prix?.unit_amount ?? 0) / 100,
        devise: (prix?.currency ?? 'eur').toUpperCase(),
        debut: date(s.start_date),
        fin: date(fin),
        termine: date(s.ended_at),
        resilie: s.cancel_at_period_end || !!s.canceled_at,
      };
    });
  const actifs = abonnements.filter(
    (a) => !a.vous && (a.statut === 'active' || a.statut === 'trialing') && !a.resilie,
  );
  const mensuel = actifs.reduce(
    (total, a) => total + (a.formule === 'annuel' ? a.montant / 12 : a.montant),
    0,
  );

  const charges = await stripe.charges.list({
    limit: 100,
    created: { gte: maintenant - 90 * 86400 },
  });
  const paiements = charges.data
    .filter((c) => parClient.has(idClient(c.customer) ?? ''))
    .map((c) => {
      const client = parClient.get(idClient(c.customer) ?? '')!;
      return {
        le: date(c.created),
        cree: c.created,
        email: client.email,
        vous: client.vous,
        montant: c.amount / 100,
        rembourse: c.amount_refunded / 100,
        devise: c.currency.toUpperCase(),
        statut: c.status,
      };
    });
  const depuis = maintenant - jours * 86400;
  const encaisse = paiements
    .filter((p) => !p.vous && p.statut === 'succeeded' && p.cree >= depuis)
    .reduce((total, p) => total + p.montant - p.rembourse, 0);

  return {
    abonnes: actifs.length,
    mensuel_recurrent: Math.round(mensuel * 100) / 100,
    encaisse: Math.round(encaisse * 100) / 100,
    abonnements,
    paiements: paiements.map(({ cree: _cree, ...p }) => p),
  };
};

export async function GET(req: NextRequest) {
  const { user } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  const admin = createSupabaseAdminClient();
  const { data: autorise } = await admin
    .from('admins_stats')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!autorise) return json({ error: 'FORBIDDEN' }, 403);

  const { error: erreurReseau } = await admin
    .from('reseaux_proprietaire')
    .upsert({ reseau: await empreinteReseau(req) }, { onConflict: 'reseau' });
  if (erreurReseau) console.error('reseaux_proprietaire:', erreurReseau.message);

  const demande = Number(new URL(req.url).searchParams.get('jours')) || 7;
  const jours = Math.min(90, Math.max(1, Math.round(demande)));
  const { data, error } = await admin.rpc('stats_visites', { jours });
  if (error) return json({ error: error.message }, 500);

  const { clients_stripe: clients, ...stats } = (data ?? {}) as {
    clients_stripe?: ClientStripe[];
  } & Record<string, unknown>;
  let paye: unknown;
  try {
    paye = await argent(clients ?? [], jours);
  } catch (e) {
    console.error('stats stripe:', e);
    paye = { erreur: 'Stripe ne répond pas pour le moment.' };
  }
  // What readers do once inside (28 Nov 2026): unique visitors per event over the
  // period, read straight from public.visites (the owner's devices never reach it).
  const LECTURE = [
    'livre_ouvert',
    'traduction_lancee',
    'ecoute_lancee',
    'quota_atteint',
    'quota_voix',
    'plus_vu',
    'achat_commence',
    'achat_reussi',
    'offerts_vus',
    'offert_ajoute',
    'invitation_appli',
  ];
  const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
  const { data: lignes, error: erreurLecture } = await admin
    .from('visites')
    .select('evenement, visiteur')
    .in('evenement', LECTURE)
    .gte('at', depuis)
    .limit(20000);
  if (erreurLecture) console.error('stats lecture:', erreurLecture.message);
  const lecture: Record<string, number> = Object.fromEntries(LECTURE.map((e) => [e, 0]));
  const vus = new Set<string>();
  for (const l of (lignes ?? []) as { evenement: string; visiteur: string | null }[]) {
    const cle = `${l.evenement}|${l.visiteur ?? Math.random()}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    lecture[l.evenement] = (lecture[l.evenement] ?? 0) + 1;
  }
  const reponse = json({ ...stats, jours, argent: paye, lecture });
  // Five years; SameSite=None so the bio page's events (sent from
  // legenieendormi.web.app) carry it too where the browser allows.
  reponse.headers.append(
    'Set-Cookie',
    `${COOKIE_PROPRIETAIRE}=1; Path=/; Max-Age=157680000; Secure; SameSite=None`,
  );
  return reponse;
}
