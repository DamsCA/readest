'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';

// The owner's audience page (23 Nov 2026: « c'est pas normal de pas savoir
// s'il y a des visiteurs »): who came, from where, who opened the sign-up
// window, who signed up. Figures from /api/stats/resume, refreshed every
// minute; only the accounts in public.admins_stats can read them.

interface Ligne {
  jour: string;
  visiteurs: number;
  clics_inscription: number;
  inscriptions: number;
}
interface Stats {
  depuis_24h: {
    visiteurs: number;
    pages: number;
    invitations_vues: number;
    clics_inscription: number;
    inscriptions: number;
  };
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
  provenances: { provenance: string; visiteurs: number }[];
  pays: { pays: string; visiteurs: number }[];
  derniers: {
    heure: string;
    evenement: string;
    chemin: string | null;
    provenance: string | null;
    pays: string | null;
  }[];
}

const NOMS: Record<string, string> = {
  vue: 'a ouvert',
  invitation_vue: 'a vu la fenêtre du livre offert',
  invitation_google: 'a cliqué « Recevoir mon livre avec Google »',
  invitation_email: 'a cliqué « Avec mon adresse e-mail »',
  invitation_fermee: 'a fermé la fenêtre',
  bio_vue: 'a ouvert la page de la bio',
  bio_kevin: 'a cliqué « Recevoir le livre gratuit » (Kevin)',
  bio_liseuse: 'a cliqué « Ouvrir Lis et Lead »',
  bio_cadeau: 'a cliqué « Recevoir Ça marche »',
  bio_telegram: 'a cliqué la communauté Telegram',
  bio_arrivee: 'est arrivé au bout du chemin',
};

const jourCourt = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

export default function StatsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
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
      const res = await fetch('/api/stats/resume?jours=7', {
        headers: { Authorization: `Bearer ${jeton}` },
        cache: 'no-store',
      });
      if (res.status === 401) return setEtat('connexion');
      if (res.status === 403) return setEtat('interdit');
      if (!res.ok) return setEtat('erreur');
      setStats((await res.json()) as Stats);
      setMaj(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      setEtat('ok');
    } catch {
      setEtat('erreur');
    }
  }, [token]);

  useEffect(() => {
    void charger();
    const t = setInterval(() => void charger(), 60_000);
    return () => clearInterval(t);
  }, [charger]);

  const h = stats?.depuis_24h;

  return (
    <main className='lel-stats'>
      <style>{STYLES}</style>
      <header className='lel-stats__haut'>
        <div>
          <h1>Audience</h1>
          <p>Lis et Lead · {maj ? `mis à jour à ${maj}` : 'chargement…'}</p>
        </div>
        <button type='button' onClick={() => void charger()}>
          Actualiser
        </button>
      </header>

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

      {h && (
        <>
          <h2>Dernières 24 heures</h2>
          <div className='lel-stats__cartes'>
            <div>
              <strong>{h.visiteurs}</strong>
              <span>visiteurs</span>
            </div>
            <div>
              <strong>{h.invitations_vues}</strong>
              <span>ont vu le livre offert</span>
            </div>
            <div>
              <strong>{h.clics_inscription}</strong>
              <span>ont cliqué pour s’inscrire</span>
            </div>
            <div className='lel-stats__or'>
              <strong>{h.inscriptions}</strong>
              <span>inscrits</span>
            </div>
          </div>
          <p className='lel-stats__petit'>{h.pages} pages ouvertes par des visiteurs sans compte</p>

          {stats.bio && (
            <>
              <h2>Page de la bio TikTok (7 jours)</h2>
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

          <h2>Jour par jour (heure de La Réunion)</h2>
          <table>
            <thead>
              <tr>
                <th>Jour</th>
                <th>Visiteurs</th>
                <th>Clics</th>
                <th>Inscrits</th>
              </tr>
            </thead>
            <tbody>
              {stats.par_jour.map((l) => (
                <tr key={l.jour}>
                  <td>{jourCourt(l.jour)}</td>
                  <td>{l.visiteurs}</td>
                  <td>{l.clics_inscription}</td>
                  <td>{l.inscriptions}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className='lel-stats__deux'>
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
              <time>{d.heure}</time> Un visiteur{d.pays ? ` (${d.pays})` : ''}{' '}
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
  min-height: 100vh; padding: 1.25rem 1rem 3rem; max-width: 40rem; margin: 0 auto;
  color: #f3ecdd; background: #16241f;
  font-family: 'DM Sans Variable', ui-sans-serif, sans-serif;
}
html, body { background: #16241f; }
.lel-stats h1 {
  font-family: 'Bricolage Grotesque Variable', ui-sans-serif, sans-serif;
  font-size: 1.75rem; font-weight: 800; color: #f3d48d;
}
.lel-stats h2 { margin: 1.5rem 0 0.6rem; font-size: 0.8rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: #e8c06a; }
.lel-stats__haut { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.lel-stats__haut p { font-size: 0.85rem; opacity: 0.7; }
.lel-stats__haut button { padding: 0.5rem 0.9rem; border-radius: 999px; background: rgba(243,236,221,0.1);
  font-size: 0.85rem; font-weight: 600; }
.lel-stats__info { margin-top: 1.5rem; padding: 1rem; border-radius: 1rem; background: rgba(243,236,221,0.06); }
.lel-stats__info a { color: #e8c06a; text-decoration: underline; }
.lel-stats__cartes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.lel-stats__cartes div { padding: 0.9rem; border-radius: 1rem; background: rgba(243,236,221,0.07);
  display: flex; flex-direction: column; gap: 0.2rem; }
.lel-stats__cartes strong { font-size: 2rem; font-weight: 800; line-height: 1; color: #f3ecdd; }
.lel-stats__cartes span { font-size: 0.82rem; opacity: 0.75; }
.lel-stats__cartes .lel-stats__or { background: linear-gradient(135deg, #f3d48d, #c79a3c); }
.lel-stats__cartes .lel-stats__or strong, .lel-stats__cartes .lel-stats__or span { color: #16241f; opacity: 1; }
.lel-stats__petit { font-size: 0.82rem; opacity: 0.65; margin-top: 0.5rem; }
.lel-stats table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
.lel-stats th { text-align: left; font-weight: 600; opacity: 0.6; padding: 0.35rem 0.25rem; font-size: 0.8rem; }
.lel-stats td { padding: 0.45rem 0.25rem; border-top: 1px solid rgba(243,236,221,0.08); }
.lel-stats__deux { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.lel-stats__ligne { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.9rem;
  padding: 0.3rem 0; border-bottom: 1px solid rgba(243,236,221,0.06); }
.lel-stats__ligne span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lel-stats__passage { font-size: 0.86rem; padding: 0.4rem 0; border-bottom: 1px solid rgba(243,236,221,0.06); }
.lel-stats__passage time { font-variant-numeric: tabular-nums; color: #e8c06a; margin-right: 0.4rem; }
`;
