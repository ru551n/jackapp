import type { SystemStatus } from '../../../shared/contracts'

export type Limits = SystemStatus['limits']
export const MB = 1024 * 1024
const OK_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/
const OK_EXT = /\.(jpe?g|png|webp|pdf)$/i

/** Client-side mirror of the server limits; the server stays authoritative. */
export function checkFiles(files: File[], limits?: Limits): string[] {
  const errors: string[] = []
  for (const f of files) {
    if (/\.hei[cf]$/i.test(f.name) || /hei[cf]/.test(f.type))
      errors.push(
        `”${f.name}” är en HEIC-bild, som inte stöds. Spara den som JPEG (på iPhone: Inställningar → Kamera → Format → Mest kompatibelt) och försök igen.`,
      )
    else if (!OK_TYPES.test(f.type) && !OK_EXT.test(f.name))
      errors.push(`”${f.name}” är inte en bild (JPEG, PNG, WEBP) eller en PDF.`)
    else if (limits && f.size > limits.maxUploadFileMb * MB)
      errors.push(`Filen ”${f.name}” är större än ${limits.maxUploadFileMb} MB.`)
  }
  if (limits && files.length > limits.maxPagesPerSet)
    errors.push(`Materialet har fler än ${limits.maxPagesPerSet} sidor.`)
  if (limits && files.reduce((n, f) => n + f.size, 0) > limits.maxUploadTotalMb * MB)
    errors.push(`Materialet är större än ${limits.maxUploadTotalMb} MB totalt.`)
  return errors
}
