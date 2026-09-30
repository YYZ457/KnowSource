// The trial gateway may idle-stop a worker, but Agent runs live in that worker's
// memory. Preserve pending confirmations even when the UI stops polling them.
// Keep the same upper bound as the Agent runtime rather than extending its TTL.
const RUN_TTL_MS = 30 * 60 * 1000;
const LIVE = new Set(['running', 'awaiting_confirmation']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function rememberAgentRun(entry, snapshot, now = Date.now()) {
  if (!snapshot || snapshot.success === false || typeof snapshot.runId !== 'string' || !snapshot.runId || snapshot.runId.length > 150) return;
  entry.agentRuns ||= new Map();
  if (TERMINAL.has(snapshot.status)) {
    entry.agentRuns.delete(snapshot.runId);
    return;
  }
  // The run-start response contains only runId. Confirm/status/cancel responses
  // also carry status, and full snapshots carry the original expiration time.
  if (snapshot.status !== undefined && !LIVE.has(snapshot.status)) return;
  const previous = entry.agentRuns.get(snapshot.runId);
  const expiresAt = Number.isFinite(snapshot.expiresAt)
    ? Math.min(snapshot.expiresAt, now + RUN_TTL_MS)
    : previous?.expiresAt ?? now + RUN_TTL_MS;
  entry.agentRuns.set(snapshot.runId, { status: snapshot.status || 'running', expiresAt });
}

export function hasLiveAgentRun(entry, now = Date.now()) {
  for (const [runId, run] of entry.agentRuns || []) {
    if (run.expiresAt <= now) entry.agentRuns.delete(runId);
  }
  return Boolean(entry.agentRuns?.size);
}
