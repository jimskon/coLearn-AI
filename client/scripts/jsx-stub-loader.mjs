/**
 * jsx-stub-loader.mjs
 *
 * Node ESM loader hook. Intercepts *.jsx imports and returns lightweight stubs
 * so that plain-JS utility tests can import modules that transitively depend on
 * React components without a bundler or JSDOM.
 *
 * Usage:
 *   node --import ./scripts/jsx-stub-loader.mjs --test scripts/some.test.mjs
 *
 * Only parseSheet.jsx is stubbed in detail; all other .jsx files get a generic
 * no-op default export + empty named exports.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// We need a source hook. Use register() so we can hook from this loader file.
// Register a custom source transform: .jsx → plain JS stub.
register(
  'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      return nextResolve(specifier, context);
    }
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.jsx')) {
        // parseSheet.jsx is the primary dependency we need to stub
        const isParseSheet = url.includes('parseSheet');
        const source = isParseSheet
          ? \`
              export function parseSheetToBlocks(lines, opts) {
                return { blocks: [], issues: [], meta: {} };
              }
              export const INLINE_AI_DEFAULT_MODEL = 'stub-model';
              export const INLINE_AI_MODE_GUIDE = [];
              export const INLINE_AI_MODEL_OPTIONS = [];
              export function collectInfosForTarget() { return []; }
              export function readAiTranscript() { return null; }
              export function aiBaseQidFor() { return null; }
              export default function StubComponent() { return null; }
            \`
          : 'export default function Stub() { return null; }';
        return { format: 'module', source, shortCircuit: true };
      }
      return nextLoad(url, context);
    }
  `),
  pathToFileURL('./').href,
);
