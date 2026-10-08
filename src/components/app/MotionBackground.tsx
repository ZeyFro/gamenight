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
    <div className="gn-star-grid" />
    {active && <Meteors number={7} minDuration={6} maxDuration={14} className="opacity-30" />}
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
