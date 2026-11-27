#!/bin/sh
# ════════════════════════════════════════════════════════════
#  BUILD FÜR CLOUDFLARE PAGES
#  Kopiert nur, was die App im Browser braucht, nach dist/.
#  Repo-Dateien wie supabase/, .github/, Anleitungen und JSON-Dateien
#  (z.B. alte Datenstände) werden so nicht veröffentlicht.
#
#  Einstellungen in Cloudflare Pages:
#    Build command:          sh build.sh
#    Build output directory: dist
#
#  Neue Dateiarten (z.B. .webp) unten bei TYPEN ergänzen.
# ════════════════════════════════════════════════════════════
set -eu

TYPEN="html js css png jpg jpeg svg ico webp woff2 webmanifest"

rm -rf dist
mkdir dist
for typ in $TYPEN; do
  for datei in *."$typ"; do
    if [ -f "$datei" ]; then cp "$datei" dist/; fi
  done
done
# Eigene Header für Cloudflare (Caching usw.), falls vorhanden
if [ -f _headers ]; then cp _headers dist/; fi

echo "dist/ enthält:"
ls -1 dist
