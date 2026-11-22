import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';

export const metadata: Metadata = { title: 'Politique de confidentialité' };

export default function ConfidentialitePage() {
  return (
    <LegalPage title='Politique de confidentialité' updated='22 novembre 2026'>
      <h2>Qui est responsable de vos données ?</h2>
      <p>
        Ouiread est édité par Damien Aure, responsable du traitement de vos données. Pour toute
        question, ou pour exercer vos droits : 06 92 03 99 30.
      </p>

      <h2>Ce que nous enregistrons</h2>
      <ul>
        <li>
          <strong>Votre compte</strong> : votre adresse e-mail et votre mot de passe. Le mot de
          passe est conservé chiffré par notre prestataire Supabase : personne ne peut le lire, pas
          même nous.
        </li>
        <li>
          <strong>Votre bibliothèque en ligne</strong> : les livres que vous y ajoutez, leurs
          couvertures, votre progression, vos surlignages et vos notes, vos réglages de lecture et
          des statistiques de lecture (pages lues, durée). Ils servent à vous retrouver sur tous vos
          appareils.
        </li>
        <li>
          <strong>Si vous vous connectez avec Google</strong> : nous recevons de Google votre nom,
          votre adresse e-mail et votre photo de profil, uniquement pour créer et reconnaître votre
          compte.
        </li>
        <li>
          <strong>Des journaux techniques</strong> : notre hébergeur enregistre l’adresse IP, le
          type de navigateur et les pages demandées, quelques jours, pour la sécurité et le bon
          fonctionnement du service.
        </li>
      </ul>

      <h2>Pourquoi</h2>
      <ul>
        <li>
          Faire fonctionner votre compte et votre bibliothèque sur tous vos appareils : c’est le
          service que vous nous demandez.
        </li>
        <li>Protéger le service contre les abus : c’est notre intérêt légitime.</li>
      </ul>
      <p>
        Nous ne vendons pas vos données. Il n’y a ni publicité, ni outil de statistiques ou de
        publicité qui vous suivrait.
      </p>

      <h2>Traduction et lecture à voix haute</h2>
      <p>
        Quand vous traduisez un passage, son texte est envoyé au service de traduction choisi dans
        les réglages : Google Traduction ou Microsoft Translator. Quand vous écoutez un livre avec
        une voix en ligne, le texte lu est envoyé au service de voix de Microsoft. Ces services
        reçoivent le texte et l’adresse IP de votre appareil, jamais votre compte, et appliquent
        leurs propres règles de confidentialité. Les voix intégrées à votre appareil fonctionnent
        sans rien envoyer.
      </p>

      <h2>Nos prestataires</h2>
      <ul>
        <li>Supabase : comptes et base de données, hébergés dans l’Union européenne (Paris).</li>
        <li>
          Cloudflare : hébergement de l’application et stockage des fichiers de livres, en Europe de
          l’Ouest.
        </li>
      </ul>
      <p>
        Ils agissent pour notre compte. S’ils traitent certaines données hors de l’Union européenne,
        ils s’y engagent par les clauses contractuelles types de la Commission européenne.
      </p>

      <h2>Combien de temps</h2>
      <p>
        Vos données sont conservées tant que votre compte existe. Quand vous supprimez votre compte
        (Compte, puis « Supprimer le compte »), votre compte, votre bibliothèque en ligne et vos
        fichiers sont effacés aussitôt de nos systèmes. Des copies de sauvegarde techniques peuvent
        subsister quelques jours chez nos prestataires avant d’être écrasées. Les journaux
        techniques s’effacent d’eux-mêmes après quelques jours.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous pouvez accéder à vos données, les corriger, les effacer, les récupérer ou vous opposer
        à un traitement. La suppression se fait directement dans l’application. Pour le reste,
        appelez le 06 92 03 99 30. Vous pouvez aussi adresser une réclamation à la CNIL
        (www.cnil.fr).
      </p>

      <h2>Ce qui reste sur votre appareil</h2>
      <p>
        Ouiread enregistre sur votre appareil ce dont il a besoin pour fonctionner : votre session
        de connexion, vos réglages et les livres que vous lisez. Rien de tout cela ne sert à vous
        suivre ni à vous montrer de la publicité.
      </p>

      <h2>Modifications</h2>
      <p>Cette politique peut évoluer. La date en haut de la page indique la dernière version.</p>
    </LegalPage>
  );
}
