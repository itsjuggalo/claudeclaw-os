// TokenUsage — embeds the token-dashboard Claude Code token/cost analytics (:8080).
// Backend must be running: PM2 process "token-dashboard" serves the stdlib HTTP server on 0.0.0.0:8080.
// The iframe src is host-relative so it works on BOTH access paths without mixed-content blocks:
//   desktop  → http://localhost:8080         (WSL loopback forwarding)
//   phone    → https://<tailnet-host>:8080   (tailscale-serve TLS → http://127.0.0.1:8080)
// A hardcoded http://<tailscale-IP>:8080 broke on both: unreachable from the Windows desktop
// (WSL is NAT-mode, no Windows tailnet node) and blocked as mixed content under the HTTPS phone path.
import { PageHeader } from '@/components/PageHeader';

const TOKEN_DASHBOARD_SRC = `${location.protocol}//${location.hostname}:8080`;

export function TokenUsage() {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Token Usage" />
      <div style={{ flex: 1, position: 'relative', padding: '0 16px 16px' }}>
        <iframe
          src={TOKEN_DASHBOARD_SRC}
          title="Token Dashboard"
          style={{
            width: '100%',
            height: '100%',
            border: '1px solid #1a2332',
            borderRadius: '10px',
            background: '#07090d',
            display: 'block',
          }}
          allowFullScreen
        />
      </div>
    </div>
  );
}
