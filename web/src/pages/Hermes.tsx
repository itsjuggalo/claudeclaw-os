// Hermes Workspace — operator console for the live WSL Hermes agent (~/.hermes).
// Tabbed like the Hermes desktop app: Overview / Sessions / Skills / Toolsets /
// Cron / Gateway / Config / Chat. Reads the shared /api/hermes payload; write
// actions (send, restart, one-shot) are allowlisted. Cron is READ-ONLY (live trading jobs).
import { useState, useEffect, useRef } from 'preact/hooks';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { useFetch } from '@/lib/useFetch';
import { apiPost } from '@/lib/api';

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const GREEN = '#66bb6a';
const RED = '#ef5350';
const BLUE = '#4fc3f7';
const AMBER = '#ffa726';
const PURPLE = '#ce93d8';
const MUTED = '#607d8b';
const CARD_BG = 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)';
const CARD_BORDER = '#1a3a4a';

interface GatewayStatus { running: boolean; pid: number | null; gateway_state: string; platforms: Record<string, { state: string; error_message: string | null }>; active_agents: number; uptime_secs: number | null; }
interface Session { session_key: string; display_name: string; platform: string; chat_type: string; updated_at: string; estimated_cost_usd: number; suspended: boolean; model: string; message_count: number; tool_call_count: number; }
interface Skill { name: string; description: string; category: string; source: string; }
interface Cron { name: string; schedule: string; prompt: string; enabled: boolean; }
interface Toolset { name: string; enabled: boolean; scope: string; }
interface ConfigRedacted { model: string; provider: string; fallback: string[]; toolsets: string[]; web_search: string; cwd: string; version: string; home: string; }
interface HermesData {
  gateway: GatewayStatus; sessions: Session[]; skills: Skill[]; skills_raw_count: number;
  crons: Cron[]; toolsets: Toolset[]; recent_logs: string[]; model: string; provider: string;
  version: string; config: ConfigRedacted; config_ok: boolean;
}

type Tab = 'overview' | 'sessions' | 'skills' | 'toolsets' | 'cron' | 'gateway' | 'config' | 'chat';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'skills', label: 'Skills' },
  { id: 'toolsets', label: 'Toolsets' },
  { id: 'cron', label: 'Cron' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'config', label: 'Config' },
  { id: 'chat', label: 'Chat' },
];

function fmtUptime(secs: number | null): string {
  if (secs === null || secs < 0) return '—';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  if (secs < 86400) { const h = Math.floor(secs / 3600); const m = Math.floor((secs % 3600) / 60); return h + 'h ' + m + 'm'; }
  const d = Math.floor(secs / 86400); const h = Math.floor((secs % 86400) / 3600); return d + 'd ' + h + 'h';
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = Date.now();
    const sameDay = new Date().toDateString() === d.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : (now - d.getTime() < 7 * 864e5
          ? d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  } catch { return iso; }
}

function logColor(line: string): string {
  if (line.includes('ERROR') || line.includes('error')) return RED;
  if (line.includes('WARNING') || line.includes('warn')) return AMBER;
  if (line.includes('✓') || line.includes('connected') || line.includes('running')) return GREEN;
  if (line.includes('inbound message') || line.includes('response ready')) return BLUE;
  return '#b0bec5';
}

export function Hermes() {
  const { data, loading, error } = useFetch<HermesData>('/api/hermes', 15_000);

  const [tab, setTab] = useState<Tab>('overview');
  const [skillFilter, setSkillFilter] = useState('');
  const [skillCategory, setSkillCategory] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('');
  const [logExpanded, setLogExpanded] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatOut, setChatOut] = useState<{ ok: boolean; output: string; message: string } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const sendRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (sendStatus) { const t = setTimeout(() => setSendStatus(null), 4000); return () => clearTimeout(t); } }, [sendStatus]);

  if (error) return <div class="flex flex-col h-full"><PageHeader title="Hermes Workspace" /><PageState error={error} /></div>;
  if (loading && !data) return <div class="flex flex-col h-full"><PageHeader title="Hermes Workspace" /><PageState loading /></div>;
  if (!data) return <div class="flex flex-col h-full"><PageHeader title="Hermes Workspace" /><PageState empty emptyTitle="No Hermes data" /></div>;

  const { gateway, sessions, skills, skills_raw_count, crons, toolsets, recent_logs, model, provider, version, config } = data;
  const gwOnline = gateway.running;
  const gwColor = gwOnline ? GREEN : RED;
  const telegramState = gateway.platforms.telegram?.state || 'not connected';
  const discordState = gateway.platforms.discord?.state || 'not configured';
  const telegramReady = telegramState === 'connected';
  const discordReady = discordState === 'connected';

  const categories = ['all', ...Array.from(new Set(skills.map(s => s.category || 'misc').filter(Boolean))).sort()];
  const filteredSkills = skills.filter(s => {
    const matchCat = skillCategory === 'all' || s.category === skillCategory;
    const matchQ = !skillFilter || s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.description.toLowerCase().includes(skillFilter.toLowerCase());
    return matchCat && matchQ;
  });
  const filteredSessions = sessions.filter(s =>
    !sessionFilter || s.display_name.toLowerCase().includes(sessionFilter.toLowerCase()) || s.platform.toLowerCase().includes(sessionFilter.toLowerCase()));

  const handleSend = async () => {
    if (!sendMsg.trim()) return;
    setSending(true);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/api/hermes/send', { message: sendMsg.trim() });
      setSendStatus({ ok: res.ok, msg: res.message });
      if (res.ok) setSendMsg('');
    } catch (e) { setSendStatus({ ok: false, msg: String(e) }); }
    setSending(false);
  };

  const handleRestart = async () => {
    if (!confirm('Restart the Hermes gateway? This bounces Telegram and interrupts any in-flight agent or cron job.')) return;
    setRestarting(true);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/api/hermes/restart', {});
      setSendStatus({ ok: res.ok, msg: res.message });
    } catch (e) { setSendStatus({ ok: false, msg: String(e) }); }
    setRestarting(false);
  };

  const handleChat = async () => {
    if (!chatPrompt.trim()) return;
    setChatBusy(true); setChatOut(null);
    try {
      const res = await apiPost<{ ok: boolean; output: string; message: string }>('/api/hermes/oneshot', { prompt: chatPrompt.trim() });
      setChatOut(res);
    } catch (e) { setChatOut({ ok: false, output: '', message: String(e) }); }
    setChatBusy(false);
  };

  const displayedLogs = logExpanded ? recent_logs : recent_logs.slice(-12);

  const GatewayLog = (
    <Section title="GATEWAY LOG" accent={MUTED} count={recent_logs.length}>
      <div style={{ background: '#060d14', borderRadius: '6px', border: '1px solid ' + CARD_BORDER, padding: '12px', fontFamily: MONO }}>
        <div style={{ maxHeight: logExpanded ? '500px' : '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {displayedLogs.length === 0 ? (
            <div style={{ fontSize: '11px', color: MUTED }}>No log lines yet.</div>
          ) : displayedLogs.map((line, i) => {
            const m = line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+ \w+ (.+)$/);
            const short = m ? m[1] : line;
            const ts = line.slice(0, 19);
            return (
              <div key={i} style={{ fontSize: '10px', lineHeight: '1.5', display: 'flex', gap: '8px' }}>
                <span style={{ color: '#37474f', whiteSpace: 'nowrap', flexShrink: 0 }}>{ts.slice(11)}</span>
                <span style={{ color: logColor(line), wordBreak: 'break-all' }}>{short}</span>
              </div>
            );
          })}
        </div>
        <button onClick={() => setLogExpanded(x => !x)} style={{
          marginTop: '8px', width: '100%', padding: '5px', background: 'transparent',
          border: '1px dashed #1a2332', borderRadius: '3px', color: BLUE, fontSize: '10px', cursor: 'pointer', fontFamily: MONO,
        }}>
          {logExpanded ? '▾ Collapse' : '▸ Show More (' + recent_logs.length + ' lines)'}
        </button>
      </div>
    </Section>
  );

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Hermes Workspace" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>

          {/* ── PERSISTENT STATUS BAR ───────────────────────────── */}
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{
            padding: '20px 24px', background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)',
            border: '1px solid ' + CARD_BORDER, borderRadius: '10px',
          }}>
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>GATEWAY</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: gwColor, boxShadow: gwOnline ? '0 0 8px ' + gwColor : 'none' }} />
                <span style={{ fontSize: '18px', fontWeight: 800, color: gwColor, fontFamily: MONO }}>{gwOnline ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              {gateway.pid && <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>PID {gateway.pid}{version ? ' · v' + version : ''}</div>}
            </div>
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>UPTIME</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#e0e0e0', fontFamily: MONO }}>{fmtUptime(gateway.uptime_secs)}</div>
              <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>{gateway.active_agents} active agent{gateway.active_agents !== 1 ? 's' : ''}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>MODEL</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: BLUE, fontFamily: MONO, wordBreak: 'break-all' }}>{model}</div>
              <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>{provider} · {skills.length} skills · {sessions.length} sessions</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>PLATFORMS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {Object.entries(gateway.platforms).map(([name, p]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: p.state === 'connected' ? GREEN : RED }} />
                    <span style={{ fontSize: '11px', color: '#e0e0e0', fontFamily: MONO, textTransform: 'capitalize' }}>{name}</span>
                    <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>({p.state})</span>
                  </div>
                ))}
                {!gateway.platforms.discord && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: MUTED }} />
                    <span style={{ fontSize: '11px', color: '#e0e0e0', fontFamily: MONO }}>Discord</span>
                    <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>(not configured)</span>
                  </div>
                )}
                {Object.keys(gateway.platforms).length === 0 && <div style={{ fontSize: '11px', color: MUTED, fontFamily: MONO }}>No connected platforms</div>}
              </div>
            </div>
          </div>

          {/* ── HERMES SECONDARY RAIL — page-local, no global sidebar edits ── */}
          <div class="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3" style={{ alignItems: 'stretch' }}>
            <div style={{ background: '#07111a', border: '1px solid ' + CARD_BORDER, borderRadius: '10px', padding: '12px', fontFamily: MONO }}>
              <div style={{ fontSize: '10px', color: BLUE, letterSpacing: '2px', fontWeight: 800, marginBottom: '10px' }}>HERMES RAIL</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
                {TABS.map(t => (
                  <button key={'rail-' + t.id} onClick={() => setTab(t.id)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    padding: '8px 10px', borderRadius: '6px', border: '1px solid ' + (tab === t.id ? BLUE + '66' : '#102332'),
                    background: tab === t.id ? '#0f2436' : '#091722', color: tab === t.id ? BLUE : '#90a4ae',
                    fontFamily: MONO, fontSize: '11px', fontWeight: 800, cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span>{t.label}</span><span style={{ opacity: 0.6 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background: '#07111a', border: '1px solid ' + CARD_BORDER, borderRadius: '10px', padding: '12px 14px', fontFamily: MONO, display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '10px', color: GREEN, letterSpacing: '2px', fontWeight: 800, marginBottom: '4px' }}>LIVE WORKSPACE</div>
                  <div style={{ fontSize: '12px', color: '#c5e1e8' }}>{config.home}</div>
                  <div style={{ fontSize: '10px', color: MUTED, marginTop: '3px' }}>Page-local Hermes nav. I did not touch the global ClaudeClaw sidebar.</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <ChannelPill label="Telegram" state={telegramState} ready={telegramReady} />
                  <ChannelPill label="Discord" state={discordState} ready={discordReady} />
                  <Badge label="one-shot dashboard chat" color={AMBER} />
                </div>
              </div>
              {!discordReady && (
                <div style={{ fontSize: '10px', color: AMBER, borderTop: '1px solid #102332', paddingTop: '8px' }}>
                  Discord is not connected in the live Hermes gateway payload. I can help wire it up, but that changes gateway config/credentials and needs your approval.
                </div>
              )}
            </div>
          </div>

          {/* ── TAB BAR (horizontal scroll on mobile) ───────────── */}
          <div class="flex lg:hidden" style={{ gap: '6px', overflowX: 'auto', paddingBottom: '2px', borderBottom: '1px solid ' + CARD_BORDER }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0', fontFamily: MONO, fontSize: '12px',
                fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                background: tab === t.id ? '#0f2436' : 'transparent',
                color: tab === t.id ? BLUE : '#90a4ae',
                borderBottom: tab === t.id ? '2px solid ' + BLUE : '2px solid transparent',
              }}>{t.label}</button>
            ))}
          </div>

          {/* ── OVERVIEW ─────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Section title="AT A GLANCE" accent={GREEN}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: MONO, fontSize: '12px' }}>
                    <Row k="Version" v={'v' + (version || '?')} />
                    <Row k="Model" v={model} vColor={BLUE} />
                    <Row k="Provider" v={provider} />
                    <Row k="Skills (base)" v={String(skills.length)} />
                    <Row k="Toolsets" v={toolsets.map(t => t.name).join(', ') || '—'} />
                    <Row k="Cron jobs" v={String(crons.length)} />
                    <Row k="Sessions" v={String(sessions.length)} />
                    <Row k="Workspace" v={config.home} />
                  </div>
                </Section>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>{GatewayLog}</div>
            </div>
          )}

          {/* ── SESSIONS ─────────────────────────────────────────── */}
          {tab === 'sessions' && (
            <Section title="SESSIONS" accent={GREEN} count={sessions.length}>
              <input type="text" value={sessionFilter} onInput={(e) => setSessionFilter((e.target as HTMLInputElement).value)}
                placeholder="Search sessions…" style={inputStyle} />
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredSessions.length === 0 ? <EmptyState label="No sessions" /> : filteredSessions.map((s, i) => (
                  <div key={i} style={{ padding: '10px 12px', background: '#0d1117', borderRadius: '6px', border: '1px solid ' + CARD_BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.display_name}</div>
                      <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, marginTop: '2px' }}>{s.platform}{s.model ? ' · ' + s.model : ''} · {s.message_count} msg{s.tool_call_count ? ' · ' + s.tool_call_count + ' tools' : ''} · {fmtTime(s.updated_at)}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                      {s.suspended && <Badge label="LIVE" color={AMBER} />}
                      {s.estimated_cost_usd > 0 && <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>${s.estimated_cost_usd.toFixed(4)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── SKILLS ───────────────────────────────────────────── */}
          {tab === 'skills' && (
            <Section title="SKILLS" accent={PURPLE} count={skills.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" value={skillFilter} onInput={(e) => setSkillFilter((e.target as HTMLInputElement).value)}
                  placeholder="Search skills…" style={inputStyle} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setSkillCategory(cat)} style={{
                      padding: '3px 10px', borderRadius: '3px', fontFamily: MONO, fontSize: '9px', fontWeight: 700,
                      letterSpacing: '0.5px', cursor: 'pointer', border: 'none',
                      background: skillCategory === cat ? PURPLE : '#1a2332',
                      color: skillCategory === cat ? '#0d1117' : '#90a4ae',
                    }}>{cat === 'all' ? 'ALL' : cat.toUpperCase()}</button>
                  ))}
                </div>
                <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>
                  Showing {skills.length} base skills{skills_raw_count > skills.length ? ` · ${skills_raw_count - skills.length} archived/dup hidden` : ''}
                </div>
                <div style={{ maxHeight: '460px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {filteredSkills.length === 0 ? <EmptyState label="No skills match" /> : filteredSkills.map((s, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: '#0d1117', borderRadius: '5px', border: '1px solid ' + CARD_BORDER, borderLeft: '3px solid ' + PURPLE }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{s.name}</span>
                        <span style={{ fontSize: '9px', color: MUTED, fontFamily: MONO, whiteSpace: 'nowrap' }}>{s.category}</span>
                      </div>
                      {s.description && <div style={{ fontSize: '10px', color: '#90a4ae', fontFamily: MONO, marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.description}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* ── TOOLSETS ─────────────────────────────────────────── */}
          {tab === 'toolsets' && (
            <Section title="TOOLSETS" accent={BLUE} count={toolsets.length}>
              {toolsets.length === 0 ? <EmptyState label="No toolsets configured" /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {toolsets.map((t, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: '#0d1117', borderRadius: '6px', border: '1px solid ' + CARD_BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{t.name}</span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <Badge label={t.scope} color={MUTED} />
                        <Badge label={t.enabled ? 'ON' : 'OFF'} color={t.enabled ? GREEN : MUTED} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── CRON (read-only) ─────────────────────────────────── */}
          {tab === 'cron' && (
            <Section title="CRON JOBS · READ-ONLY" accent={AMBER} count={crons.length}>
              <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, marginBottom: '10px' }}>
                Live trading jobs — managed via the Hermes CLI, not editable here.
              </div>
              {crons.length === 0 ? <EmptyState label="No scheduled jobs" /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {crons.map((c, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: '#0d1117', borderRadius: '6px', border: '1px solid ' + CARD_BORDER }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{c.name}</span>
                        <Badge label={c.enabled ? 'ON' : 'OFF'} color={c.enabled ? GREEN : MUTED} />
                      </div>
                      <div style={{ fontSize: '10px', color: BLUE, fontFamily: MONO, marginBottom: '3px' }}>{c.schedule}</div>
                      <div style={{ fontSize: '11px', color: '#90a4ae', fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.prompt}</div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── GATEWAY (log + send + restart) ───────────────────── */}
          {tab === 'gateway' && (
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Section title="SEND TO TELEGRAM" accent={BLUE}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <textarea ref={sendRef} value={sendMsg}
                      onInput={(e) => setSendMsg((e.target as HTMLTextAreaElement).value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); }}
                      placeholder="Type a message… (Ctrl+Enter to send)" style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} />
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <ActionBtn label={sending ? 'Sending…' : 'Send'} color={BLUE} disabled={sending || !sendMsg.trim()} onClick={handleSend} />
                      <ActionBtn label={restarting ? 'Restarting…' : 'Restart Gateway'} color={AMBER} disabled={restarting} onClick={handleRestart} />
                      {sendStatus && <span style={{ fontSize: '11px', color: sendStatus.ok ? GREEN : RED, fontFamily: MONO }}>{sendStatus.ok ? '✓ ' : '✗ '}{sendStatus.msg}</span>}
                    </div>
                  </div>
                </Section>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>{GatewayLog}</div>
            </div>
          )}

          {/* ── CONFIG (redacted) ────────────────────────────────── */}
          {tab === 'config' && (
            <Section title="CONFIG · REDACTED" accent={PURPLE}>
              <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, marginBottom: '10px' }}>
                Allowlisted fields only — secrets (.env / auth / tokens) are never served.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: MONO, fontSize: '12px' }}>
                <Row k="Version" v={'v' + (config.version || '?')} />
                <Row k="Model" v={config.model} vColor={BLUE} />
                <Row k="Provider" v={config.provider} />
                <Row k="Fallback" v={config.fallback.join(', ') || '—'} />
                <Row k="Toolsets" v={config.toolsets.join(', ') || '—'} />
                <Row k="Web search" v={config.web_search} />
                <Row k="Terminal cwd" v={config.cwd || '—'} />
                <Row k="Workspace home" v={config.home} />
              </div>
            </Section>
          )}

          {/* ── CHAT (dashboard one-shot + gateway handoff) ─────────── */}
          {tab === 'chat' && (
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Section title="DASHBOARD CHAT · ONE-SHOT" accent={GREEN}>
                <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, marginBottom: '10px' }}>
                  Runs <span style={{ color: BLUE }}>hermes -z</span> once ({model}) and prints the reply. This is not a persistent streaming thread yet.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea value={chatPrompt}
                    onInput={(e) => setChatPrompt((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleChat(); }}
                    placeholder="Ask Hermes something… (Ctrl+Enter to run)" style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <ActionBtn label={chatBusy ? 'Running…' : 'Run one-shot'} color={GREEN} disabled={chatBusy || !chatPrompt.trim()} onClick={handleChat} />
                    <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>60s cap · no streaming · no dashboard session memory</span>
                  </div>
                  {chatOut && (
                    <div style={{ background: '#060d14', borderRadius: '6px', border: '1px solid ' + (chatOut.ok ? CARD_BORDER : RED + '55'), padding: '12px' }}>
                      {chatOut.ok ? (
                        <pre style={{ margin: 0, fontSize: '12px', color: '#c5e1e8', fontFamily: MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{chatOut.output || '(empty response)'}</pre>
                      ) : (
                        <div style={{ fontSize: '12px', color: RED, fontFamily: MONO }}>✗ {chatOut.message}{chatOut.output ? '\n\n' + chatOut.output : ''}</div>
                      )}
                    </div>
                  )}
                </div>
              </Section>

              <Section title="MOBILE / GATEWAY CHAT" accent={BLUE}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <ChannelPill label="Telegram" state={telegramState} ready={telegramReady} />
                    <ChannelPill label="Discord" state={discordState} ready={discordReady} />
                  </div>
                  <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>
                    Telegram is the only connected Hermes messaging platform right now. Discord is visible here so it is obvious it still needs setup before you can chat with Hermes there.
                  </div>
                  <textarea ref={sendRef} value={sendMsg}
                    onInput={(e) => setSendMsg((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); }}
                    placeholder="Send a Telegram message through Hermes… (Ctrl+Enter)" style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <ActionBtn label={sending ? 'Sending…' : 'Send to Telegram'} color={BLUE} disabled={sending || !sendMsg.trim() || !telegramReady} onClick={handleSend} />
                    {!discordReady && <Badge label="Discord setup required" color={AMBER} />}
                    {sendStatus && <span style={{ fontSize: '11px', color: sendStatus.ok ? GREEN : RED, fontFamily: MONO }}>{sendStatus.ok ? '✓ ' : '✗ '}{sendStatus.msg}</span>}
                  </div>
                </div>
              </Section>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '10px 12px', background: '#0d1117', border: '1px solid ' + CARD_BORDER,
  borderRadius: '6px', color: '#e0e0e0', fontSize: '13px', fontFamily: MONO, outline: 'none', boxSizing: 'border-box' as const,
};

function Row({ k, v, vColor }: { k: string; v: string; vColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: '1px solid #0d1a24' }}>
      <span style={{ color: MUTED, whiteSpace: 'nowrap' }}>{k}</span>
      <span style={{ color: vColor || '#e0e0e0', textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}

function Section({ title, accent, count, children }: { title: string; accent: string; count?: number; children: any }) {
  return (
    <div style={{ background: CARD_BG, border: '1px solid ' + CARD_BORDER, borderLeft: '3px solid ' + accent, borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #0d1a24' }}>
        <span style={{ fontSize: '10px', letterSpacing: '2px', fontWeight: 700, color: accent, fontFamily: MONO }}>{title}</span>
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', background: accent + '22', color: accent, fontFamily: MONO }}>{count}</span>
        )}
      </div>
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: '8px', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', fontFamily: MONO, letterSpacing: '1px', background: color + '22', color, border: '1px solid ' + color + '44' }}>{label}</span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed #1a2332', borderRadius: '6px', fontSize: '11px', color: MUTED, fontFamily: MONO }}>{label}</div>
  );
}

function ChannelPill({ label, state, ready }: { label: string; state: string; ready: boolean }) {
  const color = ready ? GREEN : MUTED;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 800, padding: '5px 8px', borderRadius: '999px', fontFamily: MONO, background: color + '18', color, border: '1px solid ' + color + '44' }}>
      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
      {label}: {state}
    </span>
  );
}

function ActionBtn({ label, color, disabled, onClick }: { label: string; color: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 16px', borderRadius: '5px', fontFamily: MONO, fontSize: '11px', fontWeight: 700,
      letterSpacing: '0.5px', cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
      background: disabled ? '#1a2332' : color + '22', color: disabled ? MUTED : color,
      outline: '1px solid ' + (disabled ? '#1a2332' : color + '44'), opacity: disabled ? 0.6 : 1,
    }}>{label}</button>
  );
}
