import { mkdirSync, readFileSync } from 'node:fs';
mkdirSync('test-results/tests', { recursive: true });
import { builtinResourceEntries, installBuiltinResources } from '../src/io/builtin-resources';

installBuiltinResources(
  Object.fromEntries(
    builtinResourceEntries.map((entry) => [
      entry.file,
      new Uint8Array(readFileSync(new URL('../editor-assets/' + entry.file, import.meta.url))),
    ]),
  ),
);
