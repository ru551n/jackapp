import { z } from 'zod'

// Capability-oriented AI. Technical configuration (endpoints, keys, model ids) is host-admin
// env configuration and never leaves the server. Clients only ever see CapabilityStatus.

export const AiCapability = z.enum(['text', 'vision', 'image', 'embedding', 'research'])
export type AiCapability = z.infer<typeof AiCapability>

/** API style of a configured endpoint. "mock" is for tests and local development only. */
export const ProviderKind = z.enum(['openai', 'anthropic', 'openai-compatible', 'anthropic-compatible', 'mock'])
export type ProviderKind = z.infer<typeof ProviderKind>

/**
 * Env naming convention (server/config): AI_<CAP>_PROVIDER, AI_<CAP>_BASE_URL, AI_<CAP>_API_KEY,
 * AI_<CAP>_MODEL, AI_<CAP>_TIMEOUT_MS, with <CAP> one of TEXT, VISION, IMAGE, EMBEDDING, RESEARCH.
 */
export const CAPABILITY_ENV_PREFIX: Record<AiCapability, string> = {
  text: 'AI_TEXT',
  vision: 'AI_VISION',
  image: 'AI_IMAGE',
  embedding: 'AI_EMBEDDING',
  research: 'AI_RESEARCH',
}

/** Text generation is mandatory for readiness; the rest are optional features. */
export const REQUIRED_CAPABILITIES: readonly AiCapability[] = ['text']

/** Safe for any client: no URLs, keys or model ids. */
export const CapabilityStatus = z.object({
  capability: AiCapability,
  configured: z.boolean(),
  /** Last known reachability; 'unknown' until checked. */
  reachable: z.enum(['yes', 'no', 'unknown']),
  /** Human-friendly Swedish status line, e.g. "AI-bildgenerering är tillgänglig". */
  label: z.string(),
})
export type CapabilityStatus = z.infer<typeof CapabilityStatus>
