'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { CLE_PROPRIETAIRE } from '@/utils/mesure';
import { supabase } from '@/utils/supabase';

// The owner's dashboard (23-24 Nov 2026: « c'est pas normal de pas savoir s'il
// y a des visiteurs », then « un dashboard pour suivre qui visite la page, qui
// s'inscrit, qui a payé »). Figures from /api/stats/resume (database + Stripe),
// refreshed every minute; only the accounts in public.admins_stats can read
// them. The owner's own accounts are shown as « vous » and left out of totals.

interface Ligne {
  jour: string;
  visiteurs: number;
  clics_inscription: number;
  inscriptions: number;
}
interface Inscrit {
  email: string | null;
  via: string;
  le: string;
  derniere: string | null;
  plan: string;
  livres: number;
  vous: boolean;
}
interface Abonnement {
  email: string | null;
  vous: boolean;
  statut: string;
  formule: string;
  montant: number;
  devise: string;
  debut: string | null;
  fin: string | null;
  termine: string | null;
  resilie: boolean;
}
interface Paiement {
  le: string | null;
  email: string | null;
  vous: boolean;
  montant: number;
  rembourse: number;
  devise: string;
  statut: string;
}
interface Argent {
  abonnes?: number;
  mensuel_recurrent?: number;
  encaisse?: number;
  abonnements?: Abonnement[];
  paiements?: Paiement[];
  erreur?: string;
}
interface Stats {
  jours: number;
  entonnoir: { visiteurs: number; invitation: number; clic: number; inscrits: number };
  bio?: {
    visiteurs_24h: number;
    visiteurs: number;
    kevin: number;
    liseuse: number;
    cadeau: number;
    telegram: number;
    arrivee: number;
  };
  par_jour: Ligne[];
  inscrits: Inscrit[];
  provenances: { provenance: string; visiteurs: number }[];
  appareils: { appareil: string; visiteurs: number }[];
  pays: { pays: string; visiteurs: number }[];
  derniers: {
    heure: string;
    evenement: string;
    chemin: string | null;
    provenance: string | null;
    pays: string | null;
    appareil: string | null;
  }[];
  argent: Argent;
}

const NOMS: Record<string, string> = {
  vue: 'a ouvert',
  invitation_vue: 'a vu la fenêtre du livre offert',
  invitation_google: 'a cliqué « Recevoir mon livre avec Google »',
  invitation_apple: 'a cliqué « Recevoir mon livre avec Apple »',
  invitation_email: 'a cliqué « Avec mon adresse e-mail »',
  invitation_fermee: 'a fermé la fenêtre',
  invitation_navigateur: 'a touché « Ouvrir dans mon navigateur »',
  bio_vue: 'a ouvert la page de la bio',
  bio_kevin: 'a cliqué « Recevoir le livre gratuit » (Kevin)',
  bio_liseuse: 'a cliqué « Ouvrir Lis et Lead »',
  bio_cadeau: 'a cliqué « Recevoir Ça marche »',
  bio_telegram: 'a cliqué la communauté Telegram',
  bio_arrivee: 'est arrivé au bout du chemin',
};

const VIA: Record<string, string> = { google: 'Google', apple: 'Apple', email: 'E-mail' };
const STATUTS: Record<string, string> = {
  active: 'Actif',
  trialing: 'Essai',
  past_due: 'Paiement en retard',
  canceled: 'Terminé',
  unpaid: 'Impayé',
  incomplete: 'Incomplet',
  incomplete_expired: 'Expiré',
  paused: 'En pause',
  succeeded: 'Payé',
  pending: 'En cours',
  failed: 'Échoué',
};
const PERIODES = [
  { jours: 1, nom: '24 h' },
  { jours: 7, nom: '7 jours' },
  { jours: 30, nom: '30 jours' },
];

const jourCourt = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};
const euros = (n: number | undefined, devise = 'EUR') =>
  (n ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: devise });
const part = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

export default function StatsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [jours, setJours] = useState(7);
  const [etat, setEtat] = useState<'charge' | 'ok' | 'connexion' | 'interdit' | 'erreur'>('charge');
  const [maj, setMaj] = useState('');

  const charger = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const jeton = data.session?.access_token ?? token;
    if (!jeton) {
      setEtat('connexion');
      return;
    }
    try {
      const res = await fetch(`/api/stats/resume?jours=${jours}`, {
        headers: { Authorization: `Bearer ${jeton}` },
        cache: 'no-store',
      });
      if (res.status === 401) return setEtat('connexion');
      if (res.status === 403) return setEtat('interdit');
      if (!res.ok) return setEtat('erreur');
      setStats((await res.json()) as Stats);
      // This device is the owner's: never count it again (utils/mesure.ts).
      try {
        localStorage.setItem(CLE_PROPRIETAIRE, '1');
      } catch {
        // The server-side cookie still covers it.
      }
      setMaj(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      setEtat('ok');
    } catch {
      setEtat('erreur');
    }
  }, [token, jours]);

  useEffect(() => {
    void charger();
    const t = setInterval(() => void charger(), 60_000);
    return () => clearInterval(t);
  }, [charger]);

  const e = stats?.entonnoir;
  const a = stats?.argent;
  const periode = PERIODES.find((p) => p.jours === jours)?.nom ?? `${jours} jours`;
  const etapes = e
    ? [
        { nom: 'Visiteurs', n: e.visiteurs },
        { nom: 'Ont vu le livre offert', n: e.invitation },
        { nom: 'Ont cliqué pour s’inscrire', n: e.clic },
        { nom: 'Se sont inscrits', n: e.inscrits },
      ]
    : [];
  const maxJour = Math.max(1, ...(stats?.par_jour ?? []).map((l) => l.visiteurs));

  return (
    <main className='lel-stats'>
      <style>{STYLES}</style>
      <header className='lel-stats__haut'>
        <div>
          <h1>Tableau de bord</h1>
          <p>
            Lis et Lead · {maj ? `mis à jour à ${maj}` : 'chargement…'}
            {maj && ' · vos visites ne sont pas comptées'}
          </p>
        </div>
        <button type='button' onClick={() => void charger()}>
          Actualiser
        </button>
      </header>

      <nav className='lel-stats__periodes' aria-label='Période'>
        {PERIODES.map((p) => (
          <button
            key={p.jours}
            type='button'
            className={p.jours === jours ? 'actif' : ''}
            onClick={() => setJours(p.jours)}
          >
            {p.nom}
          </button>
        ))}
      </nav>

      {etat === 'connexion' && (
        <p className='lel-stats__info'>
          Connectez-vous avec votre compte pour voir les chiffres.{' '}
          <a href='/auth?redirect=/stats'>Se connecter</a>
        </p>
      )}
      {etat === 'interdit' && <p className='lel-stats__info'>Page réservée au propriétaire.</p>}
      {etat === 'erreur' && (
        <p className='lel-stats__info'>Les chiffres ne répondent pas. Réessayez dans un instant.</p>
      )}

      {stats && e && (
        <>
          <div className='lel-stats__cartes'>
            <div>
              <strong>{e.visiteurs}</strong>
              <span>visiteurs · {periode}</span>
            </div>
            <div>
              <strong>{e.inscrits}</strong>
              <span>inscrits · {periode}</span>
            </div>
            <div>
              <strong>{a?.abonnes ?? '–'}</strong>
              <span>abonnés Plus actifs</span>
            </div>
            <div className='lel-stats__or'>
              <strong>{a?.erreur ? '–' : euros(a?.encaisse)}</strong>
              <span>encaissés · {periode}</span>
            </div>
          </div>
          {!a?.erreur && (
            <p className='lel-stats__petit'>
              Revenu mensuel récurrent : {euros(a?.mensuel_recurrent)} (abonnements actifs, l’annuel
              compté au mois)
            </p>
          )}
          {a?.erreur && <p className='lel-stats__petit'>{a.erreur}</p>}

          <h2>Le parcours des visiteurs · {periode}</h2>
          <div className='lel-stats__entonnoir'>
            {etapes.map((x) => (
              <div key={x.nom} className='lel-stats__etape'>
                <div className='lel-stats__etape-haut'>
                  <span>{x.nom}</span>
                  <b>
                    {x.n} <small>{part(x.n, e.visiteurs)} %</small>
                  </b>
                </div>
                <div className='lel-stats__barre'>
                  <i style={{ width: `${Math.max(part(x.n, e.visiteurs), x.n > 0 ? 3 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <h2>Jour par jour (heure de La Réunion)</h2>
          <div className='lel-stats__graphe'>
            {[...stats.par_jour].reverse().map((l) => (
              <div key={l.jour} className='lel-stats__colonne' title={`${l.visiteurs} visiteurs`}>
                <span className='lel-stats__valeur'>{l.visiteurs || ''}</span>
                <i style={{ height: `${(l.visiteurs / maxJour) * 100}%` }} />
                {l.inscriptions > 0 && <em>+{l.inscriptions}</em>}
                <small>{jourCourt(l.jour)}</small>
              </div>
            ))}
          </div>
          <p className='lel-stats__petit'>Barres : visiteurs. En or : inscrits du jour.</p>

          <h2>Qui s’est inscrit</h2>
          {stats.inscrits.length === 0 && <p className='lel-stats__petit'>Personne encore</p>}
          <div className='lel-stats__liste'>
            {stats.inscrits.map((i, n) => (
              <div key={n} className={`lel-stats__fiche${i.vous ? ' vous' : ''}`}>
                <div>
                  <b>{i.email ?? 'sans e-mail'}</b>
                  {i.vous && <span className='lel-stats__tag'>vous</span>}
                  {i.plan !== 'free' && <span className='lel-stats__tag or'>{i.plan}</span>}
                </div>
                <p>
                  Inscrit le {i.le} avec {VIA[i.via] ?? i.via} · {i.livres} livre
                  {i.livres > 1 ? 's' : ''}
                  {i.derniere ? ` · vu le ${i.derniere}` : ''}
                </p>
              </div>
            ))}
          </div>

          <h2>Qui a payé</h2>
          {a?.erreur && <p className='lel-stats__petit'>{a.erreur}</p>}
          {!a?.erreur && (a?.abonnements ?? []).length === 0 && (
            <p className='lel-stats__petit'>Aucun abonnement</p>
          )}
          <div className='lel-stats__liste'>
            {(a?.abonnements ?? []).map((s, n) => (
              <div key={n} className={`lel-stats__fiche${s.vous ? ' vous' : ''}`}>
                <div>
                  <b>{s.email ?? 'client'}</b>
                  {s.vous && <span className='lel-stats__tag'>vous</span>}
                  <span
                    className={`lel-stats__tag${s.statut === 'active' && !s.resilie ? ' or' : ''}`}
                  >
                    {s.resilie && s.statut === 'active'
                      ? 'Résilié'
                      : (STATUTS[s.statut] ?? s.statut)}
                  </span>
                </div>
                <p>
                  Plus {s.formule} · {euros(s.montant, s.devise)} · depuis le {s.debut}
                  {s.termine
                    ? ` · terminé le ${s.termine}`
                    : s.fin
                      ? ` · ${s.resilie ? 'se termine' : 'renouvelé'} le ${s.fin}`
                      : ''}
                </p>
              </div>
            ))}
          </div>
          {(a?.paiements ?? []).length > 0 && (
            <>
              <h2>Paiements (90 derniers jours)</h2>
              <div className='lel-stats__liste'>
                {(a?.paiements ?? []).map((p, n) => (
                  <p key={n} className={`lel-stats__passage${p.vous ? ' vous' : ''}`}>
                    <time>{p.le}</time> {euros(p.montant, p.devise)} · {p.email ?? 'client'}
                    {p.vous ? ' (vous)' : ''} · {STATUTS[p.statut] ?? p.statut}
                    {p.rembourse > 0 ? ` · remboursé ${euros(p.rembourse, p.devise)}` : ''}
                  </p>
                ))}
              </div>
            </>
          )}

          {stats.bio && (
            <>
              <h2>Page de la bio TikTok · {periode}</h2>
              <div className='lel-stats__cartes'>
                <div>
                  <strong>{stats.bio.visiteurs}</strong>
                  <span>visiteurs ({stats.bio.visiteurs_24h} en 24 h)</span>
                </div>
                <div>
                  <strong>{stats.bio.kevin}</strong>
                  <span>clics sur le livre de Kevin</span>
                </div>
                <div>
                  <strong>{stats.bio.liseuse + stats.bio.cadeau}</strong>
                  <span>clics vers Lis et Lead</span>
                </div>
                <div>
                  <strong>{stats.bio.arrivee}</strong>
                  <span>arrivés au bout du chemin</span>
                </div>
              </div>
              {stats.bio.telegram > 0 && (
                <p className='lel-stats__petit'>{stats.bio.telegram} clics vers Telegram</p>
              )}
            </>
          )}

          <div className='lel-stats__trois'>
            <section>
              <h2>D’où ils viennent</h2>
              {stats.provenances.length === 0 && (
                <p className='lel-stats__petit'>Personne encore</p>
              )}
              {stats.provenances.map((p) => (
                <p key={p.provenance} className='lel-stats__ligne'>
                  <span>{p.provenance}</span>
                  <b>{p.visiteurs}</b>
                </p>
              ))}
            </section>
            <section>
              <h2>Téléphones</h2>
              {(stats.appareils ?? []).length === 0 && (
                <p className='lel-stats__petit'>Personne encore</p>
              )}
              {(stats.appareils ?? []).map((p) => (
                <p key={p.appareil} className='lel-stats__ligne'>
                  <span>{p.appareil}</span>
                  <b>{p.visiteurs}</b>
                </p>
              ))}
            </section>
            <section>
              <h2>Pays</h2>
              {stats.pays.length === 0 && <p className='lel-stats__petit'>Personne encore</p>}
              {stats.pays.map((p) => (
                <p key={p.pays} className='lel-stats__ligne'>
                  <span>{p.pays}</span>
                  <b>{p.visiteurs}</b>
                </p>
              ))}
            </section>
          </div>

          <h2>Derniers passages</h2>
          {stats.derniers.length === 0 && <p className='lel-stats__petit'>Personne encore</p>}
          {stats.derniers.map((d, i) => (
            <p key={i} className='lel-stats__passage'>
              <time>{d.heure}</time> Un visiteur
              {d.pays || d.appareil ? ` (${[d.pays, d.appareil].filter(Boolean).join(', ')})` : ''}{' '}
              {NOMS[d.evenement] ?? d.evenement}
              {d.evenement === 'vue' && d.chemin ? ` ${d.chemin}` : ''}
              {d.provenance ? ` · venu de ${d.provenance}` : ''}
            </p>
          ))}
        </>
      )}
    </main>
  );
}

const STYLES = `
.lel-stats {
  min-height: 100vh; padding: 1.25rem 1rem 3rem; max-width: 46rem; margin: 0 auto;
  color: #f3ecdd; background: #16241f;
  font-family: 'DM Sans Variable', ui-sans-serif, sans-serif;
}
html, body { background: #16241f; }
.lel-stats h1 {
  font-family: 'Bricolage Grotesque Variable', ui-sans-serif, sans-serif;
  font-size: 1.75rem; font-weight: 800; color: #f3d48d;
}
.lel-stats h2 { margin: 1.6rem 0 0.6rem; font-size: 0.8rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: #e8c06a; }
.lel-stats__haut { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.lel-stats__haut p { font-size: 0.85rem; opacity: 0.7; }
.lel-stats__haut button { padding: 0.5rem 0.9rem; border-radius: 999px; background: rgba(243,236,221,0.1);
  font-size: 0.85rem; font-weight: 600; }
.lel-stats__periodes { display: flex; gap: 0.4rem; margin: 1rem 0 0.9rem; }
.lel-stats__periodes button { padding: 0.45rem 0.9rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600;
  background: rgba(243,236,221,0.07); color: #f3ecdd; }
.lel-stats__periodes button.actif { background: #e8c06a; color: #16241f; }
.lel-stats__info { margin-top: 1.5rem; padding: 1rem; border-radius: 1rem; background: rgba(243,236,221,0.06); }
.lel-stats__info a { color: #e8c06a; text-decoration: underline; }
.lel-stats__cartes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
@media (min-width: 640px) { .lel-stats__cartes { grid-template-columns: repeat(4, 1fr); } }
.lel-stats__cartes div { padding: 0.9rem; border-radius: 1rem; background: rgba(243,236,221,0.07);
  display: flex; flex-direction: column; gap: 0.25rem; }
.lel-stats__cartes strong { font-size: 1.9rem; font-weight: 800; line-height: 1; color: #f3ecdd; }
.lel-stats__cartes span { font-size: 0.8rem; opacity: 0.75; }
.lel-stats__cartes .lel-stats__or { background: linear-gradient(135deg, #f3d48d, #c79a3c); }
.lel-stats__cartes .lel-stats__or strong, .lel-stats__cartes .lel-stats__or span { color: #16241f; opacity: 1; }
.lel-stats__petit { font-size: 0.82rem; opacity: 0.65; margin-top: 0.5rem; }
.lel-stats__entonnoir { display: flex; flex-direction: column; gap: 0.7rem; }
.lel-stats__etape-haut { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.3rem; }
.lel-stats__etape-haut small { opacity: 0.6; font-weight: 500; margin-left: 0.3rem; }
.lel-stats__barre { height: 0.65rem; border-radius: 999px; background: rgba(243,236,221,0.08); overflow: hidden; }
.lel-stats__barre i { display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #e8c06a, #f3d48d); }
.lel-stats__graphe { display: flex; align-items: flex-end; gap: 0.35rem; height: 9rem;
  padding: 0.5rem 0 0; border-bottom: 1px solid rgba(243,236,221,0.12); }
.lel-stats__colonne { flex: 1; height: 100%; position: relative; display: flex; flex-direction: column;
  justify-content: flex-end; align-items: center; }
.lel-stats__colonne i { width: 100%; max-width: 2.4rem; border-radius: 0.4rem 0.4rem 0 0;
  background: rgba(243,236,221,0.28); min-height: 2px; }
.lel-stats__colonne em { position: absolute; top: 0; font-style: normal; font-size: 0.75rem; font-weight: 800;
  color: #16241f; background: #e8c06a; border-radius: 999px; padding: 0 0.35rem; }
.lel-stats__colonne small { position: absolute; bottom: -1.3rem; font-size: 0.68rem; opacity: 0.6; white-space: nowrap; }
.lel-stats__valeur { font-size: 0.72rem; opacity: 0.8; margin-bottom: 0.15rem; }
.lel-stats__graphe + .lel-stats__petit { margin-top: 1.6rem; }
.lel-stats__liste { display: flex; flex-direction: column; gap: 0.45rem; }
.lel-stats__fiche { padding: 0.7rem 0.8rem; border-radius: 0.9rem; background: rgba(243,236,221,0.06); }
.lel-stats__fiche > div { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
.lel-stats__fiche b { font-size: 0.92rem; overflow-wrap: anywhere; }
.lel-stats__fiche p { font-size: 0.8rem; opacity: 0.72; margin-top: 0.2rem; }
.lel-stats .vous { opacity: 0.55; }
.lel-stats__tag { font-size: 0.68rem; font-weight: 700; padding: 0.05rem 0.45rem; border-radius: 999px;
  background: rgba(243,236,221,0.14); text-transform: uppercase; letter-spacing: 0.04em; }
.lel-stats__tag.or { background: #e8c06a; color: #16241f; }
.lel-stats__trois { display: grid; grid-template-columns: 1fr; gap: 0 1rem; }
@media (min-width: 640px) { .lel-stats__trois { grid-template-columns: 1fr 1fr 1fr; } }
.lel-stats__ligne { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.9rem;
  padding: 0.3rem 0; border-bottom: 1px solid rgba(243,236,221,0.06); }
.lel-stats__ligne span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lel-stats__passage { font-size: 0.86rem; padding: 0.4rem 0; border-bottom: 1px solid rgba(243,236,221,0.06); }
.lel-stats__passage time { font-variant-numeric: tabular-nums; color: #e8c06a; margin-right: 0.4rem; }
`;
