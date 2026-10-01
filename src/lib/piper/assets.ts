import { getBytes, putBytes } from './store'

// Fetch a file once and keep it on the device (IndexedDB) so it also works offline.

export async function cachedBytes(url: string, onProgress?: (loaded: number, total: number) => void) {
  const hit = await getBytes(`asset:${url}`)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const parts: Uint8Array[] = []
  let loaded = 0
  const reader = res.body!.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    onProgress?.(loaded, total || loaded)
  }
  const bytes = await new Blob(parts as BlobPart[]).arrayBuffer()
  await putBytes(`asset:${url}`, bytes)
  return bytes
}
