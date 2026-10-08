"use client";

import { useSyncExternalStore } from "react";
import { Meteors } from "@/components/magicui/meteors";

const KEY = "gamenight:ambient-motion";
const EVENT = "gamenight:ambient-motion-change";
function preference() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
function subscribe(onChange: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = matchMedia("(min-width: 768px)");
  const update = () => {
    document.documentElement.dataset.ambientMotion = preference() && !media.matches && !document.hidden ? "on" : "off";
    onChange();
  };
  update();
  media.addEventListener("change", update);
  desktop.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  window.addEventListener("storage", update);
  window.addEventListener(EVENT, update);
  return () => {
    media.removeEventListener("change", update);
    desktop.removeEventListener("change", update);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("storage", update);
    window.removeEventListener(EVENT, update);
  };
}
const pausedOnServer = () => false;
const serverPreference = () => true;
function animated() {
  return preference() && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches && matchMedia("(min-width: 768px)").matches;
}

export function MotionBackground() {
  const active = useSyncExternalStore(subscribe, animated, pausedOnServer);
  return <div className="gn-ambient" aria-hidden="true">
    <div className="gn-aurora gn-aurora-one" /><div className="gn-aurora gn-aurora-two" />
    <div className="gn-aurora gn-aurora-three" />
    <div className="gn-star-grid" />
    <svg className="gn-constellations" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
      <g stroke="currentColor" strokeWidth="1">
        <path d="m1080 100 95 80 140-35 95 160-145 75M1175 180l90 200 145-75M120 500l100 110-60 125 180 90 100-60M220 610l120 215" />
        <ellipse cx="1250" cy="220" rx="260" ry="135" transform="rotate(-28 1250 220)" strokeDasharray="3 14" />
      </g>
      <g fill="currentColor">
        <circle cx="1080" cy="100" r="3" /><circle cx="1175" cy="180" r="4" /><circle cx="1315" cy="145" r="3" /><circle cx="1410" cy="305" r="4" /><circle cx="1265" cy="380" r="3" />
        <circle cx="120" cy="500" r="3" /><circle cx="220" cy="610" r="4" /><circle cx="160" cy="735" r="3" /><circle cx="340" cy="825" r="4" /><circle cx="440" cy="765" r="3" />
      </g>
    </svg>
    {active && <Meteors number={7} minDuration={8} maxDuration={18} className="opacity-60" />}
  </div>;
}

export function MotionToggle() {
  const enabled = useSyncExternalStore(subscribe, preference, serverPreference);
  return <button type="button" className="gn-nav-link w-full text-left" aria-pressed={enabled} onClick={() => {
    try { localStorage.setItem(KEY, enabled ? "off" : "on"); }
    catch { return; } // Stockage désactivé : la préférence système reste appliquée.
    window.dispatchEvent(new Event(EVENT));
  }}><span aria-hidden="true">✦</span>Animations {enabled ? "activées" : "en pause"}</button>;
}
