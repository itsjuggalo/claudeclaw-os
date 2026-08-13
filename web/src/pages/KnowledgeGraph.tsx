import { PageHeader } from '@/components/PageHeader';
// Standalone graphify export (vis-network clustered community graph of Mike's
// memory corpus), inlined at build time via Vite ?raw and rendered through an
// iframe srcdoc. Inlining keeps this a pure web change — ships with `build:web`
// alone, no backend route and no pm2 restart (claudeclaw deploy rule). Regenerate
// with: graphify over ~/.claude/.../memory → copy graph.html to
// src/knowledge-graph.inline.html → npm run build:web.
import graphHtml from '@/knowledge-graph.inline.html?raw';

export function KnowledgeGraph() {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Knowledge Graph" />
      <div class="flex-1 min-h-0">
        <iframe
          srcdoc={graphHtml}
          title="Knowledge Graph"
          class="w-full h-full border-0 bg-[var(--color-bg)]"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}
