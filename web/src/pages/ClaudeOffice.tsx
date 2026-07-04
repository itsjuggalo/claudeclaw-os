// ClaudeOffice — embeds the claude-office pixel-art agent visualizer (:8000, PM2 "claude-office").
// Host-relative src so it works on BOTH paths (a hardcoded http://localhost:8000 pointed at the
// phone's own localhost and was blocked as mixed content under the HTTPS phone path):
//   desktop → http://localhost:8000        (WSL loopback forwarding)
//   phone   → https://<tailnet-host>:8000  (tailscale-serve TLS → http://127.0.0.1:8000)
import { PageHeader } from '@/components/PageHeader';

const OFFICE_SRC = `${location.protocol}//${location.hostname}:8000`;

export function ClaudeOffice() {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Claude Office" />
      <div style={{ flex: 1, position: 'relative', padding: '0 16px 16px' }}>
        <iframe
          src={OFFICE_SRC}
          title="Claude Office Visualizer"
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
