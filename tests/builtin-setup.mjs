import { readFileSync } from 'node:fs';
import { builtinResourceEntries, installBuiltinResources } from '../src/io/builtin-resources';

installBuiltinResources(
  Object.fromEntries(
    builtinResourceEntries.map((entry) => [
      entry.file,
      new Uint8Array(readFileSync(new URL('../editor-assets/' + entry.file, import.meta.url))),
    ]),
  ),
);
