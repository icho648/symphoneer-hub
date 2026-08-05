"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { hubRequest, type AuthContext } from "../lib/api";
import { getSupabaseClient } from "../lib/supabase";

type Installation = { id: string; name: string; createdAt: string; updatedAt: string; online: boolean };
type Attempt = { id: string; taskId: string; status: string; updatedAt: string };
type Task = { id: string; identifier: string; title: string; state: string };
type CommandView = {
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
};

type Snapshot = {
  runtimeId: string;
  eventSequence: number;
  observedAt: string;
  snapshot: {
    runtime: { runtimeId: string; lastEventSequence: number };
    tasks: Task[];
    attempts: Attempt[];
  };
};

const devMode = process.env.NEXT_PUBLIC_AUTH_MODE === "dev";
const devUserId = "00000000-0000-0000-0000-000000000001";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const auth = useMemo<AuthContext>(
    () => (devMode ? { devUserId } : session?.access_token ? { accessToken: session.access_token } : {}),
    [session],
  );
  const authenticated = devMode || Boolean(session);

  useEffect(() => {
    if (devMode) return;
    const supabase = getSupabaseClient();
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadInstallations = useCallback(async () => {
    if (!authenticated) return;
    const result = await hubRequest<{ installations: Installation[] }>("/v1/installations", auth);
    setInstallations(result.installations);
    setSelectedId((current) => current ?? result.installations[0]?.id ?? null);
  }, [auth, authenticated]);

  const loadSnapshot = useCallback(async () => {
    if (!selectedId) return;
    try {
      setSnapshot(await hubRequest<Snapshot>(`/v1/installations/${selectedId}/snapshot`, auth));
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "Snapshot is unavailable");
    }
  }, [auth, selectedId]);

  useEffect(() => {
    void loadInstallations();
  }, [loadInstallations]);
  useEffect(() => {
    void loadSnapshot();
    const timer = setInterval(() => void loadSnapshot(), 5000);
    return () => clearInterval(timer);
  }, [loadSnapshot]);

  async function signIn() {
    const supabase = getSupabaseClient();
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function createInstallation() {
    const name = window.prompt("Installation name", "My Mac");
    if (!name) return;
    setLoading(true);
    try {
      await hubRequest("/v1/installations", auth, { method: "POST", body: JSON.stringify({ name }) });
      await loadInstallations();
    } finally {
      setLoading(false);
    }
  }

  async function createPairingCode() {
    if (!selectedId) return;
    const result = await hubRequest<{ code: string; expiresAt: string }>(
      `/v1/installations/${selectedId}/pairing-codes`,
      auth,
      { method: "POST", body: JSON.stringify({ ttlSeconds: 300 }) },
    );
    setPairingCode(result.code);
    setMessage(`Pairing code expires at ${new Date(result.expiresAt).toLocaleTimeString()}`);
  }

  async function waitForCommand(commandId: string): Promise<void> {
    if (!selectedId) return;
    const terminal = new Set(["succeeded", "rejected", "conflict", "expired", "failed"]);
    for (let poll = 0; poll < 35; poll += 1) {
      const result = await hubRequest<{ command: CommandView }>(
        `/v1/installations/${selectedId}/commands/${commandId}`,
        auth,
      );
      if (terminal.has(result.command.status)) {
        setMessage(
          result.command.status === "succeeded"
            ? `Command ${commandId} succeeded.`
            : `Command ${commandId} ${result.command.status}: ${result.command.errorMessage ?? result.command.errorCode ?? "no detail"}`,
        );
        await loadSnapshot();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setMessage(`Command ${commandId} is still pending; refresh to check again.`);
  }

  async function pauseAttempt(attempt: Attempt) {
    if (!selectedId || !snapshot) return;
    const idempotencyKey = crypto.randomUUID();
    const result = await hubRequest<{ commandId: string; status: string }>(
      `/v1/installations/${selectedId}/commands/pause-attempt`,
      auth,
      {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          runtimeId: snapshot.runtimeId,
          attemptId: attempt.id,
          expectedEventSequence: snapshot.eventSequence,
          expectedAttemptUpdatedAt: attempt.updatedAt,
          expiresInSeconds: 60,
        }),
      },
    );
    setMessage(`Command ${result.commandId} is ${result.status}.`);
    void waitForCommand(result.commandId).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Command status is unavailable");
    });
  }

  if (!authenticated) {
    return (
      <main className="center-card">
        <p className="eyebrow">LOCAL-FIRST REMOTE CONTROL</p>
        <h1>Symphoneer Hub</h1>
        <p>Inspect your local Runtime and send narrow, audited commands without exposing its loopback port.</p>
        <button type="button" onClick={() => void signIn()}>Sign in with GitHub</button>
      </main>
    );
  }

  const tasks = new Map(snapshot?.snapshot.tasks.map((task) => [task.id, task]) ?? []);
  const selectedInstallation = installations.find((item) => item.id === selectedId) ?? null;
  return (
    <main className="shell">
      <header>
        <div>
          <p className="eyebrow">SYMPHONEER HUB</p>
          <h1>Remote task board</h1>
        </div>
        <button type="button" className="secondary" disabled={loading} onClick={() => void createInstallation()}>
          New installation
        </button>
      </header>

      <section className="toolbar">
        <label>
          Installation
          <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="" disabled>Select…</option>
            {installations.map((installation) => (
              <option key={installation.id} value={installation.id}>{installation.name}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!selectedId} onClick={() => void createPairingCode()}>Create pairing code</button>
        <button type="button" className="secondary" disabled={!selectedId} onClick={() => void loadSnapshot()}>Refresh</button>
      </section>

      {pairingCode ? <section className="pairing"><span>One-time code</span><strong>{pairingCode}</strong><code>PAIRING_CODE={pairingCode} pnpm dev:connector</code></section> : null}
      {message ? <p className="notice" role="status">{message}</p> : null}

      <section className="status-grid">
        <article>
          <span>Runtime</span>
          <strong>
            {selectedInstallation?.online ? "Online" : "Offline"}
            {snapshot?.runtimeId ? ` · ${snapshot.runtimeId}` : ""}
          </strong>
        </article>
        <article><span>Last sequence</span><strong>{snapshot?.eventSequence ?? "—"}</strong></article>
        <article><span>Observed</span><strong>{snapshot ? new Date(snapshot.observedAt).toLocaleTimeString() : "—"}</strong></article>
      </section>

      <section>
        <div className="section-title"><h2>Attempts</h2><span>{snapshot?.snapshot.attempts.length ?? 0}</span></div>
        <div className="attempts">
          {snapshot?.snapshot.attempts.map((attempt) => {
            const task = tasks.get(attempt.taskId);
            const pausable = !["paused", "succeeded", "failed", "timed_out", "stalled", "canceled_by_reconciliation"].includes(attempt.status);
            return (
              <article key={attempt.id} className="attempt">
                <div><span>{task?.identifier ?? attempt.taskId}</span><h3>{task?.title ?? "Unknown task"}</h3><p>{attempt.status} · updated {new Date(attempt.updatedAt).toLocaleString()}</p></div>
                <button type="button" disabled={!pausable} onClick={() => void pauseAttempt(attempt)}>Pause</button>
              </article>
            );
          }) ?? <p>No Runtime snapshot yet.</p>}
        </div>
      </section>
    </main>
  );
}
