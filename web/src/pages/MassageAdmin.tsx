import { ClipboardList, LockKeyhole, Mail, MessageSquareText, CalendarClock, Percent, FileText, UserRound, ShieldAlert } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';

interface AdminSection {
  title: string;
  description: string;
  icon: typeof ClipboardList;
  status: string;
}

const sections: AdminSection[] = [
  {
    title: 'Massage clients',
    description: 'Client list placeholder for future read-only search and lifecycle summaries.',
    icon: UserRound,
    status: 'Not connected',
  },
  {
    title: 'Client profile/details',
    description: 'Profile, booking history, preferences, and consent indicators will live here after an approved API design.',
    icon: FileText,
    status: 'Placeholder',
  },
  {
    title: 'Free next-visit enhancements',
    description: 'Future admin workflow for recording approved complimentary enhancements without exposing raw database writes.',
    icon: ClipboardList,
    status: 'Planned',
  },
  {
    title: 'Notes',
    description: 'Private admin notes are intentionally not wired until storage, audit, and access rules are reviewed.',
    icon: FileText,
    status: 'Planned',
  },
  {
    title: 'Email consent',
    description: 'Marketing email tools must require explicit opt-in consent before any campaign or individual send.',
    icon: Mail,
    status: 'Consent required',
  },
  {
    title: 'SMS/text consent',
    description: 'SMS workflows must require explicit text-message opt-in consent before any outreach.',
    icon: MessageSquareText,
    status: 'Consent required',
  },
  {
    title: 'Schedule availability updates',
    description: 'Availability notices can be designed later as opt-in communications with preview and audit logging.',
    icon: CalendarClock,
    status: 'Planned',
  },
  {
    title: 'Seasonal discount campaigns',
    description: 'Campaign tooling is blocked until audience consent filtering, approvals, and send limits exist.',
    icon: Percent,
    status: 'Blocked by consent',
  },
  {
    title: 'Admin action log',
    description: 'Future audit trail for every admin mutation, export, consent change, and communication action.',
    icon: LockKeyhole,
    status: 'Required before launch',
  },
];

function StatusPill({ label }: { label: string }) {
  return (
    <span class="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-elevated)] border border-[var(--color-border)]">
      {label}
    </span>
  );
}

export function MassageAdmin() {
  return (
    <div class="flex h-full flex-col">
      <PageHeader
        title="Massage Admin"
        actions={
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-warn)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-warn)]"
            style="background:color-mix(in srgb,var(--color-warn) 12%,transparent)"
          >
            <ShieldAlert size={13} />
            Admin-only placeholder
          </span>
        }
      />

      <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
        <section class="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface,var(--color-elevated))] px-4 py-3">
          <div class="flex flex-wrap items-start gap-3">
            <LockKeyhole size={18} class="mt-0.5 text-[var(--color-accent)]" />
            <div class="min-w-0 flex-1">
              <h2 class="text-[13px] font-semibold text-[var(--color-text)]">Protected dashboard area</h2>
              <p class="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                This page is behind the existing ClaudeClaw dashboard access gate, but no separate admin role check was found.
                TODO: add real admin role enforcement before connecting client data, database mutations, email, or SMS tools.
              </p>
              <p class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-faint)]">
                No email or SMS sending is connected. Future marketing messages must require explicit opt-in consent.
              </p>
            </div>
          </div>
        </section>

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <article key={section.title} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
                <div class="flex items-start gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-accent)]">
                    <Icon size={17} />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <h3 class="text-[13px] font-semibold text-[var(--color-text)]">{section.title}</h3>
                      <StatusPill label={section.status} />
                    </div>
                    <p class="mt-2 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{section.description}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
