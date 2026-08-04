# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-fake-provider.spec.ts >> provider picker switches built-in and custom providers
- Location: e2e/dashboard-fake-provider.spec.ts:139:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Agent provider')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Agent provider')

```

```yaml
- complementary:
  - button "Collapse sidebar" [expanded]: Collapse nav
  - button "ClaudeClaw"
  - button "🖍 Flag Issue"
  - button "Search CtrlK"
  - navigation "Primary navigation":
    - text: Sections
    - button "Workspace"
    - button "Trade Desk"
    - button "Studio"
    - button "Intelligence"
    - button "Collaborate"
    - button "Massage"
    - button "MC Apps"
    - button "Mission Control"
    - button "System" [pressed]
  - button "Runtime OpenCode"
- main:
  - heading "Settings" [level=1]
  - heading "Workspace" [level=2]
  - paragraph: Identity for this dashboard. Stored in the database so it shows up in any browser pointed at this server.
  - text: Name Up to 32 characters. Empty resets to ClaudeClaw.
  - textbox "ClaudeClaw"
  - text: Theme Switches CSS variables across the app.
  - button "Graphite"
  - button "Midnight"
  - button "Crimson"
  - text: Custom accent Override the theme's accent with any hex. Reset clears it.
  - textbox: "#8b8af0"
  - textbox "#8b8af0": "#"
  - heading "Display" [level=2]
  - paragraph: Per-browser display preferences. Stored in localStorage, not per-workspace.
  - text: UI scale Zooms the whole app proportionally so layout stays correct.
  - button "95%"
  - button "100%"
  - button "110%"
  - button "125%"
  - button "150%"
  - text: Desktop view Force the full desktop layout on phones (like Request Desktop Site). Reloads the page. No effect in desktop browsers.
  - switch "Desktop view"
  - text: Show costs Hide if you're on a Claude Code subscription — costs only matter on the API path.
  - switch "Show costs"
  - heading "Keyboard" [level=2]
  - paragraph: Pick which modifier opens the command palette and quick-jump search.
  - text: Search shortcut Auto matches your platform — pick a value to override.
  - button "Auto"
  - button "⌘ Cmd / Meta"
  - button "Ctrl"
  - heading "Kill switches" [level=2]
  - paragraph: Runtime feature gates. Toggling writes the flag to .env atomically; the runtime re-reads it within 1.5s so changes take effect without a restart.
  - text: Text War Room
  - code: WARROOM_TEXT_ENABLED
  - text: Allow multi-agent text meetings via /api/warroom/text/*
  - switch "Text War Room" [checked]
  - text: Voice War Room
  - code: WARROOM_VOICE_ENABLED
  - text: Allow voice meetings via Pipecat
  - switch "Voice War Room" [checked]
  - text: LLM spawn
  - code: LLM_SPAWN_ENABLED
  - text: Allow Claude SDK calls (master switch)
  - switch "LLM spawn" [checked]
  - text: Dashboard mutations
  - code: DASHBOARD_MUTATIONS_ENABLED
  - text: Allow non-GET requests (set to false to lock dashboard read-only)
  - switch "Dashboard mutations" [checked]
  - text: Mission auto-assign
  - code: MISSION_AUTO_ASSIGN_ENABLED
  - text: Allow Haiku/Gemini classifier on /api/mission/tasks/auto-assign
  - switch "Mission auto-assign" [checked]
  - text: Scheduler
  - code: SCHEDULER_ENABLED
  - text: Allow scheduled cron tasks to fire
  - switch "Scheduler" [checked]
  - heading "Read-only" [level=2]
  - paragraph: System limits and bundled assets.
  - text: Context window 12% used
  - heading "Acknowledgements" [level=2]
  - text: 3D brain model Detailed Human Brain Model, NIH 3D 3DPX-021161, CC-BY
```

# Test source

```ts
  42  |     const json = (body: unknown, status = 200) => route.fulfill({
  43  |       status,
  44  |       contentType: 'application/json',
  45  |       body: JSON.stringify(body),
  46  |     });
  47  | 
  48  |     if (path === '/api/health') {
  49  |       return json({
  50  |         contextPct: 12,
  51  |         turns: 4,
  52  |         model: provider.model || (provider.type === 'claude' ? 'claude-opus-4-6' : provider.type === 'codex' ? 'gpt-5.5' : provider.type),
  53  |         provider,
  54  |         providerType: provider.type,
  55  |         runtime: provider.type === 'acp' ? `${provider.command} ${(provider.args || []).join(' ')}`.trim() : provider.type,
  56  |         killSwitches: {
  57  |           WARROOM_TEXT_ENABLED: true,
  58  |           WARROOM_VOICE_ENABLED: true,
  59  |           LLM_SPAWN_ENABLED: true,
  60  |           DASHBOARD_MUTATIONS_ENABLED: true,
  61  |           MISSION_AUTO_ASSIGN_ENABLED: true,
  62  |           SCHEDULER_ENABLED: true,
  63  |         },
  64  |         killSwitchRefusals: {},
  65  |       });
  66  |     }
  67  |     if (path === '/api/provider/status') {
  68  |       return json({
  69  |         provider,
  70  |         providerType: provider.type,
  71  |         label: provider.type === 'claude' ? 'Claude' : provider.type === 'opencode' ? 'OpenCode' : provider.type === 'gemini' ? 'Gemini' : provider.type === 'codex' ? 'Codex' : 'ACP',
  72  |         runtime: provider.type === 'acp' ? `${provider.command} ${(provider.args || []).join(' ')}`.trim() : provider.type,
  73  |         model: provider.model || (provider.type === 'claude' ? 'claude-opus-4-6' : provider.type === 'codex' ? 'gpt-5.5' : provider.type === 'gemini' ? 'Gemini CLI default' : 'OpenCode default'),
  74  |       });
  75  |     }
  76  |     if (path === '/api/security/status') return json({});
  77  |     if (path === '/api/agents') {
  78  |       return json({
  79  |         agents: [
  80  |           { id: 'main', name: 'Main', description: '', model: 'fake-model', running: true, todayTurns: 2, todayCost: 0, provider },
  81  |         ],
  82  |       });
  83  |     }
  84  |     if (path === '/api/chat/history') return json({ turns: [] });
  85  |     if (path === '/api/agents/main/tokens') return json({ todayCost: 0, todayTurns: 0, allTimeCost: 0 });
  86  |     if (path === '/api/providers/models') {
  87  |       const selected = url.searchParams.get('provider') || 'opencode';
  88  |       return json({
  89  |         provider: selected,
  90  |         models: selected === 'codex'
  91  |           ? [{ id: 'gpt-5.5', label: 'GPT-5.5' }, { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' }]
  92  |           : selected === 'claude'
  93  |             ? [{ id: 'claude-opus-4-6', label: 'Opus 4.6' }]
  94  |             : [{ id: selected + '-default', label: selected + ' default' }],
  95  |         defaultModel: selected === 'codex' ? 'gpt-5.5' : selected + '-default',
  96  |         selectable: true,
  97  |         allowCustom: true,
  98  |       });
  99  |     }
  100 |     if (path === '/api/providers/runtime-options') {
  101 |       const selected = url.searchParams.get('provider') || 'opencode';
  102 |       return json({
  103 |         provider: selected,
  104 |         source: selected === 'claude' ? 'static' : 'provider',
  105 |         modeOptions: selected === 'codex'
  106 |           ? []
  107 |           : [{ id: 'fast', label: 'Fast' }, { id: 'normal', label: 'Normal' }, { id: 'deep', label: 'Deep' }],
  108 |         thinkingOptions: selected === 'codex'
  109 |           ? [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra high' }]
  110 |           : [{ id: 'auto', label: 'Auto' }, { id: 'off', label: 'Off' }, { id: 'on', label: 'On' }],
  111 |       });
  112 |     }
  113 |     if (path === '/api/agents/main/provider' && req.method() === 'PATCH') {
  114 |       const body = JSON.parse(req.postData() || '{}');
  115 |       provider = body.provider;
  116 |       return json({ ok: true, agent: 'main', provider, restartRequired: false });
  117 |     }
  118 |     if (path === '/api/chat/send' && req.method() === 'POST') {
  119 |       processing = true;
  120 |       return json({ ok: true });
  121 |     }
  122 |     if (path === '/api/chat/abort' && req.method() === 'POST') {
  123 |       aborts += 1;
  124 |       processing = false;
  125 |       await page.evaluate(() => {
  126 |         (window as any).__emitSse('processing', { processing: false });
  127 |       });
  128 |       return json({ ok: true, aborted: true, aborts });
  129 |     }
  130 | 
  131 |     return json({ ok: true, processing });
  132 |   });
  133 | }
  134 | 
  135 | test.beforeEach(async ({ page }) => {
  136 |   await installFakeDashboard(page);
  137 | });
  138 | 
  139 | test('provider picker switches built-in and custom providers', async ({ page }) => {
  140 |   await page.goto('/settings?token=test&chatId=e2e');
  141 | 
> 142 |   await expect(page.getByText('Agent provider')).toBeVisible();
      |                                                  ^ Error: expect(locator).toBeVisible() failed
  143 |   const picker = page.getByLabel('Provider', { exact: true });
  144 | 
  145 |   for (const provider of ['claude', 'opencode', 'gemini', 'codex'] as ProviderType[]) {
  146 |     await picker.selectOption(provider);
  147 |     if (provider === 'codex') {
  148 |       await page.getByLabel('Model').selectOption('gpt-5.5');
  149 |       await expect(page.getByRole('button', { name: 'Extra high' })).toBeVisible();
  150 |       await page.getByRole('button', { name: 'Extra high' }).click();
  151 |     }
  152 |     await page.getByRole('button', { name: /save provider/i }).click();
  153 |     await expect(page.getByText('Provider saved').first()).toBeVisible();
  154 |   }
  155 | 
  156 |   await page.goto('/chat?token=test&chatId=e2e');
  157 |   await expect(page.getByRole('main').getByText('gpt-5.5')).toBeVisible();
  158 | 
  159 |   await page.goto('/settings?token=test&chatId=e2e');
  160 |   const customPicker = page.getByLabel('Provider', { exact: true });
  161 |   await customPicker.selectOption('acp');
  162 |   await page.getByPlaceholder('my-acp-agent').fill('fake-acp');
  163 |   await page.getByPlaceholder('--acp').fill('--stdio --verbose');
  164 |   await page.getByRole('button', { name: /save provider/i }).click();
  165 |   await expect(page.getByText('Provider saved').first()).toBeVisible();
  166 | });
  167 | 
  168 | test('dashboard status shows active provider and model in chat', async ({ page }) => {
  169 |   await page.goto('/chat?token=test&chatId=e2e');
  170 | 
  171 |   await expect(page.getByText('Stream live')).toBeVisible();
  172 |   await expect(page.getByRole('main').getByText('Model')).toBeVisible();
  173 |   await expect(page.getByRole('main').getByText('opencode')).toBeVisible();
  174 | 
  175 |   await page.getByLabel('Switch main provider').selectOption('codex');
  176 |   await expect(page.getByText('Provider set to Codex')).toBeVisible();
  177 |   await expect(page.getByText('Runtime').locator('..').getByText('Codex')).toBeVisible();
  178 |   await expect(page.getByRole('main').getByText('gpt-5.5')).toBeVisible();
  179 | });
  180 | 
  181 | test('chat sends a message, renders progress, streamed text, and keeps text selectable', async ({ page }) => {
  182 |   await page.goto('/chat?token=test&chatId=e2e');
  183 | 
  184 |   await page.getByPlaceholder('Type a message. Shift+Enter for newline.').fill('use the fake provider');
  185 |   await page.getByRole('button', { name: /send/i }).click();
  186 |   await page.evaluate(() => {
  187 |     (window as any).__emitSse('user_message', { content: 'use the fake provider', source: 'dashboard' });
  188 |     (window as any).__emitSse('processing', { processing: true });
  189 |     (window as any).__emitSse('progress', {
  190 |       description: 'Inspect fake plan',
  191 |       progressKind: 'plan',
  192 |       status: 'in_progress',
  193 |       planEntries: [{ content: 'Inspect fake plan', status: 'in_progress', priority: 'high' }],
  194 |       timestamp: Date.now(),
  195 |     });
  196 |     (window as any).__emitSse('progress', {
  197 |       description: 'Running fake tool',
  198 |       progressKind: 'tool_active',
  199 |       status: 'pending',
  200 |       toolCallId: 'tool-1',
  201 |       locations: [{ path: 'README.md', line: 12 }],
  202 |       timestamp: Date.now(),
  203 |     });
  204 |   });
  205 | 
  206 |   await expect(page.getByText('Inspect fake plan')).toBeVisible();
  207 |   await expect(page.getByText('Running fake tool').first()).toBeVisible();
  208 |   await expect(page.getByText('README.md:12')).toBeVisible();
  209 | 
  210 |   await page.evaluate(() => {
  211 |     (window as any).__emitSse('assistant_message', {
  212 |       content: 'Fake streamed provider reply with selectable text.',
  213 |       source: 'dashboard',
  214 |     });
  215 |     (window as any).__emitSse('processing', { processing: false });
  216 |   });
  217 |   const reply = page.getByText('Fake streamed provider reply with selectable text.');
  218 |   await expect(reply).toBeVisible();
  219 | 
  220 |   const selectable = await reply.evaluate((node) => getComputedStyle(node.closest('.select-text') || node).userSelect);
  221 |   expect(selectable).toBe('text');
  222 | });
  223 | 
  224 | test('provider tool progress renders once per tool id', async ({ page }) => {
  225 |   await page.goto('/chat?token=test&chatId=e2e');
  226 | 
  227 |   await page.getByPlaceholder('Type a message. Shift+Enter for newline.').fill('dedupe fake tool progress');
  228 |   await page.getByRole('button', { name: /send/i }).click();
  229 |   await page.evaluate(() => {
  230 |     (window as any).__emitSse('user_message', { content: 'dedupe fake tool progress', source: 'dashboard' });
  231 |     (window as any).__emitSse('processing', { processing: true });
  232 |     (window as any).__emitSse('progress', {
  233 |       description: 'Running fake tool',
  234 |       progressKind: 'tool_active',
  235 |       status: 'pending',
  236 |       toolCallId: 'tool-dedupe',
  237 |       locations: [{ path: 'README.md', line: 12 }],
  238 |       timestamp: Date.now(),
  239 |     });
  240 |     (window as any).__emitSse('progress', {
  241 |       description: 'Running fake tool',
  242 |       progressKind: 'tool_active',
```