import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Mentions légales' };

export default function MentionsLegalesPage() {
  return (
    <LegalPage title='Mentions légales' updated='22 novembre 2026'>
      <h2>Éditeur</h2>
      <p>
        Damien Aure
        <br />
        Téléphone : 06 67 90 72 53
        <br />
        E-mail :{' '}
        <a href='mailto:genie.endormi@gmail.com' className='underline'>
          genie.endormi@gmail.com
        </a>
      </p>

      <h2>Hébergeur</h2>
      <p>
        Cloudflare, Inc.
        <br />
        101 Townsend St., San Francisco, CA 94107, États-Unis
        <br />
        Téléphone : +1 888 993 5273
        <br />
        www.cloudflare.com
      </p>

      <h2>Comptes et base de données</h2>
      <p>Supabase, Inc., données hébergées dans l’Union européenne (Paris). supabase.com</p>

      <h2>Logiciel libre</h2>
      <p>
        Ouiread est une version modifiée de Readest, publiée sous licence GNU Affero General Public
        License, version 3. Son code source est disponible sur github.com/DamsCA/readest.
      </p>

      <h2>Livre offert</h2>
      <p>
        « Ça marche » est une traduction française de « It Works » (R. H. J., 1926). Le texte
        original appartient au domaine public. Traduction et couverture : Ouiread.
      </p>

      <h2>Données personnelles</h2>
      <p>
        Voir la <a href='/confidentialite'>politique de confidentialité</a>.
      </p>
    </LegalPage>
  );
}
