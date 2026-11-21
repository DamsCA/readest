// Assemble le schéma complet d'Ouiread pour un projet Supabase hébergé (ouiread-hosted.sql).
//
// - schema.sql sans ses deux premières lignes (ALTER FUNCTION auth.* OWNER : auto-hébergement seulement).
//   Il contient déjà les migrations 001, 013, 015, 016 et 017.
// - 007 et 014 sont indispensables (colonnes replica_* de files, statistiques de lecture).
// - 003 à 011 : synchronisation des réglages, polices, dictionnaires et catalogues.
// - 002 (partage de livres) et 012 (« Envoyer vers ») ne sont pas repris : ces fonctions sont masquées.
// - ouiread-extras.sql : formule par lecteur, jeton enrichi, marqueur du livre offert.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const db = path.join(ici, '..');
const lire = (rel) => readFileSync(path.join(db, rel), 'utf8').replace(/\r\n/g, '\n');

const schema = lire('init/schema.sql').split('\n').slice(2).join('\n');
const migrations = ['007', '014', '003', '004', '005', '006', '008', '009', '010', '011'].map((n) => {
  const nom = {
    '003': '003_add_replicas.sql',
    '004': '004_crdt_merge_replica_fn.sql',
    '005': '005_replica_manifest_cursor_updated_at.sql',
    '006': '006_replica_more_kinds.sql',
    '007': '007_files_replica_grouping.sql',
    '008': '008_replica_keys_rpcs.sql',
    '009': '009_replica_opds_catalog.sql',
    '010': '010_replica_keys_forget.sql',
    '011': '011_replica_settings.sql',
    '014': '014_add_reading_stats.sql',
  }[n];
  return `-- ===== migrations/${nom} =====\n${lire(`migrations/${nom}`)}`;
});
const extras = readFileSync(path.join(ici, 'ouiread-extras.sql'), 'utf8').replace(/\r\n/g, '\n');

const sortie = [
  '-- Schéma complet d\'Ouiread pour Supabase hébergé. Fichier produit par assembler.mjs : ne pas modifier à la main.',
  '-- ===== init/schema.sql (sans les lignes 1-2) =====',
  schema,
  ...migrations,
  '-- ===== ouiread/ouiread-extras.sql =====',
  extras,
].join('\n\n');
writeFileSync(path.join(ici, 'ouiread-hosted.sql'), sortie);
console.log('ouiread-hosted.sql :', sortie.split('\n').length, 'lignes,', Buffer.byteLength(sortie), 'octets');
