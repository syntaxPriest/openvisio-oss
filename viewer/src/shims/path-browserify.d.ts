declare module 'path-browserify' {
  interface PosixPath {
    normalize(p: string): string
    join(...parts: string[]): string
    dirname(p: string): string
    basename(p: string, ext?: string): string
    extname(p: string): string
    relative(from: string, to: string): string
    resolve(...parts: string[]): string
    isAbsolute(p: string): boolean
    sep: string
  }
  const path: PosixPath
  export default path
}
