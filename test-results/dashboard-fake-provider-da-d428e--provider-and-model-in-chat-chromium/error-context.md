# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard-fake-provider.spec.ts >> dashboard status shows active provider and model in chat
- Location: e2e/dashboard-fake-provider.spec.ts:168:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Switch main provider')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e5]:
    - button "Collapse sidebar" [expanded] [ref=e7] [cursor=pointer]:
      - img [ref=e8]
      - generic [ref=e11]: Collapse nav
    - button "ClaudeClaw" [ref=e13] [cursor=pointer]:
      - generic [ref=e15]: ClaudeClaw
      - img [ref=e16]
    - button "🖍 Flag Issue" [ref=e18] [cursor=pointer]:
      - generic [ref=e19]: 🖍
      - generic [ref=e20]: Flag Issue
    - button "Search CtrlK" [ref=e22] [cursor=pointer]:
      - img [ref=e23]
      - generic [ref=e26]: Search
      - generic [ref=e27]: CtrlK
    - navigation "Primary navigation" [ref=e28]:
      - generic [ref=e29]: Sections
      - button "Workspace" [pressed] [ref=e30] [cursor=pointer]:
        - img [ref=e31]
        - generic [ref=e36]: Workspace
        - img [ref=e38]
      - button "Trade Desk" [ref=e40] [cursor=pointer]:
        - img [ref=e41]
        - generic [ref=e46]: Trade Desk
        - img [ref=e47]
      - button "Studio" [ref=e49] [cursor=pointer]:
        - img [ref=e50]
        - generic [ref=e53]: Studio
        - img [ref=e54]
      - button "Intelligence" [ref=e56] [cursor=pointer]:
        - img [ref=e57]
        - generic [ref=e65]: Intelligence
        - img [ref=e66]
      - button "Collaborate" [ref=e68] [cursor=pointer]:
        - img [ref=e69]
        - generic [ref=e78]: Collaborate
        - img [ref=e79]
      - button "Massage" [ref=e81] [cursor=pointer]:
        - img [ref=e82]
        - generic [ref=e85]: Massage
        - img [ref=e86]
      - button "MC Apps" [ref=e88] [cursor=pointer]:
        - img [ref=e89]
        - generic [ref=e91]: MC Apps
        - img [ref=e92]
      - button "Mission Control" [ref=e94] [cursor=pointer]:
        - img [ref=e95]
        - generic [ref=e98]: Mission Control
        - img [ref=e99]
      - button "System" [ref=e101] [cursor=pointer]:
        - img [ref=e102]
        - generic [ref=e104]: System
        - img [ref=e105]
    - button "Runtime OpenCode" [ref=e108] [cursor=pointer]:
      - img [ref=e109]
      - generic [ref=e111]: Runtime
      - generic [ref=e112]: OpenCode
  - main [ref=e113]:
    - generic [ref=e114]:
      - generic [ref=e115]:
        - generic [ref=e116]:
          - heading "Chat" [level=1] [ref=e117]
          - generic [ref=e119]: Stream live
        - generic [ref=e121]:
          - button "All" [ref=e122] [cursor=pointer]
          - button "Main" [ref=e123] [cursor=pointer]: Main
      - generic [ref=e125]:
        - 'generic "Used: - (12%) · Left: - · Window: - · Context updated: - · Health refreshed: -" [ref=e126]':
          - generic [ref=e127]: Ctx
          - generic [ref=e128]: 12% used
        - generic [ref=e131]: Turns today 2
        - generic [ref=e132]: Model opencode
      - generic [ref=e135]:
        - generic [ref=e136]: No messages yet
        - generic [ref=e137]: Type below to talk to your agent. Replies stream in via SSE.
      - generic [ref=e139]:
        - generic [ref=e140]:
          - button "Status update" [ref=e141] [cursor=pointer]
          - button "What's next" [ref=e142] [cursor=pointer]
          - button "Plan today" [ref=e143] [cursor=pointer]
          - button "Recent wins" [ref=e144] [cursor=pointer]
          - button "/nano-banana" [ref=e145] [cursor=pointer]
          - button "/nano-banana-pro" [ref=e146] [cursor=pointer]
        - generic [ref=e147]:
          - textbox "Type a message. Shift+Enter for newline." [ref=e148]
          - button "Send" [disabled] [ref=e149] [cursor=pointer]:
            - img [ref=e150]
            - text: Send
```

# Test source

```ts
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
  142 |   await expect(page.getByText('Agent provider')).toBeVisible();
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
> 175 |   await page.getByLabel('Switch main provider').selectOption('codex');
      |                                                 ^ Error: locator.selectOption: Test timeout of 30000ms exceeded.
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
  243 |       status: 'pending',
  244 |       toolCallId: 'tool-dedupe',
  245 |       locations: [{ path: 'README.md', line: 12 }],
  246 |       timestamp: Date.now() + 1,
  247 |     });
  248 |   });
  249 | 
  250 |   await expect(page.getByText('Running fake tool')).toHaveCount(2);
  251 |   await expect(page.getByText('README.md:12')).toHaveCount(1);
  252 | });
  253 | 
  254 | test('stop button aborts an active fake-provider turn', async ({ page }) => {
  255 |   await page.goto('/chat?token=test&chatId=e2e');
  256 | 
  257 |   await page.evaluate(() => {
  258 |     (window as any).__emitSse('processing', { processing: true });
  259 |   });
  260 |   await page.getByRole('button', { name: /stop/i }).click();
  261 |   await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
  262 | });
  263 | 
```