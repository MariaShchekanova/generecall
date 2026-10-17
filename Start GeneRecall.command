#!/bin/zsh
# Portable launcher for the source folder. No credentials are bundled.
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22 or later from https://nodejs.org, then run this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  print 'GeneRecall requires Node.js 22 or later. Update Node.js and try again.'
  read '?Press Return to close.'
  exit 1
fi
print 'Starting GeneRecall. Open the Local URL printed below. Keep this window open while using it.'
node scripts/serve.mjs
if [ $? -ne 0 ]; then read '?Press Return to close.'; fi
