import { test, expect, type Page } from '@playwright/test';

// Regression cover for the massage owner console (Today / Client Profile /
// schedule calendar / body chart). Every massage endpoint is stubbed with
// fixtures so the suite is deterministic and never reads — or writes — Mike's
// real clinical data. Matches the house style in dashboard-fake-provider.spec.ts.

const TODAY = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY_ISO = iso(TODAY);
const MONTH = TODAY_ISO.slice(0, 7);
const LONG_AGO = new Date(TODAY.getTime() - 90 * 86_400_000);

const CLIENT = {
  id: 'c1', name: 'Jenna Black', phone: '727-555-0101', email: 'jenna@example.com',
  notes: 'Prefers firm pressure.', nextVisitFreeEnhancement: '', enhancementExpirationDate: '',
  emailOptIn: true, smsOptIn: false, accountStatus: 'active',
  createdAt: `${iso(LONG_AGO)} 09:00:00`, emailVerifiedAt: `${iso(LONG_AGO)} 09:05:00`,
  appointmentCount: 2, upcomingAppointmentCount: 0, rewardBalance: 3,
  lastVisitMs: LONG_AGO.getTime(),
};

const SOAP_NOTE = {
  id: 'n1', appointment_id: 'a1', user_id: 'c1', client_email: CLIENT.email,
  session_date: iso(LONG_AGO), created_at: `${iso(LONG_AGO)} 11:00:00`, updated_at: null, author: 'mike',
  pain_before: 7, pain_after: 3, position: 'prone', pressure: 'firm', duration_min: 90,
  techniques: ['Deep tissue'], areas_concern: [{ region: 'Back', severity: 5, findings: 'Adhesions', focus: true }],
  subjective: 'Shoulder ache for 6 months.', objective: 'Palpable hypertonicity.',
  assessment: 'Myofascial restriction.', plan: 'Reassess next visit.',
  home_care: 'Daily stretching', next_focus: [{ region: 'Back' }], referrals: null,
  adverse_reactions: null, flags: {},
};

const INTAKE_SCHEMA = {
  title: 'Client Intake',
  sections: [
    { id: 'personal', title: 'About You', fields: [
      { name: 'name', label: 'Full name', type: 'text', required: true },
      { name: 'city', label: 'City', type: 'text' },
    ] },
    { id: 'visit', title: 'Your Visit', fields: [
      { name: 'major_complaints', label: 'What brings you in?', type: 'textarea' },
    ] },
    { id: 'consent', title: 'Consent', fields: [
      { name: 'signature', label: 'Signature', type: 'signature', required: true },
    ] },
  ],
};

async function stubMassageApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/massage-admin/clients') {
      return json({ dbPath: ':memory:', migration: { required: false, missingUserColumns: [], missingTables: [], sqlFile: '' }, clients: [CLIENT], actionLog: [] });
    }
    if (path === '/api/massage-admin/session') return json({ canEdit: true, adminUser: 'e2e', reason: null, roleTodo: '' });
    if (path === '/api/massage-admin/availability/pending') return json({ ok: true, pending: [] });
    if (path === '/api/massage-admin/availability/schedule') {
      return json({
        ok: true, month: MONTH, blackouts: [], timeBlocks: [],
        appts: [
          { id: 'a1', appt_date: TODAY_ISO, appt_time: '10:00', client_name: 'Jenna Black', service_name: '90-Minute Massage', status: 'confirmed', beyond_window: 0, duration_min: 90 },
          { id: 'a2', appt_date: TODAY_ISO, appt_time: '14:00', client_name: 'Tom Jones', service_name: '60-Minute Massage', status: 'requested', beyond_window: 0, duration_min: 60 },
        ],
      });
    }
    if (path === '/api/massage-admin/availability') {
      return json({ ok: true, hours: {}, bookingWindowDays: 28, maxAdvanceDays: 365, blackouts: [], timeBlocks: [], bookingsPaused: false });
    }
    if (path === '/api/massage-admin/intakes') {
      return json({ intakes: [{ id: 'i1', appointment_id: 'a1', submitted_at: `${iso(LONG_AGO)} 08:00:00`, reviewed_at: null, reviewed_by: null, has_signature: 1, client_name: CLIENT.name, client_email: CLIENT.email, user_id: 'c1', service_name: '90-Minute Massage', appt_date: iso(LONG_AGO), appt_time: '10:00' }] });
    }
    if (path === '/api/massage-admin/soap') {
      return json({ ok: true, notes: [SOAP_NOTE], trend: { regions: {}, pain: [] }, carry_forward: { next_focus: [{ region: 'Back' }], last_note_id: 'n1', flags: { meds: { label: 'Medications', value: 'Yes' } } } });
    }
    if (/\/api\/massage-admin\/clients\/[^/]+\/appointments$/.test(path)) {
      return json({ appointments: [{ id: 'a1', appt_date: iso(LONG_AGO), appt_time: '10:00', service_name: '90-Minute Massage', status: 'completed', start_ms: LONG_AGO.getTime(), client_email: CLIENT.email }] });
    }
    if (path === '/api/massage-admin/intake-schema') {
      return json({
        ok: true,
        schema: INTAKE_SCHEMA,
        fieldTypes: [
          { id: 'text', label: 'Short text' }, { id: 'textarea', label: 'Long text' },
          { id: 'select', label: 'Dropdown', options: true }, { id: 'yesno', label: 'Yes / No' },
          { id: 'signature', label: 'Signature' },
        ],
        protectedFields: ['name', 'signature'],
        protectedSections: ['personal', 'consent'],
        backups: [{ name: 'intake-2026-08-01T10-00-00-000Z.json', savedAt: '2026-08-01T10:00:00.000Z', bytes: 4096 }],
      });
    }
    if (path === '/api/massage-admin/intake-schema/validate') {
      // Mirror the server rule the builder leans on: a dropdown with no choices
      // is rejected, everything else passes.
      const sent = JSON.parse(req.postData() || '{}').schema || { sections: [] };
      for (const sec of sent.sections || []) {
        for (const f of sec.fields || []) {
          if (f.type === 'select' && !(f.options || []).length) {
            return json({ ok: false, error: `Field "${f.name}" (select) needs at least one option.` });
          }
        }
      }
      return json({ ok: true });
    }
    if (path === '/api/massage/monitor') {
      return json({ accounts: { total: 1, verified: 1, unverified: 0 }, appointments: { requested: 0, confirmed_upcoming: 0, total: 2 }, payments: { pending: 2 } });
    }
    // Everything else the shell polls — keep it quiet and deterministic.
    return json({});
  });
}

async function openConsole(page: Page) {
  await stubMassageApi(page);
  await page.goto('/massage-admin');
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
}

test('Today tab surfaces the day and only real blockers', async ({ page }) => {
  await openConsole(page);

  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Mike/ })).toBeVisible();
  await expect(page.getByText('Jenna Black').first()).toBeVisible();
  await expect(page.getByText('2 sessions on the book today.')).toBeVisible();

  // Payments have no view in this console, so that row must not offer a jump.
  const payments = page.locator('button', { hasText: 'payments pending' });
  await expect(payments).toBeDisabled();
  await expect(payments).toContainText('settle on the massage site');

  // Unreviewed intake DOES have a destination.
  await expect(page.locator('button', { hasText: 'intake form not reviewed' })).toBeEnabled();
});

test('client profile merges intakes, notes and bookings into one timeline', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: /Client Profile/ }).click();
  await page.getByRole('button', { name: /Jenna Black/ }).click();

  await expect(page.getByRole('heading', { name: 'Jenna Black' })).toBeVisible();
  await expect(page.getByText('1 flagged')).toBeVisible();           // carry-forward safety flag
  await expect(page.locator('text=Focus next').locator('..')).toContainText('Back');

  // One rail entry per source: SOAP + Intake + Booking.
  await expect(page.getByText('3 entries')).toBeVisible();
  await expect(page.getByText('SOAP', { exact: true })).toBeVisible();
  await expect(page.getByText('Intake', { exact: true })).toBeVisible();
  await expect(page.getByText('Booking', { exact: true })).toBeVisible();
});

test('schedule week grid places bookings against the clock', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: 'Availability', exact: true }).click();

  await expect(page.getByText('2 bookings in view')).toBeVisible();
  await expect(page.getByTitle(/Jenna Black.*confirmed/)).toBeVisible();
  await expect(page.getByTitle(/Tom Jones.*requested/)).toBeVisible();
});

test('schedule list view filters down to one booking', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: 'Availability', exact: true }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();

  const rows = page.locator('button', { hasText: 'Minute Massage' });
  await expect(rows).toHaveCount(2);

  await page.getByPlaceholder('Search name or service…').fill('jenna');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jenna Black');

  await page.getByPlaceholder('Search name or service…').fill('nobody-by-that-name');
  await expect(page.getByText('No bookings match your filters.')).toBeVisible();
});

test('form builder refuses to delete legally required questions', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: 'Form Builder' }).click();

  await expect(page.getByText('3 sections · 4 questions')).toBeVisible();
  await expect(page.getByText('in sync with the live form')).toBeVisible();

  // "Full name" is protected → its row delete is off, "City" next to it is not.
  const delQ = page.getByRole('button', { name: /^Delete question/ });
  await expect(delQ.first()).toBeDisabled();          // Full name — protected
  await expect(delQ.nth(1)).toBeEnabled();            // City — not
  await expect(delQ.first()).toHaveAttribute('title', /required by Florida law/);
  // Same for the section: "About You" is protected, "Your Visit" is not.
  const delS = page.getByRole('button', { name: /^Delete section/ });
  await expect(delS.first()).toBeDisabled();
  await expect(delS.nth(1)).toBeEnabled();
});

test('form builder blocks saving an invalid question until it is fixed', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: 'Form Builder' }).click();

  await page.getByRole('button', { name: 'Add question', exact: true }).nth(1).click();
  await expect(page.getByText('3 sections · 5 questions')).toBeVisible();
  await expect(page.getByText('unsaved changes')).toBeVisible();

  await page.getByText('New question').last().click();
  await page.locator('select').filter({ hasText: 'Short text' }).first().selectOption('select');
  await expect(page.getByText(/needs at least one option/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Save form/ })).toBeDisabled();

  await page.locator('textarea').last().fill('Google\nA friend');
  await expect(page.getByText(/needs at least one option/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save form/ })).toBeEnabled();

  // Discard puts the draft back to exactly what the server has.
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('3 sections · 4 questions')).toBeVisible();
  await expect(page.getByText('in sync with the live form')).toBeVisible();
});

test('SOAP wizard keeps every step\'s input while navigating', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: /Client Profile/ }).click();
  await page.getByRole('button', { name: /Jenna Black/ }).click();
  await page.getByRole('button', { name: /New session note/ }).click();

  // Step 1 — narrative.
  await expect(page.getByRole('heading', { name: /Narrative \(1\/4\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'type' }).first().click();   // NoteField hides the textarea until you ask for it
  await page.locator('textarea').first().fill('Left shoulder ache since Friday.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 2 — findings. Step 1's fields are gone from the DOM…
  await expect(page.getByRole('heading', { name: /Findings \(2\/4\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deep tissue' })).toBeVisible();
  await page.getByRole('button', { name: 'Deep tissue' }).click();

  // Step 4 — the summary recap reflects what earlier steps captured.
  await page.getByRole('button', { name: '4 Summary' }).click();
  await expect(page.getByText(/Deep tissue/)).toBeVisible();
  await expect(page.getByText(/1 area charted: Back/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save note/ })).toBeVisible();

  // …and going back proves the state was hoisted, not lost with the unmount.
  await page.getByRole('button', { name: '1 Narrative' }).click();
  await expect(page.locator('textarea').first()).toHaveValue('Left shoulder ache since Friday.');
});

test('body chart marker stamps a finding and Undo reverts it', async ({ page }) => {
  await openConsole(page);
  await page.getByRole('button', { name: /Client Profile/ }).click();
  await page.getByRole('button', { name: /Jenna Black/ }).click();
  await page.getByRole('button', { name: /New session note/ }).click();

  // The note is a 4-step wizard now; the body chart is step 3.
  await page.getByRole('button', { name: '3 Body Chart' }).click();

  const findings = page.locator('input[placeholder^="findings"]');
  await expect(findings).toHaveCount(1);            // "Back" carried forward from the last note

  await page.getByRole('button', { name: /Knot/ }).first().click();
  await expect(page.getByText(/marking .Knot./)).toBeVisible();
  await page.locator('button[title^="Neck"]').first().click();

  await expect(findings).toHaveCount(2);
  await expect(findings.filter({ has: page.locator(':scope') })).toBeTruthy();
  expect(await findings.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(expect.arrayContaining([expect.stringMatching(/Knotted/)]));

  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(findings).toHaveCount(1);

  // Focus toggle collapses the two figures down to one.
  await expect(page.locator('img[alt*="of the body"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'front', exact: true }).click();
  await expect(page.locator('img[alt*="of the body"]')).toHaveCount(1);
});
