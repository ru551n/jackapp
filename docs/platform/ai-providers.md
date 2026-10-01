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
