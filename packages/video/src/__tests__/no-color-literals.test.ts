import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const ALLOWED_BASENAMES = ['types.ts'];
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(['"`])\s*(white|black|red|blue|green|gray|grey|yellow|orange|purple|pink|cyan|magenta|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia)\s*\1/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('colour literals live only in types.ts', () => {
  it('finds none in any other source file', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => !ALLOWED_BASENAMES.includes(path.basename(f)))
      .filter((f) => COLOR_LITERAL.test(readFileSync(f, 'utf8')));

    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
