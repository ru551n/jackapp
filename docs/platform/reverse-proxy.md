# Reverse proxy and access control

JackApp has **no login or accounts**. Whoever reaches it is trusted, so the reverse proxy must decide who gets in. This example uses **Caddy** (automatic TLS) with **Authentik** forward auth protecting the whole site.

The app is published only on `127.0.0.1:3000`. Never publish it on a LAN or public interface: that would bypass Authentik.

## Caddy + Authentik (forward auth)

In Authentik: create a **Proxy Provider** in _Forward auth (single application)_ mode with external host `https://jackapp.example.se`, an application using it, and add it to the embedded outpost.

`Caddyfile`:

```caddyfile
jackapp.example.se {
	route {
		# Authentik's outpost endpoints (login redirect, callback).
		reverse_proxy /outpost.goauthentik.io/* http://authentik-server:9000

		forward_auth http://authentik-server:9000 {
			uri /outpost.goauthentik.io/auth/caddy
			copy_headers X-Authentik-Username X-Authentik-Groups X-Authentik-Entitlements X-Authentik-Email X-Authentik-Name X-Authentik-Uid X-Authentik-Jwt X-Authentik-Meta-Jwks X-Authentik-Meta-Outpost X-Authentik-Meta-Provider X-Authentik-Meta-App X-Authentik-Meta-Version
			trusted_proxies private_ranges
		}

		reverse_proxy app:3000 {
			# Job progress uses Server-Sent Events: don't buffer responses.
			flush_interval -1
		}
	}
}
```

JackApp ignores the `X-Authentik-*` headers (it has no users); they are copied only as Authentik documents it.

`app:3000` assumes Caddy runs in the same Compose project. Add it to `compose.yaml` and remove the app's `ports`:

```yaml
caddy:
  image: caddy:2
  ports: ['80:80', '443:443', '443:443/udp']
  volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy_data:/data']
  networks: [egress]
  restart: unless-stopped
# and under volumes:  caddy_data:
```

Authentik must be reachable from Caddy under the name used in the `Caddyfile`. With Authentik's **official** `docker-compose.yml` the service is called `server` (not `authentik-server`), so either join Caddy to Authentik's network (`networks: [egress, authentik]` with `authentik: { external: true, name: authentik_default }`) and use `http://server:9000`, or use Authentik's host address and published port. Caddy on the host instead? Use `reverse_proxy 127.0.0.1:3000`.

`trusted_proxies private_ranges` (from Authentik's example) tells Caddy to believe `X-Forwarded-*` headers from any private address. Keep it only if another proxy or load balancer sits in front of Caddy, and then narrow it to that proxy's address. If Caddy is the first hop, remove the line: otherwise any device on the LAN can send a forged `X-Forwarded-For` through to Authentik's policies.

## TRUST_PROXY

The app reads the client IP and scheme from `X-Forwarded-*` **only** when the request comes from an address in `TRUST_PROXY` (comma-separated IPs/CIDRs). Empty means trust nobody. It is never "trust everyone", since anyone could then fake their IP.

| Setup                                | TRUST_PROXY                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Caddy in the Compose project         | The `egress` network subnet: `docker network inspect jackapp_egress -f '{{(index .IPAM.Config 0).Subnet}}'` |
| Caddy on the host (→ 127.0.0.1:3000) | The same subnet (Docker forwards the published port from the network gateway, e.g. `172.19.0.1`).           |
| No proxy (local testing)             | empty                                                                                                       |

Wrong or empty `TRUST_PROXY` doesn't break anything; logs just show the proxy's IP instead of the client's.
