---
Type: RFC
Author: Michael Kidder
Title: Untrusted Content Provenance Across Ingestion, Hive, and Agent Context
Decision: Draft
Implementation: Not started
Created: 2026-08-03
Component: ingestion / hive mind / memory context / security
Tracking: issue #185
Last reviewed: 2026-08-03
---

# Untrusted Content Provenance Across Ingestion, Hive, and Agent Context

## 1. Summary

ClaudeClaw must preserve the origin and trust class of external content as it
moves through connectors, agent summaries, the hive mind, and rendered context.
An agent rewriting untrusted material does not make the material trusted.

This RFC introduces structured, monotonic provenance. External assertions remain
external assertions through every transformation unless an authenticated operator
or a reproducible verification process records a separate verification event.
Team activity and memory rendering expose that boundary and fence untrusted text
as defense in depth.

The security property is carried by data and enforced by code. Prompt wording,
XML-style fences, and agent discipline are supporting controls, not the source of
truth.

Tracking issue: [#185](https://github.com/earlyaidopters/claudeclaw-os/issues/185).

## 2. Trigger

On 2026-07-25, a community contributor reported that four patches applied cleanly
and passed typecheck and tests. A community-feed agent summarized the post into
the hive. A later team-activity rendering presented the result as a peer finding:
the patches were described as verified even though nobody had downloaded, applied,
or run them.

The contributor acted in good faith. The defect does not depend on malice. Two
independent failures occurred:

1. **Claim laundering:** a third-party assertion became a first-party finding after
   two summarization hops.
2. **Instruction amplification:** the same path can carry attacker-controlled
   instructions from one external source into every fleet agent's next turn.

The current system stores and renders the summary text but not the origin that
determines how that text may be used.

## 3. Goals

1. Tag external content at the point where it enters ClaudeClaw.
2. Preserve provenance through summaries, merges, storage, and rendering.
3. Distinguish an attributed assertion from an internally observed or reproduced
   result.
4. Prevent external or derived content from silently becoming trusted instructions,
   mission assignments, active-turn steering, configuration, or verification.
5. Give operators and agents a clear rendering seam without exposing secrets or
   flooding context.
6. Cover the existing hive/team-activity amplifier first, then extend the same
   contract to every external ingest surface.

## 4. Non-goals

- Proving that a model will always obey an untrusted-content marker.
- Treating all external content as malicious or refusing to summarize it.
- Building automated community patch intake. That remains blocked until this
  control ships and the contribution artifact path is defined.
- Replacing provider output sanitization or OS-level provider containment.
- Establishing truth from model confidence, writing style, author reputation, or
  whether the source is believed to be acting in good faith.
- Persisting full external documents in the hive solely to establish provenance.

## 5. Trust and verification model

Provenance has two independent dimensions. They must not be collapsed into one
"trusted" boolean.

### 5.1 Origin class

`origin_class` records where the underlying information came from:

| Value | Meaning |
| --- | --- |
| `operator` | Direct authenticated operator input or an explicit operator decision. |
| `internal_system` | A result produced directly by ClaudeClaw code or a sanctioned tool under the current trust boundary. |
| `external` | Content supplied by a third party or retrieved from an external system. |
| `derived_external` | A summary, extraction, classification, or merge whose inputs include external content. |
| `legacy_unknown` | A pre-migration row or input whose origin cannot be established. |

The agent or component that writes a summary is not necessarily the origin of the
information. An internal agent summarizing a Skool post produces
`derived_external`, not `internal_system`.

### 5.2 Evidence class

`evidence_class` records what ClaudeClaw actually knows:

| Value | Meaning |
| --- | --- |
| `asserted` | A source claims something. ClaudeClaw has not independently checked it. |
| `observed` | ClaudeClaw directly observed the stated artifact or system result. |
| `reproduced` | A defined local or CI procedure independently reproduced the result. |

Reading a post is evidence that the post contains a claim. It is not evidence that
the claim is true. For example, a scraper may record "the contributor asserts that
tests pass" as `external/asserted`; it may not record "tests pass" as
`internal_system/observed`.

### 5.3 Monotonicity

Provenance may stay the same or become more restrictive as data flows through the
system. It may not become less restrictive merely because an agent rewrote it.

- Summarizing `external` produces `derived_external`.
- Combining any external-derived input with internal data produces
  `derived_external` for claims based on that mixture.
- Missing provenance fails to `legacy_unknown`; it never defaults to operator or
  verified content.
- A model cannot promote `asserted` to `observed` or `reproduced` through prose.
- Verification creates a separate event linked to the assertion. It does not
  rewrite history or erase the original source.

An authenticated operator may explicitly approve an action after reading external
content. That approval is a new `operator` event. It does not change the external
content's origin class.

## 6. Provenance envelope

All structured ingress and derived-content APIs use a shared envelope. Exact type
names may change, but the semantics are required.

```ts
type OriginClass =
  | 'operator'
  | 'internal_system'
  | 'external'
  | 'derived_external'
  | 'legacy_unknown';

type EvidenceClass = 'asserted' | 'observed' | 'reproduced';

interface ContentProvenance {
  originClass: OriginClass;
  evidenceClass: EvidenceClass;
  sourceKind: string;
  sourceRef?: string;
  parentRefs?: string[];
  observedAt: number;
}

interface ProvenancedText {
  text: string;
  provenance: ContentProvenance;
}
```

### 6.1 Field rules

- `sourceKind` is a bounded, low-cardinality identifier such as `skool_post`,
  `slack_message`, `web_page`, `document`, `telegram_forward`, `agent_action`, or
  `ci_run`.
- `sourceRef` is a bounded opaque reference useful for audit. It must not contain
  credentials, signed URLs, message bodies, access tokens, or sensitive query
  parameters.
- `parentRefs` is capped. A many-source summary records a bounded aggregate rather
  than an unbounded list.
- `observedAt` records when ClaudeClaw observed the source, not when the source
  claims the event occurred.
- Free-form source labels supplied by external content are not trusted metadata.

### 6.2 Derivation helper

A single shared helper derives output provenance from parent envelopes. Callers do
not hand-roll trust joins.

```ts
function deriveProvenance(
  parents: ContentProvenance[],
  sourceKind: string,
  observedAt: number,
): ContentProvenance;
```

The helper applies the monotonic rules, bounds parent references, and returns
`legacy_unknown` if required metadata is absent or invalid.

## 7. Storage contract

`hive_mind` gains structured provenance columns rather than embedding markers in
`summary`:

- `origin_class`, non-null;
- `evidence_class`, non-null;
- `source_kind`, non-null;
- `source_ref`, nullable and bounded;
- `parent_refs_json`, nullable and bounded;
- `observed_at`, non-null.

Schema names may be adjusted to match database conventions. The fields and their
semantics may not be reduced to a single boolean.

### 7.1 Migration

Existing rows migrate to `legacy_unknown/asserted` unless their origin can be
established deterministically from existing structured fields. Migration must not
guess from summary prose or agent identity.

Legacy rows are fenced when rendered. The migration is additive and rollback-safe;
older binaries may ignore the new columns without corrupting existing summaries.

### 7.2 Write paths

Internal database functions that can place text into team activity require a
provenance envelope. External connectors attach provenance before model
summarization. A summarizer returns only transformed text; its caller reattaches
derived provenance from the original structured envelope.

The sanctioned hive API must not allow the model to select a more trusted class
than the caller context permits. In-process tool calls should carry caller-owned
provenance metadata outside model-controlled arguments.

`hive-cli` remains necessary for operator and maintenance use, but it is not a
security-grade oracle for content origin because a shell-capable model controls its
arguments. CLI writes therefore require an explicit origin/evidence selection and
are audited. Automated external ingestion must use the structured connector path,
not rely on a model remembering CLI flags.

## 8. Ingestion boundaries

Each external connector creates the provenance envelope before any content reaches
a model:

1. **Skool:** posts, comments, profiles, and attachments are `external/asserted`.
2. **Slack and WhatsApp reads:** message bodies and attachment text are
   `external/asserted`, even when the account is owned by the operator.
3. **Forwarded or quoted Telegram content:** the authenticated sender is known, but
   the quoted material remains external.
4. **Web and document retrieval:** fetched pages, PDFs, transcripts, and extracted
   text are external.
5. **Obsidian clippings:** preserve the clipping's original source classification;
   placement in the operator's vault does not automatically make its claims
   verified.
6. **Agent handbacks and scheduled output:** inherit the most restrictive parent
   provenance. Agent-to-agent transport does not reset trust.

Direct authenticated operator instructions remain `operator`, except quoted or
forwarded sections that have their own external envelope.

## 9. Rendering and prompt boundary

Team activity, memory context, and any other prompt renderer consume structured
provenance. They do not infer trust from text.

External, derived-external, and legacy-unknown content is rendered through one
shared escaping and fencing helper. The rendered seam includes a compact source and
evidence label and an instruction that the enclosed content is data, not authority.
Delimiter-like text inside the source is escaped before insertion.

Example shape:

```text
<untrusted source="skool_post" evidence="asserted">
External source claims: tests passed on four patches.
</untrusted>
```

This fence is a model-facing mitigation. The structured provenance and gateway
rules remain load-bearing.

## 10. Authority invariants

External or derived-external content must never automatically:

- create or reassign a mission task;
- steer an active turn;
- change provider, model, tool, MCP, sandbox, filesystem, or working-directory
  policy;
- schedule a job;
- authorize a command or code change;
- mark a third-party claim as locally verified;
- bypass authentication, PIN lock, command ownership, or input bounds.

An authenticated operator can explicitly authorize an action after the content is
presented. The resulting action records the operator authorization separately and
retains a reference to the external source.

## 11. Verification events

Verification is recorded as a new linked event with:

- the assertion reference;
- the procedure or tool that performed the check;
- the artifact identity or commit where applicable;
- the observed result;
- the timestamp and actor.

Code-verification claims should point to CI output or a reproducible local command.
"The contributor reports that tests pass" and "CI run 123 passed at commit abc"
remain separate facts.

## 12. Data minimization and observability

Provenance metadata is intentionally small. Content bodies are not copied into
metadata, source references are bounded, and secrets are redacted before storage.

Expose bounded counters for:

- entries by origin and evidence class;
- missing or invalid provenance rejected or downgraded;
- legacy rows rendered;
- attempted trust promotions;
- external-derived content blocked from authority-bearing paths.

Logs and metrics must not include message bodies, access tokens, signed URLs, or
high-cardinality user identifiers.

## 13. Failure behavior

- Missing or malformed provenance fails to `legacy_unknown/asserted` or rejects the
  write when the caller is an external connector.
- Rendering failure omits the affected external entry and logs a bounded error; it
  must not fall back to raw interpolation.
- An unavailable verification artifact leaves the assertion unverified.
- A connector that cannot establish its source boundary fails closed for automatic
  hive amplification. It may still show the content directly to the operator in a
  clearly untrusted envelope.

## 14. Rollout plan

### Phase 1: shared contract and hive seam

- Add provenance types and monotonic derivation tests.
- Add hive schema columns and safe legacy migration.
- Require structured provenance on internal team-activity write APIs.
- Render team activity with the shared fence.

### Phase 2: first live ingest path

- Convert the Skool feed-to-summary-to-hive path end to end.
- Reproduce the 2026-07-25 laundering incident as a regression test.
- Confirm an instruction-bearing post remains fenced in every agent's context.

### Phase 3: remaining ingest surfaces

- Slack, WhatsApp, Telegram forwards, web retrieval, documents/transcripts,
  Obsidian clippings, schedules, and handbacks.
- Inventory each surface before claiming coverage.

### Phase 4: verification and operator approval

- Add linked assertion/verification events.
- Add explicit operator authorization for actions derived from external content.
- Surface provenance and verification state in diagnostics where useful.

Automated community contribution intake may be designed only after Phases 1 and 2
ship and its artifact source is known.

## 15. Required tests

1. An external assertion summarized twice remains `derived_external/asserted`.
2. Mixing internal and external inputs cannot promote the external claim.
3. Missing metadata becomes `legacy_unknown`, never trusted.
4. Existing hive rows migrate safely and render fenced.
5. Delimiter and instruction text cannot escape the untrusted block.
6. Team activity never interpolates external-derived summaries raw.
7. A third-party test claim remains an assertion until a separate CI or local
   verification event is linked.
8. External content cannot create missions, steer turns, schedule jobs, or alter
   policy without operator authorization.
9. Source references are length-bounded and secret-bearing URLs are rejected or
   sanitized.
10. Rendering and connector failure paths fail closed without dropping the whole
    agent turn.

## 16. Alternatives rejected

### Prose-only labels or prompt instructions

Rejected because summarization already demonstrated that prose markers disappear
between hops. Models also follow untrusted-content instructions inconsistently.

### Trust the agent that wrote the summary

Rejected because writer identity is not information origin. This is the exact
laundering failure the RFC addresses.

### Infer provenance at render time

Rejected because the source has already been lost by then. Renderers cannot recover
history from prose reliably.

### Default missing provenance to internal

Rejected because compatibility would silently preserve the vulnerability. Unknown
must remain unknown and fenced.

### Block all external content

Rejected because external information is core product input. The system needs to
use it without confusing data with authority.

## 17. Security relationship to sibling work

This RFC is the inbound-content control.

- Provider output sanitization controls what leaves the model/runtime boundary.
- Provider OS containment limits what a compromised or untrusted runtime can reach.
- Active-turn steering controls which authenticated owner input can affect a live
  turn.
- This RFC preserves the trust class of information entering and moving through
  ClaudeClaw.

None substitutes for another. A fenced prompt without structured provenance is
soft guidance; structured provenance without gateway enforcement is metadata only;
OS containment limits blast radius but does not fix false claims.

## 18. Acceptance criteria

The RFC is implemented when:

1. Provenance is structured, stored, and monotonic across the hive path.
2. Existing rows migrate to a safe non-trusted state.
3. Skool content retains external provenance through summary and team-activity
   rendering.
4. Shared fencing escapes source content and never falls back to raw interpolation.
5. Assertions and reproduced verification are separate linked events.
6. External-derived content cannot enter authority-bearing paths automatically.
7. Tests reproduce both the real laundering incident and an instruction-bearing
   variant.
8. Operators can inspect bounded provenance diagnostics without exposing source
   content or credentials.
9. Documentation names covered and uncovered ingest surfaces honestly.
10. Community contribution automation remains disabled until its artifact and
    verification path satisfies this RFC.

*Holden analysis: This design puts trust in structured, monotonic provenance and
enforced authority boundaries instead of prompt wording, which directly closes
both the claim-laundering and instruction-amplification paths that triggered it.*
