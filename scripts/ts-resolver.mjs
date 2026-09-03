/**
 * Module-resolution hook for `npm test`.
 *
 * The source imports siblings as `./foo.js` -- correct for TS's NodeNext
 * resolution and for the Vite build, where those specifiers point at emitted
 * JavaScript. Node's native type stripping does not rewrite them, so running a
 * `.ts` test file directly fails with ERR_MODULE_NOT_FOUND on `./foo.js`.
 *
 * This maps a relative `.js` specifier to the `.ts` file beside it when one
 * exists, and otherwise gets out of the way. Test-only: the build never loads
 * this.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    } catch {
      // No sibling .ts -- fall through to normal resolution.
    }
  }
  return nextResolve(specifier, context);
}
