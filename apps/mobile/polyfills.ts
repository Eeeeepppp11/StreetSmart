/**
 * h3-js's compiled runtime (pulled in transitively via @potholeproof/geo,
 * used by nav/guidance.ts and @potholeproof/routing) decodes its WASM
 * string memory with `new TextDecoder("utf-16le")` at module-load time.
 *
 * Two things stack to break that under Expo Go / Hermes:
 *
 * 1. expo/src/winter installs its own UTF-8-only TextDecoder as a side
 *    effect of `import 'expo'` (a lazy global getter/setter — see
 *    expo/src/winter/runtime.native.ts). It runs unconditionally and
 *    overwrites anything set before it, so this file's own overrides must
 *    come AFTER `import 'expo'` in index.ts, not before.
 *
 * 2. The `text-encoding` polyfill only installs its own TextDecoder/
 *    TextEncoder when `globalThis.TextDecoder`/`TextEncoder` are absent
 *    (`if (!global['TextDecoder']) global['TextDecoder'] = TextDecoder`).
 *    Merely reading that property to check triggers Expo's lazy getter,
 *    which materializes Expo's UTF-8-only class right then — so
 *    text-encoding sees "already defined", skips installing its own, and
 *    hands that same broken class back through its exports. Reordering
 *    imports alone does NOT fix this: text-encoding re-poisons itself
 *    against Expo's getter the moment it's required.
 *
 * Fix: delete whatever's currently installed (Expo's getter is
 * configurable, so this succeeds) immediately before requiring
 * text-encoding, forcing its "if absent" check to actually be true. Uses
 * require() rather than import so this runs in the exact order written —
 * ES import statements get hoisted above other code in the file and would
 * reorder themselves ahead of the deletes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (globalThis as any).TextDecoder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (globalThis as any).TextEncoder;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextDecoder, TextEncoder } = require("text-encoding") as {
  TextDecoder: typeof globalThis.TextDecoder;
  TextEncoder: typeof globalThis.TextEncoder;
};

globalThis.TextDecoder = TextDecoder;
globalThis.TextEncoder = TextEncoder;
