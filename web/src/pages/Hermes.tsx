// Hermes Workspace — full integration page for Hermes Agent on the ClaudeClaw dashboard.
// Shows gateway status, active sessions, skills browser, crons, log tail, and quick send.
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
const MUTED = '#607d8b';
const CARD_BG = 'linear-gradient(180deg, #0a1929 0%, #0d1420 100%)';
const CARD_BORDER = '#1a3a4a';

interface GatewayStatus { running: boolean; pid: number | null; gateway_state: string; platforms: Record<string, { state: string; error_message: string | null }>; active_agents: number; uptime_secs: number | null; }
interface Session { session_key: string; display_name: string; platform: string; chat_type: string; updated_at: string; estimated_cost_usd: number; suspended: boolean; }
interface Skill { name: string; description: string; category: string; source: string; }
interface Cron { name: string; schedule: string; prompt: string; enabled: boolean; }
interface HermesData { gateway: GatewayStatus; sessions: Session[]; skills: Skill[]; crons: Cron[]; recent_logs: string[]; model: string; config_ok: boolean; }

function fmtUptime(secs: number | null): string {
  if (secs === null || secs < 0) return '—';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function logColor(line: string): string {
  if (line.includes('ERROR') || line.includes('error')) return '#ef5350';
  if (line.includes('WARNING') || line.includes('warn')) return '#ffa726';
  if (line.includes('✓') || line.includes('connected') || line.includes('running')) return '#66bb6a';
  if (line.includes('inbound message') || line.includes('response ready')) return '#4fc3f7';
  return '#b0bec5';
}

export function Hermes() {
  const { data, loading, error } = useFetch<HermesData>('/api/hermes', 15_000);

  const [skillFilter, setSkillFilter] = useState('');
  const [skillCategory, setSkillCategory] = useState('all');
  const [logExpanded, setLogExpanded] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const sendRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (sendStatus) { const t = setTimeout(() => setSendStatus(null), 4000); return () => clearTimeout(t); } }, [sendStatus]);

  if (error) return <div class="flex flex-col h-full"><PageHeader title="Hermes" /><PageState error={error} /></div>;
  if (loading && !data) return <div class="flex flex-col h-full"><PageHeader title="Hermes" /><PageState loading /></div>;
  if (!data) return <div class="flex flex-col h-full"><PageHeader title="Hermes" /><PageState empty emptyTitle="No Hermes data" /></div>;

  const { gateway, sessions, skills, crons, recent_logs, model } = data;
  const gwOnline = gateway.running;
  const gwColor = gwOnline ? GREEN : RED;

  // Skills filter
  const categories = ['all', ...Array.from(new Set(skills.map(s => s.category || 'misc').filter(Boolean))).sort()];
  const filteredSkills = skills.filter(s => {
    const matchCat = skillCategory === 'all' || s.category === skillCategory;
    const matchQ = !skillFilter || s.name.toLowerCase().includes(skillFilter.toLowerCase()) || s.description.toLowerCase().includes(skillFilter.toLowerCase());
    return matchCat && matchQ;
  });

  const handleSend = async () => {
    if (!sendMsg.trim()) return;
    setSending(true);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/api/hermes/send', { message: sendMsg.trim() });
      setSendStatus({ ok: res.ok, msg: res.message });
      if (res.ok) setSendMsg('');
    } catch (e) {
      setSendStatus({ ok: false, msg: String(e) });
    }
    setSending(false);
  };

  const handleRestart = async () => {
    if (!confirm('Restart the Hermes gateway? This bounces Telegram and interrupts any in-flight agent or cron job.')) return;
    setRestarting(true);
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/api/hermes/restart', {});
      setSendStatus({ ok: res.ok, msg: res.message });
    } catch (e) {
      setSendStatus({ ok: false, msg: String(e) });
    }
    setRestarting(false);
  };

  const displayedLogs = logExpanded ? recent_logs : recent_logs.slice(-12);

  return (
    <div class="flex flex-col h-full">
      <PageHeader title="Hermes Workspace" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ── STATUS BAR — 2×2 on phones, 4-up from lg ────────── */}
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{
            padding: '20px 24px',
            background: 'linear-gradient(180deg, #0d1420 0%, #0a1115 100%)',
            border: '1px solid ' + CARD_BORDER, borderRadius: '10px',
          }}>
            {/* Online status */}
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>GATEWAY</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: gwColor, boxShadow: gwOnline ? '0 0 8px ' + gwColor : 'none' }} />
                <span style={{ fontSize: '18px', fontWeight: 800, color: gwColor, fontFamily: MONO }}>{gwOnline ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              {gateway.pid && <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>PID {gateway.pid}</div>}
            </div>

            {/* Uptime */}
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>UPTIME</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#e0e0e0', fontFamily: MONO }}>{fmtUptime(gateway.uptime_secs)}</div>
              <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>{gateway.active_agents} active agent{gateway.active_agents !== 1 ? 's' : ''}</div>
            </div>

            {/* Model */}
            <div>
              <div style={{ fontSize: '10px', color: MUTED, letterSpacing: '2px', marginBottom: '8px', fontFamily: MONO }}>MODEL</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: BLUE, fontFamily: MONO, wordBreak: 'break-all' }}>{model}</div>
              <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px', fontFamily: MONO }}>{skills.length} skills · {sessions.length} session{sessions.length !== 1 ? 's' : ''}</div>
            </div>

            {/* Platforms */}
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
                {Object.keys(gateway.platforms).length === 0 && (
                  <div style={{ fontSize: '11px', color: MUTED, fontFamily: MONO }}>No platforms</div>
                )}
              </div>
            </div>
          </div>

          {/* ── TWO-COLUMN MAIN — single column on phones ───────── */}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* LEFT: Send + Sessions + Crons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Send to Telegram */}
              <Section title="SEND TO TELEGRAM" accent={BLUE}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea
                    ref={sendRef}
                    value={sendMsg}
                    onInput={(e) => setSendMsg((e.target as HTMLTextAreaElement).value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); }}
                    placeholder="Type a message… (Ctrl+Enter to send)"
                    style={{
                      width: '100%', minHeight: '80px', padding: '10px 12px',
                      background: '#0d1117', border: '1px solid ' + CARD_BORDER,
                      borderRadius: '6px', color: '#e0e0e0', fontSize: '13px',
                      fontFamily: MONO, resize: 'vertical', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <ActionBtn label={sending ? 'Sending…' : 'Send'} color={BLUE} disabled={sending || !sendMsg.trim()} onClick={handleSend} />
                    <ActionBtn label={restarting ? 'Restarting…' : 'Restart Gateway'} color={AMBER} disabled={restarting} onClick={handleRestart} />
                    {sendStatus && (
                      <span style={{ fontSize: '11px', color: sendStatus.ok ? GREEN : RED, fontFamily: MONO, flex: 1 }}>
                        {sendStatus.ok ? '✓ ' : '✗ '}{sendStatus.msg}
                      </span>
                    )}
                  </div>
                </div>
              </Section>

              {/* Active Sessions */}
              <Section title="ACTIVE SESSIONS" accent={GREEN} count={sessions.length}>
                {sessions.length === 0 ? (
                  <EmptyState label="No active sessions" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {sessions.map((s, i) => (
                      <div key={i} style={{ padding: '10px 12px', background: '#0d1117', borderRadius: '6px', border: '1px solid ' + CARD_BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{s.display_name}</div>
                          <div style={{ fontSize: '10px', color: MUTED, fontFamily: MONO, marginTop: '2px' }}>{s.platform} · {s.chat_type} · {fmtTime(s.updated_at)}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                          {s.suspended && <Badge label="SUSPENDED" color={AMBER} />}
                          {s.estimated_cost_usd > 0 && (
                            <span style={{ fontSize: '10px', color: MUTED, fontFamily: MONO }}>${s.estimated_cost_usd.toFixed(4)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Cron Jobs */}
              <Section title="CRON JOBS" accent={AMBER} count={crons.length}>
                {crons.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed #1a2332', borderRadius: '6px' }}>
                    <div style={{ fontSize: '12px', color: MUTED, fontFamily: MONO, marginBottom: '8px' }}>No scheduled jobs yet</div>
                    <div style={{ fontSize: '11px', color: '#4fc3f7', fontFamily: MONO }}>hermes cron create "0 9 * * 1-5" "Run AIME scan on desk picks" --skills ainvest-aime</div>
                  </div>
                ) : (
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
            </div>

            {/* RIGHT: Skills + Log */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Skills Browser */}
              <Section title="SKILLS" accent="#ce93d8" count={skills.length}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input
                    type="text"
                    value={skillFilter}
                    onInput={(e) => setSkillFilter((e.target as HTMLInputElement).value)}
                    placeholder="Search skills…"
                    style={{
                      width: '100%', padding: '8px 12px',
                      background: '#0d1117', border: '1px solid ' + CARD_BORDER,
                      borderRadius: '5px', color: '#e0e0e0', fontSize: '12px',
                      fontFamily: MONO, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  {/* Category tabs */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {categories.slice(0, 8).map(cat => (
                      <button key={cat} onClick={() => setSkillCategory(cat)} style={{
                        padding: '3px 10px', borderRadius: '3px', fontFamily: MONO, fontSize: '9px',
                        fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', border: 'none',
                        background: skillCategory === cat ? '#ce93d8' : '#1a2332',
                        color: skillCategory === cat ? '#0d1117' : '#90a4ae',
                      }}>
                        {cat === 'all' ? 'ALL' : cat.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {/* Skills list */}
                  <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {filteredSkills.length === 0 ? (
                      <EmptyState label="No skills match" />
                    ) : filteredSkills.slice(0, 50).map((s, i) => (
                      <div key={i} style={{
                        padding: '8px 12px', background: '#0d1117',
                        borderRadius: '5px', border: '1px solid ' + CARD_BORDER,
                        borderLeft: '3px solid #ce93d8',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#e0e0e0', fontFamily: MONO }}>{s.name}</span>
                          <span style={{ fontSize: '9px', color: MUTED, fontFamily: MONO, whiteSpace: 'nowrap' }}>{s.source}</span>
                        </div>
                        {s.description && (
                          <div style={{ fontSize: '10px', color: '#90a4ae', fontFamily: MONO, marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.description}</div>
                        )}
                      </div>
                    ))}
                    {filteredSkills.length > 50 && (
                      <div style={{ fontSize: '10px', color: MUTED, textAlign: 'center', padding: '6px', fontFamily: MONO }}>+{filteredSkills.length - 50} more — refine search</div>
                    )}
                  </div>
                </div>
              </Section>

              {/* Gateway Log */}
              <Section title="GATEWAY LOG" accent={MUTED} count={recent_logs.length}>
                <div style={{ background: '#060d14', borderRadius: '6px', border: '1px solid ' + CARD_BORDER, padding: '12px', fontFamily: MONO }}>
                  <div style={{ maxHeight: logExpanded ? '500px' : '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {displayedLogs.length === 0 ? (
                      <div style={{ fontSize: '11px', color: MUTED }}>No log lines yet.</div>
                    ) : displayedLogs.map((line, i) => {
                      // Strip the timestamp prefix for display
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
                    marginTop: '8px', width: '100%', padding: '5px',
                    background: 'transparent', border: '1px dashed #1a2332', borderRadius: '3px',
                    color: '#4fc3f7', fontSize: '10px', cursor: 'pointer', fontFamily: MONO,
                  }}>
                    {logExpanded ? '▾ Collapse' : '▸ Show More (' + recent_logs.length + ' lines)'}
                  </button>
                </div>
              </Section>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
    <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed #1a2332', borderRadius: '6px', fontSize: '11px', color: MUTED, fontFamily: MONO }}>
      {label}
    </div>
  );
}

function ActionBtn({ label, color, disabled, onClick }: { label: string; color: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '7px 16px', borderRadius: '5px', fontFamily: MONO, fontSize: '11px', fontWeight: 700,
      letterSpacing: '0.5px', cursor: disabled ? 'not-allowed' : 'pointer', border: 'none',
      background: disabled ? '#1a2332' : color + '22',
      color: disabled ? MUTED : color,
      outline: '1px solid ' + (disabled ? '#1a2332' : color + '44'),
      opacity: disabled ? 0.6 : 1,
    }}>
      {label}
    </button>
  );
}
