// Fetch a file once, keep it in Cache Storage (when available) so it also works offline.
const CACHE = 'jackapp-voices-v1'

export async function cachedBytes(url: string, onProgress?: (loaded: number, total: number) => void) {
  const cache = 'caches' in self ? await caches.open(CACHE).catch(() => null) : null
  const hit = await cache?.match(url).catch(() => undefined)
  if (hit) return hit.arrayBuffer()
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
  await cache?.put(url, new Response(bytes)).catch(() => {})
  return bytes
}
