// TokenUsage — embeds the token-dashboard Claude Code token/cost analytics (Tailscale IP :8080).
// Backend must be running: PM2 process "token-dashboard" serves the stdlib HTTP server.
// Bound to the Tailscale IP (HOST=100.91.39.122, NOT 0.0.0.0/loopback) so the iframe loads from
// both laptop and phone over the tailnet, while staying off the LAN/internet (privacy).
import { PageHeader } from '@/components/PageHeader';

export function TokenUsage() {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Token Usage" />
      <div style={{ flex: 1, position: 'relative', padding: '0 16px 16px' }}>
        <iframe
          src="http://100.91.39.122:8080"
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
