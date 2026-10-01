# AI providers

JackApp needs AI. Each **capability** is configured on its own with `AI_<CAP>_*` variables (full list: [env.md](env.md), examples: `.env.example`):

| Capability  | Used for                                       | Required                    |
| ----------- | ---------------------------------------------- | --------------------------- |
| `TEXT`      | Generating exercises, explanations, checking   | **Yes** (`/ready` needs it) |
| `VISION`    | Reading photos and PDF pages of study material | No; uploads unavailable     |
| `IMAGE`     | Illustrations                                  | No                          |
| `EMBEDDING` | Search and matching                            | No                          |
| `RESEARCH`  | Web research (`searxng`, `brave`, `tavily`)    | No                          |

Providers: `openai`, `anthropic` (cloud, base URL optional), `openai-compatible`, `anthropic-compatible` (any server speaking those APIs: llama.cpp, vLLM, Ollama, LM Studio, LiteLLM…), `mock` (development and tests only). Capabilities may mix providers, e.g. local text and cloud images.

`AI_TEXT_STRUCTURED` / `AI_VISION_STRUCTURED`: `auto` picks the best JSON mode the provider supports. If a local server rejects `response_format`, set `json_mode`, or `prompt` as the last resort.

## Local (LAN) endpoints from containers

Inside a container, `localhost` is **the container itself**, not your machine.

- Server on another machine: use its LAN IP, e.g. `AI_TEXT_BASE_URL=http://192.168.1.50:8080/v1`. The server must listen on `0.0.0.0`, not `127.0.0.1`.
- Server on the Docker host: use `http://host.docker.internal:8080/v1` and add to **both** `app` and `worker` in `compose.yaml`:
  ```yaml
  extra_hosts: ['host.docker.internal:host-gateway']
  ```
  The host's server must listen on an address the Docker bridge can reach (`0.0.0.0`, or the bridge IP), and a host firewall may need to allow it.

Check from inside: `docker compose exec app node -e "fetch('http://192.168.1.50:8080/v1/models').then(r=>console.log(r.status))"`.

## Privacy

- **Cloud AI** (`openai`, `anthropic`, cloud research): prompts, including a child's answers, uploaded study material (homework photos, PDFs) and learner first names if used in prompts, are sent to that company and handled under its terms. Use API accounts with training on customer data disabled, and don't put more personal data into profiles than needed.
- **Local AI** (`*-compatible` on your LAN): nothing leaves your network. Quality and speed depend on your hardware and model.
- `ALLOW_CLOUD_AI=false` makes the app refuse to start if any capability points at a cloud provider: a guard against accidental data sharing. `ALLOW_LOCAL_AI=false` does the reverse.
- Web research (`RESEARCH`) sends search queries to the search provider. A self-hosted SearXNG still queries public search engines, but without identifying you.
- API keys live only in `.env`; they are never logged or sent to the browser. Adults see only "available / unavailable" per capability.

## Adapters and structured output

_Owned by the AI layer (`server/ai`). Configuration variables: [env.md](env.md#ai-capabilities-serveraiconfigts)._

### Capabilities

`createAi(env, { db, log })` (`server/ai/index.ts`) returns the configured capabilities. An unset one is `undefined`, so callers must check for it before use:

| Capability  | Interface                                                                     | Providers                                                                  |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `text`      | `TextGeneration.generate({ system, messages, schema?, ... })`                 | `openai`, `anthropic`, `openai-compatible`, `anthropic-compatible`, `mock` |
| `vision`    | `Vision.generate({ ..., images })` (images go on the last user message)       | same as text                                                               |
| `image`     | `ImageGeneration.generate({ prompt, size, n })` returns bytes and a mime type | `openai`, `openai-compatible`, `mock`                                      |
| `embedding` | `Embeddings.embed(texts)`                                                     | `openai`, `openai-compatible`, `mock`                                      |
| `research`  | `WebResearch.search({ query, maxResults, language })`                         | `searxng`, `brave`, `tavily`, `mock`                                       |

Text is required: if it is not configured, `/ready` fails. The other capabilities report themselves unavailable in `GET /api/v1/system/status`.

### Endpoints

- **OpenAI style:** `AI_<CAP>_BASE_URL` includes `/v1`, e.g. `http://192.168.1.50:8080/v1`. The adapters call `/chat/completions`, `/images/generations`, `/embeddings` and `/models`. This works with llama.cpp `llama-server`, Ollama (`http://host:11434/v1`), vLLM and LM Studio.
- **Anthropic style:** the base URL may be given with or without `/v1`. The adapters call `/v1/messages` and `/v1/models`, and send the key as `x-api-key`.
- **Research:**
  - SearXNG uses `/search?format=json`. JSON output must be enabled in its `settings.yml`.
  - Brave uses `/res/v1/web/search`.
  - Tavily uses `POST /search`.

The adapters use plain `fetch` rather than the vendor SDKs. The surface is small (one request per capability), it adds no dependencies, and it behaves the same on every compatible server.

### Structured output

When a caller passes a zod `schema`, it is converted with zod's built-in `z.toJSONSchema`. If the schema's root is not an object, it is wrapped as `{ value }` and unwrapped again afterwards, because tools and `json_schema` need an object root.

`AI_<CAP>_STRUCTURED` picks the strategy:

| Mode          | OpenAI                                                                                                         | OpenAI-compatible                                                              | Anthropic(-compatible)                              |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `auto`        | `response_format: json_schema`, strict when every object property is required (otherwise non-strict)           | `json_schema`, stepping down on HTTP 400 to `json_object`, then to prompt-only | Forced tool use (`tool_choice`) with `input_schema` |
| `json_schema` | `json_schema`                                                                                                  | `json_schema`                                                                  | Forced tool use                                     |
| `json_mode`   | `json_object` plus the schema in the system prompt                                                             | same                                                                           | Schema in the system prompt                         |
| `prompt`      | Schema in the system prompt; JSON is extracted from the text (code fences and surrounding prose are tolerated) | same                                                                           | same                                                |

For compatible servers, the step-down is remembered for the life of the process. If a server needs a fixed mode, set it explicitly.

Every response is validated with zod, whatever the mode. If parsing or validation fails, the adapter runs **one repair round**: it sends back the model's answer and the zod errors, then validates again. If that also fails, it throws `AiError('ai_invalid_output')`. Token usage is summed across both rounds.

### Errors

Every failure is an `AiError` with a `code`, a `retryable` flag, a safe Swedish `message` and a log-safe `detail`.

| Code                | Cause                                                                                     | Retryable |
| ------------------- | ----------------------------------------------------------------------------------------- | --------- |
| `ai_unavailable`    | Network failure, timeout (`AI_<CAP>_TIMEOUT_MS`), 5xx/408, or a non-JSON body             | yes       |
| `ai_rate_limited`   | Provider 429 (`retryAfterMs` when given) or the hourly limit `LIMIT_AI_REQUESTS_PER_HOUR` | yes       |
| `ai_auth`           | 401/403. An admin needs to fix the key                                                    | no        |
| `ai_config`         | Other 4xx (wrong model, unsupported parameter, bad base URL)                              | no        |
| `ai_invalid_output` | Output still invalid after the repair round, or an empty response                         | no        |
| `ai_refused`        | Provider refusal (OpenAI `refusal`/`content_filter`, Anthropic `stop_reason: refusal`)    | no        |

When the caller aborts through `signal`, the abort error is rethrown as is, not wrapped in an `AiError`.

### Limits and logging

- **Hourly limit:** every model request (including each repair round) is counted in the `ai_request_buckets` table with an atomic upsert keyed on the DB clock's hour, so app and worker share the count. Web research is not counted.
- **Concurrency:** a per-process semaphore caps concurrent model requests at `LIMIT_AI_CONCURRENCY`.
- **Logging:** each request logs the capability, provider kind, model, duration, token usage and error code. Prompts, images, keys, headers, URLs and provider error messages are never logged; only the provider's short error code is kept in `detail`.

### Readiness

`ai.<cap>` readiness checks run a cheap probe lazily and cache the result for 60 s:

- OpenAI-style providers: `GET {base}/models`.
- Anthropic-style providers: `GET /v1/models`.
- SearXNG: `GET /healthz`.

Brave and Tavily are not probed, so they stay `unknown`.

A check reports one of these details:

- `not configured`
- `unreachable` (network, timeout or 5xx)
- `authentication failed`
- `reachable` (any other HTTP answer, including 404 from servers without `/models`)

Only `ai.text` is critical.

### Mock provider

`AI_<CAP>_PROVIDER=mock` needs no URL, key or model. It behaves as follows:

- **Text:** returns `Mock-svar (<model>).`.
- **Structured output:** returns a minimal value that satisfies the JSON Schema.
- **Images:** returns 1×1 PNGs.
- **Embeddings:** returns deterministic 8-dimensional vectors.
- **Research:** returns one example result.

Tests can script text and vision by passing `createAi(env, { db, log, mock: { text: (req, call) => ... } })`. The script returns a string (raw model text) or an object (native JSON).

`npm run dev:all` (`server/dev.ts`) scripts the mock text model with `devMockText` (`server/ai/dev-mock.ts`): deterministic, varied addition practice that passes validation for every artifact type and item kind (unique choices, a correct answer, numeric items with a `check` that evaluates to the answer), so local and e2e flows produce approvable material. Other prompts get the minimal schema sample.
