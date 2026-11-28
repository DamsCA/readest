#!/usr/bin/env bash
# Met en ligne la version web d'Ouiread construite par GitHub (workflow « Build Ouiread web »).
# À lancer depuis Git Bash, sur le PC où wrangler est connecté au compte Cloudflare :
#   bash scripts/deploy-ouiread-from-ci.sh            (dernière construction réussie)
#   bash scripts/deploy-ouiread-from-ci.sh <run-id>   (une construction précise)
#
# La construction a eu lieu sous Linux ; ici, on ne fait que l'envoyer (wrangler deploy),
# ce qui marche aussi sous Windows.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=DamsCA/lisetlead-site
RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
  RUN_ID=$(gh run list --repo "$REPO" --workflow deploy-web-ouiread.yml --branch play-release \
    --status success --limit 1 --json databaseId --jq '.[0].databaseId')
fi
[ -n "$RUN_ID" ] || { echo "Aucune construction réussie trouvée."; exit 1; }
echo "construction GitHub : $RUN_ID"

rm -rf .open-next
gh run download "$RUN_ID" --repo "$REPO" --name ouiread-web --dir .open-next
test -f .open-next/worker.js || { echo "worker.js absent de la pièce jointe."; exit 1; }

# OpenNext écrit quelques imports avec le chemin absolu de la machine GitHub
# (/home/runner/work/…/.open-next/server-functions/default/…), par exemple les
# fichiers de @vercel/og. Sous Windows, wrangler ne les retrouve pas : on les
# rend relatifs au serveur (server-functions/default/apps/readest-app/handler.mjs).
node -e '
const fs = require("fs");
const file = ".open-next/server-functions/default/apps/readest-app/handler.mjs";
const prefix = /"\/home\/runner\/work\/[^"]*?\/apps\/readest-app\/\.open-next\/server-functions\/default\//g;
const code = fs.readFileSync(file, "utf8");
const count = (code.match(prefix) || []).length;
fs.writeFileSync(file, code.replace(prefix, "\"../../"));
console.log("chemins absolus rendus relatifs :", count);
'

npx wrangler deploy
