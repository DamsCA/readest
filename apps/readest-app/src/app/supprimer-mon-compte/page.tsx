import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Supprimer mon compte Lis et Lead' };

// Public page that Google Play and the App Store link to: how a reader deletes
// their Lis et Lead account, and what goes with it.
export default function SupprimerMonComptePage() {
  return (
    <LegalPage title='Supprimer mon compte Lis et Lead' updated='25 novembre 2026'>
      <p>
        Vous pouvez supprimer votre compte Lis et Lead à tout moment, gratuitement. La suppression
        est immédiate et définitive.
      </p>

      <h2>Dans l’application Lis et Lead</h2>
      <ul>
        <li>Touchez l’icône du compte, en haut de la bibliothèque, pour ouvrir « Mon compte ».</li>
        <li>Touchez « Supprimer mon compte », puis confirmez.</li>
      </ul>

      <h2>Sur le site lisetlead.com</h2>
      <ul>
        <li>Connectez-vous, puis ouvrez « Compte ».</li>
        <li>Choisissez « Supprimer le compte », puis confirmez.</li>
      </ul>

      <h2>Par e-mail</h2>
      <p>
        Si vous ne pouvez plus vous connecter, écrivez à{' '}
        <a href='mailto:genie.endormi@gmail.com' className='underline'>
          genie.endormi@gmail.com
        </a>{' '}
        depuis l’adresse de votre compte, avec pour objet « Supprimer mon compte ». Nous supprimons
        le compte dans les 7 jours et vous le confirmons par e-mail.
      </p>

      <h2>Ce qui est supprimé</h2>
      <ul>
        <li>Votre compte : adresse e-mail, identifiant, mot de passe chiffré.</li>
        <li>
          Votre bibliothèque en ligne : les livres et couvertures que vous avez ajoutés, votre
          progression, vos surlignages, vos notes, vos réglages et vos statistiques de lecture.
        </li>
        <li>L’enregistrement de votre abonnement Lis et Lead Plus.</li>
      </ul>

      <h2>Ce qui est conservé, et combien de temps</h2>
      <ul>
        <li>
          Des copies de sauvegarde techniques peuvent subsister quelques jours chez nos prestataires
          avant d’être écrasées. Les journaux techniques s’effacent d’eux-mêmes après quelques
          jours.
        </li>
        <li>
          Si vous avez payé sur le site, les factures sont gardées 10 ans, comme la loi l’impose
          pour la comptabilité. Votre abonnement payé sur le site est arrêté au moment de la
          suppression.
        </li>
        <li>
          Si vous vous êtes abonné dans l’application, l’abonnement est géré par Google Play ou par
          l’App Store : supprimer le compte ne l’arrête pas. Arrêtez-le dans les réglages
          d’abonnement de votre téléphone.
        </li>
        <li>
          Les livres gardés sur votre téléphone y restent jusqu’à ce que vous désinstalliez
          l’application.
        </li>
      </ul>
    </LegalPage>
  );
}
