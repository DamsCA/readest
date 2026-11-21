#!/usr/bin/env bash
# Construit la version web d'Ouiread sous Linux (WSL) et la met en ligne sur Cloudflare.
#
# OpenNext n'est pas fiable sous Windows : le serveur construit sous Windows cherche ses
# fichiers au mauvais endroit (« Dynamic require of /.next/server/... is not supported »).
# Ce script copie le code dans le disque Linux de WSL, installe les dépendances Linux,
# construit, puis déploie avec la connexion Cloudflare (wrangler) déjà faite sous Windows.
#
# Depuis Windows :
#   wsl.exe -e bash /mnt/c/Users/papan/Dev/readest-play/apps/readest-app/scripts/build-ouiread-wsl.sh
set -euo pipefail

SRC=/mnt/c/Users/papan/Dev/readest-play
DST="$HOME/ouiread-build/readest-play"
PNPM="npx -y pnpm@11.1.1"

echo "== copie du code vers $DST"
mkdir -p "$DST"
tar -C "$SRC" \
  --exclude=node_modules --exclude=.next --exclude=.open-next --exclude=.git \
  --exclude=target --exclude=.turbo --exclude=.wrangler \
  -cf - . | tar -C "$DST" -xf -

echo "== dépendances (Linux)"
cd "$DST"
$PNPM install --frozen-lockfile

echo "== construction (OpenNext, plateforme web, comptes activés)"
cd "$DST/apps/readest-app"
restaurer() { sed -i 's/next build --webpack"/next build"/' package.json; }
trap restaurer EXIT
sed -i 's/next build"/next build --webpack"/' package.json
NEXT_PUBLIC_APP_PLATFORM=web NEXT_PUBLIC_CLOUD_ENABLED=true \
  NEXT_PUBLIC_AUTH_PROVIDERS="${NEXT_PUBLIC_AUTH_PROVIDERS:-}" \
  npx opennextjs-cloudflare build
restaurer
trap - EXIT

echo "== connexion Cloudflare reprise de Windows"
mkdir -p "$HOME/.config/.wrangler/config"
cp /mnt/c/Users/papan/AppData/Roaming/xdg.config/.wrangler/config/default.toml \
  "$HOME/.config/.wrangler/config/default.toml"

echo "== mise en ligne"
npx opennextjs-cloudflare deploy
