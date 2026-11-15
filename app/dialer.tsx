"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import {
  AlertCircle,
  Loader2,
  Mic,
  MicOff,
  Pause,
  PhoneCall,
  PhoneOff,
  Play,
  RotateCcw,
  Search,
  Smartphone,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { BriefState, CallRecord, Disposition, Lead, Line, LineStatus, Stats } from "@/lib/types";
import { mockState } from "./mock";
import { unlockAudio, useCallSounds } from "./sounds";
import { useWebDialer, type WebTarget } from "./web-dialer";

export type DialerState = {
  lines: Line[];
  winnerSid: string | null;
  queue: Lead[];
  queueRemaining: number;
  queueLoaded: boolean;
  leadSource: string;
  stats: Stats;
  sessionStartedAt: number | null;
  batchStartedAt: number | null;
  history: CallRecord[];
  briefs: Record<string, BriefState>;
  simulate: boolean;
  web: boolean;
  publicUrl: string | null;
  sdrName: string;
  log: { at: number; msg: string }[];
  serverNow: number;
};

type PhoneState = "offline" | "connecting" | "ready" | "on-call" | "error";
type Mode = "live" | "web" | "sim";
type Tab = "queue" | "calls" | "activity" | "phones";

const ACTIVE: LineStatus[] = ["dialing", "ringing", "detecting", "connected"];

const STATUS: Record<LineStatus, { label: string; dot: string; text: string }> = {
  idle: { label: "Idle", dot: "bg-gray-300", text: "text-gray-500" },
  dialing: { label: "Dialing", dot: "bg-blue-500 animate-pulse", text: "text-blue-700" },
  ringing: { label: "Ringing", dot: "bg-blue-500 animate-pulse", text: "text-blue-700" },
  detecting: { label: "Screening", dot: "bg-amber-500 animate-pulse", text: "text-amber-700" },
  connected: { label: "Connected", dot: "bg-emerald-500", text: "text-emerald-700" },
  voicemail: { label: "Voicemail left", dot: "bg-violet-500", text: "text-violet-700" },
  dropped: { label: "Released", dot: "bg-gray-300", text: "text-gray-500" },
  "no-answer": { label: "No answer", dot: "bg-gray-300", text: "text-gray-500" },
  busy: { label: "Busy", dot: "bg-gray-300", text: "text-gray-500" },
  failed: { label: "Failed", dot: "bg-red-500", text: "text-red-700" },
  ended: { label: "Ended", dot: "bg-gray-300", text: "text-gray-500" },
};

const DISPOSITIONS: { id: Disposition; label: string }[] = [
  { id: "meeting", label: "Meeting booked" },
  { id: "interested", label: "Interested" },
  { id: "callback", label: "Call back" },
  { id: "not-interested", label: "Not interested" },
  { id: "wrong-number", label: "Wrong number" },
];

const DISPO_LABEL = Object.fromEntries(DISPOSITIONS.map((d) => [d.id, d.label])) as Record<Disposition, string>;

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";
const btn = `inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
const btnPrimary = `${btn} bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-500 disabled:opacity-100 disabled:shadow-none`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50`;
const btnGhost = `${btn} text-gray-600 hover:bg-gray-100 hover:text-gray-900`;

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export default function Dialer() {
  const [state, setState] = useState<DialerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState<PhoneState>("offline");
  const [muted, setMuted] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [tab, setTab] = useState<Tab>("queue");
  const [now, setNow] = useState(0); // set on the client after mount
  const preview = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).has("preview"),
    () => false,
  );
  const [skew, setSkew] = useState(0); // serverNow - clientNow
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);

  // Poll server state (or animate mock state in preview mode).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (preview) {
        setState(mockState(Date.now()));
        return;
      }
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!alive || !res.ok) return;
        const data: DialerState = await res.json();
        setSkew(data.serverNow - Date.now());
        setState(data);
      } catch {}
    };
    const first = setTimeout(() => {
      setNow(Date.now());
      tick();
    }, 0);
    const id = setInterval(tick, 800);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
      clearInterval(clock);
    };
  }, [preview]);

  useEffect(() => () => deviceRef.current?.destroy(), []);

  const goOnline = useCallback(async () => {
    if (preview) return setPhone("ready");
    setPhone("connecting");
    setError(null);
    try {
      const res = await fetch("/api/token");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "token request failed");
      const { Device } = await import("@twilio/voice-sdk");
      const device = new Device(data.token, { closeProtection: true });
      device.on("registered", () => setPhone("ready"));
      device.on("error", (e: { message?: string }) => {
        setError(`Softphone: ${e.message ?? "error"}`);
        setPhone("error");
      });
      device.on("tokenWillExpire", async () => {
        const r = await fetch("/api/token").then((x) => x.json());
        device.updateToken(r.token);
      });
      device.on("incoming", (call: Call) => {
        // Only calls bridged from the dialer arrive here, so auto-answer.
        callRef.current = call;
        const done = () => {
          callRef.current = null;
          setMuted(false);
          setPhone("ready");
        };
        call.on("disconnect", done);
        call.on("cancel", done);
        call.accept();
        setPhone("on-call");
      });
      await device.register();
      deviceRef.current = device;
    } catch (e) {
      setError((e as Error).message);
      setPhone("error");
    }
  }, [preview]);

  const post = async (url: string, body?: unknown) => {
    if (preview) return true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  };

  const serverNow = now + skew;
  const lines = state?.lines ?? [];
  const stats = state?.stats ?? { dials: 0, connects: 0, voicemails: 0, noAnswers: 0, meetings: 0, lineMs: 0, wallMs: 0 };
  // Time saved vs. dialing one line at a time: total line time minus wall-clock time, live during a batch.
  const openLineMs = lines.reduce((sum, l) => sum + (l.startedAt && !l.endedAt ? serverNow - l.startedAt : 0), 0);
  const openWallMs = state?.batchStartedAt ? serverNow - state.batchStartedAt : 0;
  const timeSavedMs = Math.max(0, stats.lineMs + openLineMs - (stats.wallMs + openWallMs));
  const batchActive = lines.some((l) => ACTIVE.includes(l.status));
  const live = lines.find((l) => l.status === "connected");
  const webMode = !!state?.web && !preview;
  const simulated = !!state?.simulate && !preview && !webMode;
  const mode: Mode = webMode ? "web" : simulated ? "sim" : "live";
  const online = phone === "ready" || phone === "on-call" || preview || simulated || webMode;
  const canDial = online && !batchActive && !busy && (state?.queueRemaining ?? 0) > 0;
  useCallSounds(lines, { enabled: soundOn && !preview, simulated });
  const webDialer = useWebDialer(lines, { enabled: webMode, sdrName: state?.sdrName ?? "Your rep", onError: setError });
  const connectRate = stats.dials ? Math.round((stats.connects / stats.dials) * 100) : 0;
  const rep = state?.sdrName ?? "Rep";
  // In web mode the queue is the live list of phones; add the ones currently on a line.
  const phonesOnline = webMode ? (state?.queue.length ?? 0) + lines.filter((l) => l.lead?.id.startsWith("web-") && ACTIVE.includes(l.status)).length : 0;

  const dial = async () => {
    unlockAudio(); // browsers only allow sound after a click
    if (!webMode) return post("/api/dial");
    setBusy(true);
    setError(null);
    try {
      await webDialer.prepare(); // mic + signaling; needs this click
      const res = await fetch("/api/dial", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; targets?: WebTarget[] };
      if (!res.ok) return setError(data.error ?? `Request failed (${res.status})`);
      webDialer.dial(data.targets ?? []);
    } catch (e) {
      const msg = (e as Error).message;
      setError(/denied|permission/i.test(msg) ? "Allow microphone access so you can talk to the lead." : msg);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => {
    if (webMode) webDialer.hangup();
    post("/api/hangup");
  };

  const queueHint = !online
    ? "Go online to start dialing"
    : state && state.queueRemaining === 0 && !batchActive
      ? webMode
        ? "No phones connected yet"
        : "Queue empty"
      : `${state?.queueRemaining ?? 0} in queue`;

  return (
    <div className="flex min-h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-white">
            <PhoneCall className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Parallel</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-2 text-sm" aria-label="Main">
          <div className="px-2 pt-2 pb-1 text-xs font-medium text-gray-500">Workspace</div>
          {(
            [
              ["queue", "Dialer"],
              ["calls", "Call log"],
              ["activity", "Activity"],
              ["phones", "Phones"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`flex h-8 w-full cursor-pointer items-center rounded-md px-2 text-left transition-colors duration-150 ${focus} ${
                tab === id ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {label}
              {id === "calls" && state?.history.length ? (
                <span className="ml-auto text-xs text-gray-500 tabular-nums">{state.history.length}</span>
              ) : null}
              {id === "phones" && webMode ? (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {phonesOnline}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-gray-200 p-3">
          <Avatar name={rep} size="sm" />
          <div className="min-w-0 text-sm">
            <div className="truncate font-medium">{rep}</div>
            <div className="text-xs text-gray-500">SDR</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Dialer</span>
            <span className="text-gray-300" aria-hidden>
              /
            </span>
            <h1 className="font-medium">Power session</h1>
            {preview && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Preview data</span>}
          </div>
          <div className="flex items-center gap-2">
            {!preview && state && (
              <ModeSwitch mode={mode} disabled={batchActive || busy} onChange={(m) => post("/api/mode", { mode: m })} />
            )}
            <RepStatus mode={mode} phone={preview ? "ready" : phone} onOnline={goOnline} />
            <button
              onClick={() => {
                unlockAudio();
                setSoundOn((v) => !v);
              }}
              aria-label={soundOn ? "Mute call sounds" : "Unmute call sounds"}
              aria-pressed={soundOn}
              title={soundOn ? "Call sounds on" : "Call sounds off"}
              className={`${btnGhost} w-9 px-0`}
            >
              {soundOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </header>

        <main className="w-full flex-1 space-y-4 px-4 py-5 sm:px-6">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="cursor-pointer text-red-700 hover:underline">
                Dismiss
              </button>
            </div>
          )}

          {/* Session stats */}
          <section
            aria-label="Session stats"
            className="grid grid-cols-2 divide-gray-200 rounded-lg border border-gray-200 bg-white sm:grid-cols-4 sm:divide-x xl:grid-cols-7"
          >
            <Stat label="Session" value={state?.sessionStartedAt ? fmtDuration(serverNow - state.sessionStartedAt) : "00:00"} />
            <Stat label="Dials" value={stats.dials} />
            <Stat label="Connects" value={stats.connects} />
            <Stat label="Connect rate" value={`${connectRate}%`} />
            <Stat label="Voicemails" value={stats.voicemails} />
            <Stat label="Meetings" value={stats.meetings} />
            <Stat label="Time saved" value={fmtDuration(timeSavedMs)} hint="vs. one line at a time" accent />
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-4">
              {/* Lines */}
              <section className="rounded-lg border border-gray-200 bg-white" aria-label="Call lines">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold">Lines</h2>
                    <p className="text-xs text-gray-500">
                      3 parallel lines · {queueHint}
                      {state?.leadSource && !webMode ? ` · ${state.leadSource === "scrapercity" ? "ScraperCity" : "CSV"}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {batchActive ? (
                      <button onClick={stop} className={btnSecondary}>
                        <Pause className="h-4 w-4" aria-hidden />
                        Stop
                      </button>
                    ) : (
                      <button onClick={() => post("/api/reset")} className={btnGhost}>
                        <RotateCcw className="h-4 w-4" aria-hidden />
                        Reset
                      </button>
                    )}
                    <button onClick={dial} disabled={!canDial} className={btnPrimary}>
                      {batchActive ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                      {batchActive ? "Dialing…" : "Dial next 3"}
                    </button>
                  </div>
                </div>
                <ul className="divide-y divide-gray-100">
                  {lines.map((l) => (
                    <LineRow key={l.index} line={l} now={serverNow} brief={l.lead ? state?.briefs?.[l.lead.id] : undefined} />
                  ))}
                </ul>
              </section>

              {/* Tabs */}
              <section className="rounded-lg border border-gray-200 bg-white">
                <div role="tablist" aria-label="Session" className="flex gap-5 border-b border-gray-200 px-4">
                  {(
                    [
                      ["queue", "Queue", state?.queueRemaining],
                      ["calls", "Call log", state?.history.length],
                      ["activity", "Activity", undefined],
                      ["phones", "Phones", webMode ? phonesOnline : undefined],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`-mb-px flex h-11 cursor-pointer items-center gap-1.5 border-b-2 text-sm transition-colors duration-150 ${focus} ${
                        tab === id ? "border-indigo-600 font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"
                      }`}
                    >
                      {label}
                      {count ? <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600 tabular-nums">{count}</span> : null}
                    </button>
                  ))}
                </div>

                <div className="p-4" role="tabpanel">
                  {tab === "queue" && (
                    <>
                      {webMode ? (
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                          <span className="inline-flex items-center gap-2">
                            <Smartphone className="h-4 w-4 text-gray-400" aria-hidden />
                            Phones that scan the QR code join this queue.
                          </span>
                          <button onClick={() => setTab("phones")} className="cursor-pointer font-medium text-indigo-600 hover:underline">
                            Show QR code
                          </button>
                        </div>
                      ) : (
                        <ListBuilder preview={preview} disabled={batchActive} onError={setError} />
                      )}
                      {state?.queue.length ? (
                        <div className="-mx-4 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                                <th className="w-10 py-2 pl-4 font-medium">#</th>
                                <th className="py-2 font-medium">Name</th>
                                <th className="hidden py-2 font-medium md:table-cell">Title</th>
                                <th className="py-2 font-medium">Company</th>
                                <th className="hidden py-2 pr-4 font-medium sm:table-cell">Phone</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {state.queue.map((lead, i) => (
                                <tr key={lead.id} className="hover:bg-gray-50">
                                  <td className="py-2.5 pl-4 text-xs text-gray-400 tabular-nums">{i + 1}</td>
                                  <td className="py-2.5 pr-3">
                                    <div className="flex items-center gap-2.5">
                                      <Avatar name={lead.name} size="xs" />
                                      <span className="truncate font-medium">{lead.name}</span>
                                    </div>
                                  </td>
                                  <td className="hidden max-w-48 truncate py-2.5 pr-3 text-gray-600 md:table-cell">{lead.title || "—"}</td>
                                  <td className="max-w-40 truncate py-2.5 pr-3 text-gray-600">{lead.company || "—"}</td>
                                  <td className="hidden py-2.5 pr-4 text-gray-500 tabular-nums sm:table-cell">{lead.phone}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <Empty text={webMode ? "Phones that open the link show up here." : "No leads in the queue."} />
                      )}
                    </>
                  )}

                  {tab === "calls" &&
                    (state?.history.length ? (
                      <ul className="-my-1 divide-y divide-gray-100">
                        {state.history.map((h) => (
                          <li key={`${h.lead.id}-${h.at}`} className="flex items-start gap-3 py-3">
                            <Avatar name={h.lead.name} size="xs" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                                <span className="font-medium">{h.lead.name}</span>
                                <span className="text-gray-500">{h.lead.company}</span>
                              </div>
                              {h.notes && <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{h.notes}</p>}
                            </div>
                            <OutcomeBadge d={h.disposition} />
                            <span className="w-16 shrink-0 text-right text-xs text-gray-500 tabular-nums">
                              {new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty text="Calls you log show up here." />
                    ))}

                  {tab === "phones" && (
                    <PhonesPanel
                      url={state?.publicUrl ?? null}
                      webMode={webMode}
                      phones={webMode ? (state?.queue ?? []) : []}
                      onLines={lines.filter((l) => l.lead?.id.startsWith("web-") && ACTIVE.includes(l.status))}
                      disabled={batchActive || busy}
                      onEnable={() => post("/api/mode", { mode: "web" })}
                    />
                  )}

                  {tab === "activity" &&
                    (state?.log.length ? (
                      <ul className="max-h-96 space-y-1.5 overflow-y-auto text-sm">
                        {state.log.map((e, i) => (
                          <li key={`${e.at}-${i}`} className="flex gap-4">
                            <span className="w-20 shrink-0 text-xs leading-5 text-gray-500 tabular-nums">
                              {new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                            </span>
                            <span className="text-gray-700">{e.msg}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty text="Nothing yet. Start dialing." />
                    ))}
                </div>
              </section>
            </div>

            {/* Call workspace */}
            <CallPanel
              line={live}
              briefs={state?.briefs ?? {}}
              now={serverNow}
              phone={preview || simulated || webMode ? "on-call" : phone}
              simulated={simulated}
              muted={muted}
              onMute={() => {
                const m = !muted;
                if (webMode) webDialer.setMuted(m);
                else callRef.current?.mute(m);
                setMuted(m);
              }}
              onHangup={() => {
                if (webMode) {
                  webDialer.hangup();
                  post("/api/hangup");
                } else if (simulated) post("/api/hangup");
                else callRef.current?.disconnect();
              }}
              onDisposition={(d, notes, callSid) => post("/api/disposition", { callSid, disposition: d, notes })}
              batchActive={batchActive}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function RepStatus({ mode, phone, onOnline }: { mode: Mode; phone: PhoneState; onOnline: () => void }) {
  if (mode !== "live") {
    return (
      <span className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-700">
        <span className={`h-2 w-2 rounded-full ${mode === "web" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
        {mode === "web" ? "Ready" : "Practice mode"}
      </span>
    );
  }
  const cfg = {
    offline: { dot: "bg-gray-400", label: "Offline" },
    connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting…" },
    ready: { dot: "bg-emerald-500", label: "Available" },
    "on-call": { dot: "bg-emerald-500", label: "On a call" },
    error: { dot: "bg-red-500", label: "Phone error" },
  }[phone];
  if (phone === "offline" || phone === "error") {
    return (
      <button onClick={onOnline} className={btnPrimary}>
        <span className={`h-2 w-2 rounded-full ${phone === "error" ? "bg-red-300" : "bg-white/70"}`} aria-hidden />
        Go online
      </button>
    );
  }
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-700">
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden />
      {cfg.label}
    </span>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: number | string; hint?: string; accent?: boolean }) {
  return (
    <div className="border-gray-200 px-4 py-3 max-sm:border-b max-sm:odd:border-r">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${accent ? "text-emerald-700" : "text-gray-900"}`}>{value}</div>
      {hint && <div className="text-[11px] text-gray-500">{hint}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-gray-500">{text}</p>;
}

function Avatar({ name, size = "md" }: { name: string; size?: "xs" | "sm" | "md" | "lg" }) {
  const s = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-9 w-9 text-xs", lg: "h-11 w-11 text-sm" }[size];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-gray-100 font-medium text-gray-600 ${s}`} aria-hidden>
      {initials(name) || "?"}
    </span>
  );
}

function OutcomeBadge({ d }: { d: Disposition }) {
  const cls =
    d === "meeting"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
      : d === "interested"
        ? "bg-blue-50 text-blue-700 ring-blue-600/20"
        : d === "callback"
          ? "bg-amber-50 text-amber-800 ring-amber-600/20"
          : "bg-gray-50 text-gray-600 ring-gray-500/20";
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{DISPO_LABEL[d]}</span>;
}

function LineRow({ line, now, brief }: { line: Line; now: number; brief?: BriefState }) {
  const st = STATUS[line.status];
  const isLive = line.status === "connected";
  const since = isLive ? line.connectedAt : line.startedAt;
  const showTimer = since && ACTIVE.includes(line.status);
  const done = ["dropped", "no-answer", "busy", "ended", "failed", "voicemail"].includes(line.status);

  return (
    <li
      aria-label={`Line ${line.index + 1}: ${st.label}`}
      className={`grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3.5 transition-colors duration-200 sm:grid-cols-[20px_minmax(0,1fr)_140px_150px_56px] ${
        isLive ? "bg-emerald-50/70 shadow-[inset_3px_0_0_0_var(--color-emerald-500)]" : ""
      }`}
    >
      <span className="text-xs text-gray-400 tabular-nums">{line.index + 1}</span>

      {line.lead ? (
        <div className={`flex min-w-0 items-center gap-3 ${done ? "opacity-60" : ""}`}>
          <Avatar name={line.lead.name} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{line.lead.name}</div>
            <div className="truncate text-xs text-gray-500">{[line.lead.title, line.lead.company].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span className="h-9 w-9 rounded-full border border-dashed border-gray-300" aria-hidden />
          Available
        </div>
      )}

      <span className="hidden truncate text-sm text-gray-500 tabular-nums sm:block">{line.lead?.phone ?? ""}</span>

      <div className="text-sm">
        <span className={`inline-flex items-center gap-1.5 font-medium ${st.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} aria-hidden />
          {st.label}
        </span>
        {line.lead && ACTIVE.includes(line.status) && brief && brief.status !== "error" && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Sparkles className={`h-3 w-3 text-indigo-500 ${brief.status === "pending" ? "animate-pulse" : ""}`} aria-hidden />
            {brief.status === "ready" ? "Brief ready" : "Researching"}
          </div>
        )}
      </div>

      <span className="hidden text-right text-sm text-gray-500 tabular-nums sm:block">{showTimer ? fmtDuration(now - since!) : ""}</span>
    </li>
  );
}

function CallPanel(props: {
  line?: Line;
  simulated?: boolean;
  briefs: Record<string, BriefState>;
  now: number;
  phone: PhoneState;
  muted: boolean;
  batchActive: boolean;
  onMute: () => void;
  onHangup: () => void;
  onDisposition: (d: Disposition, notes: string, callSid?: string) => Promise<boolean>;
}) {
  const { line } = props;
  const [notes, setNotes] = useState("");
  const [logged, setLogged] = useState<Disposition | null>(null);
  const [lastSid, setLastSid] = useState<string | undefined>();
  // Keep the last connected lead on screen after hang-up so the SDR can log the call.
  const [held, setHeld] = useState<Line | undefined>();

  if (line && line.callSid !== lastSid) {
    setLastSid(line.callSid);
    setHeld(line);
    setNotes("");
    setLogged(null);
  }
  const shown = line ?? held;

  if (!shown?.lead) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center xl:sticky xl:top-5" aria-live="polite">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-gray-100">
          <PhoneCall className="h-5 w-5 text-gray-500" aria-hidden />
        </div>
        <h2 className="mt-3 text-sm font-semibold">{props.batchActive ? "Dialing…" : "No active call"}</h2>
        <p className="mx-auto mt-1 max-w-64 text-sm text-gray-500">
          {props.batchActive
            ? "The first person to answer is connected to you. Voicemails get your recorded drop."
            : "When someone picks up, their details and an AI brief open here."}
        </p>
      </section>
    );
  }

  const lead = shown.lead;
  const isLive = !!line;
  const details: [string, string][] = [
    ["Company", lead.company],
    ["Title", lead.title],
    ["Phone", lead.phone],
    ...Object.entries(lead.context ?? {}).slice(0, 3),
  ].filter(([, v]) => v) as [string, string][];

  return (
    <section className="rounded-lg border border-gray-200 bg-white xl:sticky xl:top-5" aria-label="Current call" aria-live="polite">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${isLive ? "text-emerald-700" : "text-gray-600"}`}>
          <span className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-500" : "bg-gray-300"}`} aria-hidden />
          {isLive ? (props.simulated ? "Connected (practice)" : "Connected") : "Call ended"}
        </span>
        {isLive && shown.connectedAt && <span className="text-sm text-gray-600 tabular-nums">{fmtDuration(props.now - shown.connectedAt)}</span>}
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3">
          <Avatar name={lead.name} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{lead.name}</div>
            <div className="truncate text-sm text-gray-500">{[lead.title, lead.company].filter(Boolean).join(" at ")}</div>
          </div>
        </div>

        {isLive && props.phone === "on-call" && (
          <div className={`mt-4 grid gap-2 ${props.simulated ? "grid-cols-1" : "grid-cols-2"}`}>
            {!props.simulated && (
              <button onClick={props.onMute} aria-pressed={props.muted} className={btnSecondary}>
                {props.muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                {props.muted ? "Unmute" : "Mute"}
              </button>
            )}
            <button onClick={props.onHangup} className={`${btn} bg-red-600 text-white shadow-sm hover:bg-red-700`}>
              <PhoneOff className="h-4 w-4" aria-hidden />
              {props.simulated ? "End call" : "Hang up"}
            </button>
          </div>
        )}

        <dl className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          {details.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="truncate text-gray-900 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <BriefSection brief={props.briefs[lead.id]} company={lead.company} />

      <div className="border-t border-gray-200 p-4">
        <label htmlFor="call-notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="call-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Pain points, timeline, next steps"
          className="mt-1.5 w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        />

        <div className="mt-3 text-sm font-medium">Outcome</div>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {DISPOSITIONS.map((d) => (
            <button
              key={d.id}
              onClick={async () => {
                if (await props.onDisposition(d.id, notes, shown.callSid)) setLogged(d.id);
              }}
              aria-pressed={logged === d.id}
              className={`${btn} ${d.id === "meeting" ? "col-span-2" : ""} ${
                logged === d.id
                  ? "bg-indigo-600 text-white"
                  : d.id === "meeting"
                    ? "border border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50"
                    : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        {logged && <p className="mt-2 text-sm text-gray-600">Logged as {DISPO_LABEL[logged]}.</p>}
      </div>
    </section>
  );
}

function BriefSection({ brief, company }: { brief?: BriefState; company: string }) {
  return (
    <div className="border-t border-gray-200 bg-gray-50/60 p-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden />
          Call brief
        </span>
        <span className="text-xs text-gray-500">
          {brief?.source === "claude" ? "AI · Claude" : brief?.source === "prewritten" ? "Prewritten" : "Claude"}
        </span>
      </div>

      {!brief || brief.status === "pending" ? (
        <div className="mt-3 space-y-2" aria-label={`Researching ${company}`}>
          <div className="h-2.5 w-11/12 animate-pulse rounded bg-gray-200" />
          <div className="h-2.5 w-4/5 animate-pulse rounded bg-gray-200" />
          <div className="h-2.5 w-2/3 animate-pulse rounded bg-gray-200" />
        </div>
      ) : brief.status === "error" ? (
        <p className="mt-2 text-sm text-gray-500">{brief.error}</p>
      ) : (
        brief.brief && (
          <div className="mt-2 space-y-3 text-sm">
            <p className="text-gray-700">{brief.brief.summary}</p>
            <div>
              <div className="text-xs font-medium text-gray-500">Opener</div>
              <p className="mt-0.5 text-gray-900">&ldquo;{brief.brief.opener}&rdquo;</p>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">Likely pain points</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-700 marker:text-gray-400">
                {brief.brief.painPoints.slice(0, 3).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500">Discovery question</div>
              <p className="mt-0.5 text-gray-700">{brief.brief.question}</p>
            </div>
          </div>
        )
      )}
    </div>
  );
}

type Plan = {
  targeting?: string;
  searches: { name: string; description: string; matches: number | null; filters: Record<string, string | string[]>; cost?: string }[];
};

const EXAMPLES = ["VPs of Sales at fintech startups in San Francisco", "Heads of RevOps at SaaS companies with 50-500 employees"];

function ListBuilder({ preview, disabled, onError }: { preview: boolean; disabled: boolean; onError: (e: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState<"plan" | "pull" | null>(null);
  const [keepTest, setKeepTest] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const runPlan = async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setLoading("plan");
    setPlan(null);
    setDone(null);
    onError(null);
    try {
      const res = await fetch("/api/leads/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setPlan(data);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const pull = async (search: Plan["searches"][number]) => {
    setLoading("pull");
    onError(null);
    try {
      if (preview) {
        setDone(`Pulled ${Math.min(25, search.matches ?? 25)} leads into the queue (preview)`);
        return;
      }
      const res = await fetch("/api/leads/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: search.filters, name: search.name, limit: 25, keepTestLeads: keepTest }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Pull failed");
      setDone(`Pulled ${data.pulled} leads with phone numbers${data.cached ? " (cached, no credits used)" : ""}`);
      setPlan(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="mb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runPlan(query);
        }}
        className="flex gap-2"
      >
        <label htmlFor="icp" className="sr-only">
          Describe who to call
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            id="icp"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe who to call, e.g. VPs of Sales at fintech startups"
            className="h-9 w-full rounded-md border border-gray-300 pr-3 pl-9 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <button type="submit" disabled={!!loading || !query.trim()} className={btnSecondary}>
          {loading === "plan" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Build list
        </button>
      </form>

      {!plan && !loading && !done && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => runPlan(ex)}
              className="cursor-pointer rounded border border-gray-200 bg-white px-2 py-0.5 text-gray-600 transition-colors duration-150 hover:border-gray-300 hover:text-gray-900"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {loading === "plan" && <p className="mt-3 text-sm text-gray-500">Searching ScraperCity&apos;s lead database…</p>}

      {plan && (
        <div className="mt-3 space-y-2" aria-live="polite">
          {plan.searches.length === 0 && <p className="text-sm text-gray-500">No people searches matched. Try naming a title and an industry.</p>}
          {plan.searches.map((search) => (
            <div key={search.name} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{search.name}</div>
                  <div className="mt-0.5 text-xs text-gray-500">{search.description}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold tabular-nums">{search.matches?.toLocaleString() ?? "?"}</div>
                  <div className="text-[11px] text-gray-500">matches</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(search.filters).map(([k, v]) => (
                  <span key={k} className="max-w-full truncate rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                    <span className="text-gray-500">{k}:</span> {Array.isArray(v) ? v.join(", ") : v}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={keepTest} onChange={(e) => setKeepTest(e.target.checked)} className="accent-indigo-600" />
                  Keep my test numbers first
                </label>
                <button onClick={() => pull(search)} disabled={!!loading || disabled} className={btnPrimary}>
                  {loading === "pull" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Add {Math.min(25, search.matches ?? 25)} to queue
                </button>
              </div>
              {search.cost && <p className="mt-2 text-[11px] text-gray-500">{search.cost}</p>}
            </div>
          ))}
        </div>
      )}

      {done && (
        <p className="mt-3 text-sm text-emerald-700" aria-live="polite">
          {done}
        </p>
      )}
    </div>
  );
}

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: "live", label: "Live", title: "Real phone numbers through Twilio" },
  { id: "web", label: "Web phones", title: "Real voice calls to phones that open the /phone link" },
  { id: "sim", label: "Practice", title: "Simulated call network" },
];

function ModeSwitch({ mode, disabled, onChange }: { mode: Mode; disabled: boolean; onChange: (m: Mode) => void }) {
  return (
    <div role="radiogroup" aria-label="Call mode" className="flex items-center rounded-md bg-gray-100 p-0.5">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          disabled={disabled}
          title={m.title}
          onClick={() => mode !== m.id && onChange(m.id)}
          className={`h-8 cursor-pointer rounded px-2.5 text-sm transition-colors duration-150 disabled:cursor-not-allowed ${focus} ${
            mode === m.id ? "bg-white font-medium text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function PhonesPanel(props: {
  url: string | null;
  webMode: boolean;
  phones: Lead[];
  onLines: Line[];
  disabled: boolean;
  onEnable: () => void;
}) {
  const link = props.url ? `${props.url.replace(/\/$/, "")}/phone` : null;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!link) return;
    let alive = true;
    import("qrcode")
      .then((QR) => QR.toDataURL(link, { margin: 1, width: 480, color: { dark: "#111827", light: "#ffffff" } }))
      .then((d) => alive && setQr(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [link]);

  if (!props.webMode) {
    return (
      <div className="py-8 text-center">
        <Smartphone className="mx-auto h-6 w-6 text-gray-400" aria-hidden />
        <p className="mt-2 text-sm font-medium">Call real phones from the browser</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
          Switch to Web phones mode, then anyone who scans the QR code becomes a lead and their phone rings when you dial.
        </p>
        <button onClick={props.onEnable} disabled={props.disabled} className={`${btnPrimary} mt-4`}>
          Switch to Web phones
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
      <div className="flex flex-col items-center">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL QR code
          <img src={qr} alt="QR code for the phone link" width={240} height={240} className="h-60 w-60 rounded-md border border-gray-200 bg-white p-2" />
        ) : (
          <div className="grid h-60 w-60 place-items-center rounded-md border border-gray-200 bg-white">
            <Smartphone className="h-8 w-8 text-gray-400" aria-hidden />
          </div>
        )}
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="mt-2 max-w-60 truncate text-xs text-indigo-600 hover:underline">
            {link}
          </a>
        ) : (
          <p className="mt-2 max-w-60 text-center text-xs text-amber-700">Set PUBLIC_URL (your ngrok URL) so phones can reach this app.</p>
        )}
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Add a phone</h3>
        <ol className="mt-2 space-y-1.5 text-sm text-gray-600">
          {["Scan the code with the phone's camera.", "Enter a name and tap Get ready.", "Keep the page open. It rings when you dial."].map((t, i) => (
            <li key={t} className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>

        <h3 className="mt-6 text-sm font-semibold">
          Connected phones <span className="font-normal text-gray-500">({props.phones.length + props.onLines.length})</span>
        </h3>
        {props.phones.length + props.onLines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">None yet. Phones appear here a second after they tap Get ready.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
            {[
              ...props.onLines.map((l) => ({ lead: l.lead!, status: `On line ${l.index + 1}` })),
              ...props.phones.map((lead) => ({ lead, status: "Waiting" })),
            ].map(({ lead, status }) => (
              <li key={lead.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={lead.name} size="xs" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{lead.name}</div>
                  {(lead.title || lead.company) && (
                    <div className="truncate text-xs text-gray-500">{[lead.title, lead.company].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                  {status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
