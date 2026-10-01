declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface Phonemize {
    callMain: (args: string[]) => void
  }
  const create: (opts: Record<string, unknown>) => Promise<Phonemize>
  export default create
}
