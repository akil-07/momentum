#!/bin/sh
# compile the app's logic modules to plain ESM for the node scenario tests: tests/build.sh <outdir>
set -e
OUT="$1"; APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
npx tsc --ignoreConfig --outDir "$OUT" --noEmit false --module esnext --target es2022 --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck --strict --types vite/client \
  src/store.ts src/train.ts src/planner.ts src/cpblocks.ts src/discipline.ts src/ideas.ts src/curriculum.ts src/cf.ts src/sync.ts src/claude.ts src/contests.ts src/cptime.ts src/leverage.ts src/theme.ts src/curriculumData.ts src/season.ts src/archive.ts 2>/dev/null || \
npx tsc --ignoreConfig --outDir "$OUT" --noEmit false --module esnext --target es2022 --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck --strict --types vite/client \
  src/store.ts src/train.ts src/planner.ts src/cpblocks.ts src/discipline.ts src/ideas.ts src/curriculum.ts src/cf.ts src/sync.ts src/claude.ts src/contests.ts src/cptime.ts src/leverage.ts src/theme.ts src/curriculumData.ts
for f in "$OUT"/*.js; do sed -i -E "s#(from '\./[A-Za-z0-9_]+)'#\1.js'#g" "$f"; done
[ -e "$OUT/package.json" ] || echo '{"type":"module"}' > "$OUT/package.json"
[ -e "$OUT/node_modules" ] || ln -s "$APP/node_modules" "$OUT/node_modules"
