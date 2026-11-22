import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Conditions générales de vente' };

// The prices, quotas and renewal rules below are those of the app (Stripe
// prices of 22 Nov 2026, api/ai/translate and api/fishaudio/tts quotas, the
// Stripe customer portal that cancels at the end of the period).
export default function CgvPage() {
  return (
    <LegalPage title='Conditions générales de vente' updated='22 novembre 2026'>
      <p>
        Ces conditions s’appliquent à l’abonnement Lis et Lead Plus, vendu en ligne par l’éditeur de
        Lis et Lead (voir les <a href='/mentions-legales'>mentions légales</a>). En vous abonnant,
        vous les acceptez.
      </p>

      <h2>1. Ce que vous achetez</h2>
      <p>Lis et Lead est gratuit. L’abonnement Plus ajoute, tant qu’il est actif :</p>
      <ul>
        <li>la traduction IA naturelle ;</li>
        <li>les voix premium ;</li>
        <li>5 Go de stockage en ligne pour votre bibliothèque.</li>
      </ul>
      <p>
        Ces services sont destinés à la lecture personnelle. Pour garantir leur qualité à tous les
        abonnés, un usage raisonnable s’applique : jusqu’à 100 000 caractères traduits par jour et 2
        heures d’écoute en voix premium par mois. Au-delà, la lecture continue avec la traduction
        standard et les voix standard, jusqu’au lendemain pour la traduction et jusqu’au mois
        suivant pour les voix.
      </p>

      <h2>2. Prix</h2>
      <ul>
        <li>Plus au mois : 6,99 € par mois ;</li>
        <li>Plus à l’année : 59,99 € par an.</li>
      </ul>
      <p>
        Les prix sont indiqués en euros, toutes taxes comprises. Le prix affiché au moment de votre
        commande est celui que vous payez pour toute la période choisie. Si le prix change, vous en
        êtes prévenu par e-mail au moins 30 jours avant le renouvellement suivant, et vous pouvez
        résilier avant.
      </p>

      <h2>3. Commande et paiement</h2>
      <p>
        Vous vous abonnez depuis la page Compte de l’application. Le paiement est traité par notre
        prestataire Stripe : nous ne voyons jamais vos coordonnées bancaires. Le premier paiement a
        lieu à la commande, puis au début de chaque nouvelle période. Plus est activé dès le
        paiement accepté.
      </p>

      <h2>4. Durée, renouvellement et résiliation</h2>
      <p>
        L’abonnement est sans engagement. Il se renouvelle automatiquement chaque mois ou chaque
        année, selon votre choix, jusqu’à ce que vous le résiliiez.
      </p>
      <p>
        Vous pouvez résilier à tout moment depuis la page Compte, bouton « Gérer l’abonnement », en
        quelques clics. La résiliation prend effet à la fin de la période déjà payée : vous gardez
        Plus jusque-là, et aucun nouveau paiement n’est prélevé. La période en cours n’est pas
        remboursée au prorata, sauf dans le cas du droit de rétractation ci-dessous.
      </p>

      <h2>5. Droit de rétractation</h2>
      <p>
        Vous disposez de 14 jours à compter de votre premier abonnement pour vous rétracter, sans
        avoir à donner de raison. En vous abonnant, vous demandez à profiter de Plus tout de suite :
        si vous vous rétractez dans ces 14 jours, nous vous remboursons tout de même la totalité du
        premier paiement.
      </p>
      <p>
        Pour vous rétracter, écrivez à{' '}
        <a href='mailto:genie.endormi@gmail.com'>genie.endormi@gmail.com</a> depuis l’adresse de
        votre compte, par exemple : « Je me rétracte de mon abonnement Lis et Lead Plus souscrit le
        [date]. » Le remboursement est fait sous 14 jours, sur le moyen de paiement utilisé.
      </p>

      <h2>6. Disponibilité du service</h2>
      <p>
        Nous faisons de notre mieux pour que Lis et Lead soit disponible à tout moment, mais des
        interruptions peuvent arriver (maintenance, panne d’un prestataire). Si une voix premium ou
        la traduction IA est momentanément indisponible, la lecture continue avec la version
        standard. Une interruption longue de votre fait ou du nôtre peut donner lieu à un geste
        commercial : écrivez-nous.
      </p>

      <h2>7. Vos livres</h2>
      <p>
        Vous n’importez que des livres que vous avez le droit de lire. Les traductions et les voix
        sont produites automatiquement, pour votre lecture personnelle : elles peuvent contenir des
        erreurs et ne doivent pas être redistribuées. Le reste de l’usage de l’application est
        décrit dans les <a href='/cgu'>conditions générales d’utilisation</a>.
      </p>

      <h2>8. Données personnelles</h2>
      <p>
        Voir la <a href='/confidentialite'>politique de confidentialité</a>.
      </p>

      <h2>9. Réclamations et droit applicable</h2>
      <p>
        Pour toute question ou réclamation, écrivez à{' '}
        <a href='mailto:genie.endormi@gmail.com'>genie.endormi@gmail.com</a> : nous répondons sous 7
        jours. Ces conditions sont soumises au droit français. Si vous êtes consommateur, vous
        gardez la protection des règles impératives du pays où vous résidez.
      </p>
    </LegalPage>
  );
}
