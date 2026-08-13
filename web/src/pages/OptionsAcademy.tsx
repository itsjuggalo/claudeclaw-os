// Options Trading Academy — the self-contained study app (108 Qs, payoff diagrams,
// graded exam) bundled from ~/restructure/options-academy via build_academy.py.
// Rendered in an iframe srcdoc so its inline CSS/JS run isolated; srcdoc inherits
// the dashboard origin, so the app's localStorage progress persists per device.
import academyHtml from '@/embed/options-academy.html?raw';

export function OptionsAcademy() {
  return (
    <div class="h-full w-full bg-[var(--color-bg)]">
      <iframe
        srcdoc={academyHtml}
        title="Options Trading Academy"
        class="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </div>
  );
}
