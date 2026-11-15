"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaConnection, Peer as PeerType } from "peerjs";
import { Phone, PhoneOff, Voicemail, Zap } from "lucide-react";

// A phone that opens this page becomes a lead. The dashboard calls it over WebRTC (PeerJS):
// it rings here for real, and answering opens a two-way voice call with the rep.

type Screen = "setup" | "connecting" | "ready" | "ringing" | "in-call" | "voicemail" | "notice";

let ctx: AudioContext | null = null;
function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {}
}
function ringBurst() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const start of [0, 0.5]) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + start);
    g.gain.linearRampToValueAtTime(0.25, t + start + 0.02);
    g.gain.setValueAtTime(0.25, t + start + 0.38);
    g.gain.linearRampToValueAtTime(0, t + start + 0.4);
    g.connect(ctx.destination);
    for (const f of [440, 480]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(t + start);
      o.stop(t + start + 0.4);
    }
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function WebPhone() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [caller, setCaller] = useState("Your rep");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [callStart, setCallStart] = useState(0);
  const [now, setNow] = useState(0);

  const peerRef = useRef<PeerType | null>(null);
  const peerIdRef = useRef("");
  const micRef = useRef<MediaStream | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const callSidRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenRef = useRef<Screen>("setup");
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  const stopRinging = () => {
    if (ringTimer.current) clearInterval(ringTimer.current);
    ringTimer.current = null;
    navigator.vibrate?.(0);
  };

  const endLocal = (message: string) => {
    stopRinging();
    callRef.current?.close();
    callRef.current = null;
    setNotice(message);
    setScreen("notice");
    setTimeout(() => screenRef.current === "notice" && setScreen("ready"), 6000);
  };

  // Heartbeat so the dashboard keeps this phone in its queue.
  useEffect(() => {
    if (screen === "setup" || screen === "connecting") return;
    const beat = () => post("/api/web/register", { peerId: peerIdRef.current, name, company, title });
    const id = setInterval(beat, 8000);
    return () => clearInterval(id);
  }, [screen, name, company, title]);

  // While in a call, learn whether we were released (another lead won) or the rep hung up.
  useEffect(() => {
    if (screen !== "in-call") return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/web/phone?peerId=${peerIdRef.current}`).then((x) => x.json()).catch(() => null);
      if (!r || r.callSid !== callSidRef.current) return;
      if (r.status === "dropped") endLocal(`${caller} just connected with someone else and will call you back.`);
      else if (r.status === "ended") endLocal("Call ended");
    }, 1000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, caller]);

  useEffect(
    () => () => {
      stopRinging();
      peerRef.current?.destroy();
      micRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const getReady = async () => {
    if (!name.trim()) return setError("Enter your name so the rep knows who they're calling");
    setError(null);
    unlockAudio();
    setScreen("connecting");
    try {
      // Ask for the mic now so answering is instant later.
      micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      navigator.wakeLock?.request?.("screen").catch(() => {});
      const { Peer } = await import("peerjs");
      const id = `pd-lead-${Math.random().toString(36).slice(2, 10)}`;
      peerIdRef.current = id;
      const peer = new Peer(id);
      peerRef.current = peer;
      peer.on("open", async () => {
        await post("/api/web/register", { peerId: id, name, company, title });
        setScreen("ready");
      });
      peer.on("error", (e) => {
        setError(`Connection problem: ${e.type}. Reload the page to try again.`);
      });
      peer.on("call", (call) => {
        if (screenRef.current !== "ready" && screenRef.current !== "notice") {
          call.close();
          return;
        }
        callRef.current = call;
        callSidRef.current = String(call.metadata?.callSid ?? "");
        setCaller(String(call.metadata?.from ?? "Your rep"));
        call.on("close", () => {
          if (screenRef.current === "in-call") endLocal("Call ended");
          else if (screenRef.current === "ringing") endLocal("Missed call");
        });
        setScreen("ringing");
        ringBurst();
        navigator.vibrate?.([400, 200, 400]);
        ringTimer.current = setInterval(() => {
          ringBurst();
          navigator.vibrate?.([400, 200, 400]);
        }, 2500);
      });
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access is needed to take calls. Allow it and try again."
          : (e as Error).message,
      );
      setScreen("setup");
    }
  };

  const answer = () => {
    const call = callRef.current;
    if (!call || !micRef.current) return;
    stopRinging();
    unlockAudio();
    call.answer(micRef.current);
    call.on("stream", (remote) => {
      if (audioRef.current) {
        audioRef.current.srcObject = remote;
        void audioRef.current.play().catch(() => {});
      }
    });
    setCallStart(Date.now());
    setNow(Date.now());
    setScreen("in-call");
  };

  const decline = () => {
    stopRinging();
    callRef.current?.close();
    callRef.current = null;
    post("/api/web/event", { callSid: callSidRef.current, event: "declined" });
    setScreen("voicemail");
    // The voicemail drop lands on this phone.
    const vm = new Audio("/voicemail.mp3");
    vm.play().catch(() => {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(
          `Hey ${name.split(" ")[0]}, it's ${caller}. Sorry I missed you. I had a quick idea for ${company || "your team"}. I'll try you again soon.`,
        );
        window.speechSynthesis.speak(u);
      }
    });
  };

  const hangUp = () => {
    post("/api/web/event", { callSid: callSidRef.current, event: "ended" });
    endLocal("Call ended");
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#070b14] px-6 py-10 text-slate-100">
      <audio ref={audioRef} autoPlay playsInline />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2 text-sm font-medium text-slate-400">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600">
            <Zap className="h-4 w-4 text-white" aria-hidden />
          </span>
          Parallel Dialer · web phone
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        {(screen === "setup" || screen === "connecting") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              getReady();
            }}
            className="space-y-4"
          >
            <h1 className="text-center text-2xl font-semibold">Become a lead</h1>
            <p className="text-center text-sm text-slate-400">
              Your phone will ring when the rep dials. Keep this screen open.
            </p>
            {[
              { id: "name", label: "Your name", value: name, set: setName, required: true, auto: "name" },
              { id: "company", label: "Company (optional)", value: company, set: setCompany, auto: "organization" },
              { id: "title", label: "Title (optional)", value: title, set: setTitle, auto: "organization-title" },
            ].map((f) => (
              <div key={f.id}>
                <label htmlFor={f.id} className="mb-1.5 block text-sm font-medium text-slate-300">
                  {f.label}
                </label>
                <input
                  id={f.id}
                  value={f.value}
                  required={f.required}
                  autoComplete={f.auto}
                  onChange={(e) => f.set(e.target.value)}
                  className="h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base text-white focus:border-sky-500 focus:outline-none"
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={screen === "connecting"}
              className="h-12 w-full cursor-pointer rounded-lg bg-blue-600 text-base font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              {screen === "connecting" ? "Connecting…" : "Get ready"}
            </button>
          </form>
        )}

        {screen === "ready" && (
          <div className="text-center">
            <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
              <Phone className="h-8 w-8" aria-hidden />
            </div>
            <h1 className="mt-5 text-2xl font-semibold">You&apos;re in the queue</h1>
            <p className="mt-2 text-slate-400">
              {name}
              {company ? ` · ${company}` : ""}
            </p>
            <p className="mt-6 text-sm text-slate-400">Keep this screen open with the volume up. It will ring here.</p>
          </div>
        )}

        {screen === "ringing" && (
          <div className="text-center">
            <p className="text-sm tracking-wider text-slate-400 uppercase">Incoming call</p>
            <div className="ring-pulse relative mx-auto mt-6 grid h-24 w-24 place-items-center rounded-full bg-sky-500/20 text-sky-300">
              <Phone className="h-10 w-10" aria-hidden />
            </div>
            <h1 className="mt-6 text-3xl font-semibold">{caller}</h1>
            <p className="mt-1 text-slate-400">Parallel Dialer</p>
            <div className="mt-12 grid grid-cols-2 gap-6">
              <button
                onClick={decline}
                className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-full bg-red-600 text-base font-semibold text-white"
              >
                <PhoneOff className="h-5 w-5" aria-hidden /> Decline
              </button>
              <button
                onClick={answer}
                className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-full bg-emerald-500 text-base font-semibold text-emerald-950"
              >
                <Phone className="h-5 w-5" aria-hidden /> Answer
              </button>
            </div>
          </div>
        )}

        {screen === "in-call" && (
          <div className="text-center">
            <p className="text-sm tracking-wider text-emerald-300 uppercase">On a call</p>
            <h1 className="mt-6 text-3xl font-semibold">{caller}</h1>
            <p className="mt-2 font-mono text-lg text-slate-300 tabular-nums">{fmt(now - callStart)}</p>
            <button
              onClick={hangUp}
              className="mx-auto mt-14 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-red-600 text-white"
              aria-label="Hang up"
            >
              <PhoneOff className="h-6 w-6" aria-hidden />
            </button>
          </div>
        )}

        {screen === "voicemail" && (
          <div className="text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-violet-500/15 text-violet-300">
              <Voicemail className="h-8 w-8" aria-hidden />
            </div>
            <h1 className="mt-5 text-2xl font-semibold">New voicemail</h1>
            <p className="mt-2 text-slate-400">From {caller}. Playing now.</p>
            <button
              onClick={() => setScreen("ready")}
              className="mt-8 h-12 w-full cursor-pointer rounded-lg border border-slate-700 text-base text-slate-200"
            >
              Back to queue
            </button>
          </div>
        )}

        {screen === "notice" && (
          <div className="text-center">
            <h1 className="text-2xl font-semibold">{notice}</h1>
            <p className="mt-3 text-sm text-slate-400">You&apos;re still in the queue.</p>
          </div>
        )}
      </div>
    </main>
  );
}
