import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Conditions générales d’utilisation' };

export default function CguPage() {
  return (
    <LegalPage title='Conditions générales d’utilisation' updated='22 novembre 2026'>
      <p>
        Ces conditions encadrent l’utilisation de Lis et Lead, gratuite ou avec l’abonnement Plus.
        En créant un compte, vous les acceptez.
      </p>

      <h2>1. Le service</h2>
      <p>
        Lis et Lead est une liseuse : vous y lisez vos livres, vous pouvez les faire traduire et les
        écouter à voix haute, et votre bibliothèque est synchronisée entre vos appareils.
        L’abonnement Plus est décrit dans les <a href='/cgv'>conditions générales de vente</a>.
      </p>

      <h2>2. Votre compte</h2>
      <p>
        Vous créez votre compte avec Google ou avec une adresse e-mail et un mot de passe. Vous êtes
        responsable de ce qui est fait avec votre compte : gardez votre mot de passe pour vous. Vous
        pouvez supprimer votre compte à tout moment depuis la page Compte ; vos livres, vos notes et
        votre progression sont alors effacés de nos serveurs.
      </p>

      <h2>3. Vos livres</h2>
      <ul>
        <li>
          Vous n’importez que des livres que vous avez le droit de lire : achetés sans verrou,
          libres de droits, ou dont vous êtes l’auteur.
        </li>
        <li>
          Vos livres restent les vôtres. Ils ne sont visibles que par vous, et nous ne les utilisons
          à aucune autre fin que les afficher, les traduire et les lire pour vous.
        </li>
        <li>
          Les traductions et les voix sont faites pour votre lecture personnelle. Ne les publiez pas
          et ne les partagez pas : le texte d’un livre appartient à son auteur et à son éditeur.
        </li>
      </ul>

      <h2>4. Traductions et voix automatiques</h2>
      <p>
        Les traductions et les voix sont produites automatiquement, par des modèles d’intelligence
        artificielle et des services de traduction. Elles sont souvent justes, mais peuvent contenir
        des erreurs ou des contresens : ne vous y fiez pas pour un usage où une erreur aurait des
        conséquences (texte juridique, médical, etc.).
      </p>

      <h2>5. Ce qui est interdit</h2>
      <ul>
        <li>importer des contenus illégaux ou que vous n’avez pas le droit de détenir ;</li>
        <li>
          contourner les limites de l’application, l’utiliser de façon automatisée ou revendre son
          accès ;
        </li>
        <li>perturber son fonctionnement ou tenter d’accéder aux données d’autres lecteurs.</li>
      </ul>
      <p>En cas de manquement, nous pouvons suspendre ou supprimer le compte concerné.</p>

      <h2>6. Disponibilité et évolution</h2>
      <p>
        Lis et Lead évolue : des fonctions peuvent être ajoutées, modifiées ou retirées. Nous ne
        garantissons pas que le service soit disponible sans interruption. Gardez une copie de vos
        fichiers de livres : la bibliothèque en ligne est une commodité, pas une sauvegarde.
      </p>

      <h2>7. Logiciel libre</h2>
      <p>
        Lis et Lead est une version modifiée de Readest, sous licence GNU Affero General Public
        License version 3 : son code source est disponible sur github.com/DamsCA/readest.
      </p>

      <h2>8. Modifications et contact</h2>
      <p>
        Si ces conditions changent de façon importante, nous vous prévenons dans l’application ou
        par e-mail. Pour toute question :{' '}
        <a href='mailto:contact@lisetlead.com'>contact@lisetlead.com</a>. Ces conditions sont
        soumises au droit français.
      </p>
    </LegalPage>
  );
}
