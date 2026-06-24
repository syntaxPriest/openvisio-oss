// node:path shim for the browser. The engine's grammar configs use `path.posix`
// for import resolution; in the browser everything is posix, so we back it with
// path-browserify and expose `.posix` (which path-browserify itself omits).
import p from 'path-browserify'
export const posix = p
export const { normalize, join, dirname, basename, extname, relative, resolve, isAbsolute, sep } = p
export default p
