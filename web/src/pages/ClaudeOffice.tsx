// ClaudeOffice — embeds the claude-office pixel-art agent visualizer (localhost:8000).
// Backend must be running: PM2 process "claude-office" serves the FastAPI + static Next.js build.
import { PageHeader } from '@/components/PageHeader';

export function ClaudeOffice() {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Claude Office" />
      <div style={{ flex: 1, position: 'relative', padding: '0 16px 16px' }}>
        <iframe
          src="http://localhost:8000"
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
