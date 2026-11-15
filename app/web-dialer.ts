"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MediaConnection, Peer as PeerType } from "peerjs";
import type { Line } from "@/lib/types";

// Dashboard side of web phone mode: places WebRTC calls (PeerJS) to phones that opened /phone,
// in parallel. The server decides who wins (same claimHuman logic as Twilio calls).

const RING_TIMEOUT_MS = 25_000;
const ACTIVE = ["dialing", "ringing", "detecting", "connected"];

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => null);

export type WebTarget = { callSid: string; peerId: string };

export function useWebDialer(lines: Line[], opts: { enabled: boolean; sdrName: string; onError: (e: string) => void }) {
  const peerRef = useRef<PeerType | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const calls = useRef(new Map<string, MediaConnection>()); // callSid -> call
  const winner = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onErrorRef.current = opts.onError;
  });

  const closeCall = useCallback((sid: string) => {
    calls.current.get(sid)?.close();
    calls.current.delete(sid);
  }, []);

  /** Mic + signaling connection. Call from a click (browsers require a gesture for the mic). */
  const prepare = useCallback(async () => {
    micRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    if (peerRef.current && !peerRef.current.destroyed && peerRef.current.open) return;
    const { Peer } = await import("peerjs");
    const peer = new Peer(`pd-sdr-${Math.random().toString(36).slice(2, 10)}`);
    peerRef.current = peer;
    peer.on("error", (e) => {
      // Unreachable phone: fail just that line.
      if (e.type === "peer-unavailable") {
        const id = /pd-lead-[a-z0-9]+/.exec(String(e.message))?.[0];
        for (const [sid, c] of calls.current) {
          if (c.peer === id) {
            post("/api/web/event", { callSid: sid, event: "failed", detail: "phone offline" });
            calls.current.delete(sid);
          }
        }
      } else {
        onErrorRef.current(`Web phone connection: ${e.type}`);
      }
    });
    await new Promise<void>((resolve, reject) => {
      peer.once("open", () => resolve());
      setTimeout(() => reject(new Error("Couldn't reach the PeerJS signaling server")), 8000);
    });
  }, []);

  const dial = useCallback(
    (targets: WebTarget[]) => {
      const peer = peerRef.current;
      const mic = micRef.current;
      if (!peer || !mic) return;
      winner.current = null;
      for (const { callSid, peerId } of targets) {
        const call = peer.call(peerId, mic, { metadata: { callSid, from: opts.sdrName } });
        if (!call) {
          post("/api/web/event", { callSid, event: "failed", detail: "could not start call" });
          continue;
        }
        calls.current.set(callSid, call);
        setTimeout(() => post("/api/web/event", { callSid, event: "ringing" }), 700);
        const timeout = setTimeout(() => {
          if (calls.current.has(callSid) && winner.current !== callSid) {
            post("/api/web/event", { callSid, event: "no-answer" });
            closeCall(callSid);
          }
        }, RING_TIMEOUT_MS);

        let answered = false;
        call.on("stream", async (remote) => {
          if (answered) return; // 'stream' can fire once per track
          answered = true;
          clearTimeout(timeout);
          const r = await post("/api/web/event", { callSid, event: "answered" });
          if (r?.won) {
            winner.current = callSid;
            audioRef.current ??= new Audio();
            audioRef.current.srcObject = remote;
            void audioRef.current.play().catch(() => {});
          } else {
            closeCall(callSid); // someone else got the rep first; their phone shows "will call you back"
          }
        });
        call.on("close", () => {
          clearTimeout(timeout);
          if (winner.current === callSid) {
            post("/api/web/event", { callSid, event: "ended" });
            winner.current = null;
          }
          calls.current.delete(callSid);
        });
      }
    },
    [opts.sdrName, closeCall],
  );

  /** Close calls whose line the server already finished (declined, released, ended). */
  useEffect(() => {
    if (!opts.enabled) return;
    for (const l of lines) {
      if (l.callSid && calls.current.has(l.callSid) && !ACTIVE.includes(l.status)) closeCall(l.callSid);
    }
  }, [lines, opts.enabled, closeCall]);

  const hangup = useCallback(() => {
    for (const sid of [...calls.current.keys()]) closeCall(sid);
    winner.current = null;
  }, [closeCall]);

  const setMuted = useCallback((muted: boolean) => {
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, []);

  useEffect(() => {
    const live = calls.current;
    return () => {
      for (const c of live.values()) c.close();
      live.clear();
      peerRef.current?.destroy();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { prepare, dial, hangup, setMuted };
}
