#!/usr/bin/env bash
# Met la version web d'Ouiread en ligne sur Cloudflare Workers.
# À lancer depuis Git Bash (Windows) ou un shell Linux :
#   bash scripts/deploy-ouiread.sh
#
# Ce que fait le script, comme « pnpm run deploy » mais avec les comptes activés :
#   1. passe le build Next.js en webpack (comme patch-build-webpack) ;
#   2. construit avec OpenNext pour la plateforme web, comptes et synchro activés ;
#   3. remet package.json comme avant, même en cas d'erreur ;
#   4. envoie le Worker « ouiread » (voir wrangler.toml).
set -euo pipefail
cd "$(dirname "$0")/.."

restaurer() { sed -i 's/next build --webpack"/next build"/' package.json; }
trap restaurer EXIT
sed -i 's/next build"/next build --webpack"/' package.json

# Sous Windows (Git Bash), les liens symboliques sont refusés sans droits
# administrateur : un petit module les remplace par des jonctions ou des copies.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    export NODE_OPTIONS="--import=file:///$(pwd -W)/scripts/windows-symlink-fallback.mjs ${NODE_OPTIONS:-}"
    ;;
esac

NEXT_PUBLIC_APP_PLATFORM=web NEXT_PUBLIC_CLOUD_ENABLED=true npx opennextjs-cloudflare build

restaurer
trap - EXIT
npx opennextjs-cloudflare deploy
