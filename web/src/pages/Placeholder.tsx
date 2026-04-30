import { PageHeader } from '@/components/PageHeader';

interface Props {
  title: string;
  description: string;
}

// Stub page used by every route until the real implementation lands in
// later PRs. Keeps the AppShell + sidebar + routing skeleton useful even
// while page bodies are empty.
export function Placeholder({ title, description }: Props) {
  return (
    <div class="flex flex-col h-full">
      <PageHeader title={title} />
      <div class="flex-1 flex items-center justify-center px-6 py-12">
        <div class="max-w-md text-center">
          <div class="text-[var(--color-text)] text-[15px] font-medium mb-1.5">{title}</div>
          <div class="text-[var(--color-text-muted)] text-[13px] leading-relaxed">{description}</div>
          <div class="mt-4 text-[11px] text-[var(--color-text-faint)] uppercase tracking-wider">
            Coming in a follow-up PR
          </div>
        </div>
      </div>
    </div>
  );
}
