"use client";

import { useEffect, useRef } from "react";
import type { Line } from "@/lib/types";

// Call sounds synthesized with Web Audio (no audio files). The AudioContext must be
// unlocked by a user gesture, so call unlockAudio() from a click handler (e.g. "Dial next 3").

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // Audio not available: the app works silently.
  }
}

function tone(freqs: number[], start: number, duration: number, volume = 0.06) {
  if (!ctx) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + duration - 0.03);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  gain.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + duration);
  }
}

/** One US ringback cycle: 440 + 480 Hz, 2 s on (the 4 s off is the interval gap). */
function ringOnce() {
  if (ctx) tone([440, 480], ctx.currentTime, 2, 0.05);
}

function connectChime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone([660], t, 0.12, 0.07);
  tone([880], t + 0.13, 0.18, 0.07);
}

function voicemailBeep() {
  if (ctx) tone([1000], ctx.currentTime, 0.25, 0.04);
}

function sayHello(name?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const first = name?.split(" ")[0] ?? "";
  const u = new SpeechSynthesisUtterance(first ? `Hello? This is ${first}.` : "Hello?");
  u.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** Plays ringback while lines ring, a chime on connect and a beep on voicemail drop. */
export function useCallSounds(lines: Line[], opts: { enabled: boolean; simulated: boolean }) {
  const prev = useRef<Record<number, string>>({});
  const ringTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const ringing = lines.some((l) => l.status === "dialing" || l.status === "ringing");
  const connected = lines.some((l) => l.status === "connected");
  const shouldRing = opts.enabled && ringing && !connected;

  // Ringback loop: 2 s tone every 6 s.
  useEffect(() => {
    if (!shouldRing) return;
    ringOnce();
    ringTimer.current = setInterval(ringOnce, 6000);
    return () => {
      if (ringTimer.current) clearInterval(ringTimer.current);
      ringTimer.current = null;
    };
  }, [shouldRing]);

  // One-shot sounds on status transitions.
  useEffect(() => {
    for (const l of lines) {
      const before = prev.current[l.index];
      if (before !== undefined && before !== l.status && opts.enabled) {
        if (l.status === "connected") {
          connectChime();
          if (opts.simulated) setTimeout(() => sayHello(l.lead?.name), 450);
        } else if (l.status === "voicemail") {
          voicemailBeep();
        }
      }
      prev.current[l.index] = l.status;
    }
  }, [lines, opts.enabled, opts.simulated]);
}
