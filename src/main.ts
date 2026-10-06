import { LogicalPosition } from "@tauri-apps/api/dpi";
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { messages } from "./messages";

type Mode = "idle" | "walk" | "sleep" | "held" | "fall" | "dizzy";

// Must match the window size in tauri.conf.json.
const WIN_W = 240;
const WIN_H = 280;
// How far the window may hang off the screen so the pal can reach the edges.
const EDGE_PAD = 20;
const WALK_SPEED = 45;
const GRAVITY = 2400;
const HARD_LANDING = 900;
// Minutes between unprompted remarks.
const CHAT_MIN = 4;
const CHAT_MAX = 9;

const win = getCurrentWindow();
const pal = document.querySelector<HTMLElement>("#pal")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
const menu = document.querySelector<HTMLElement>("#menu")!;
const fx = document.querySelector<HTMLElement>("#fx")!;

// ---------- "not today" ----------

function dayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function snoozed(): boolean {
  return localStorage.getItem("pal-snoozed") === dayKey();
}

// ---------- talking ----------

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

let bubbleTimer = 0;
let menuTimer = 0;
let nextChatAt = Date.now() + rand(CHAT_MIN, CHAT_MAX) * 60_000;

function say(text: string) {
  closeMenu();
  bubble.textContent = text;
  bubble.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(
    () => (bubble.hidden = true),
    Math.max(3500, text.length * 90),
  );
}

function pickLine(): string {
  if (new Date().getHours() < 5) return pick(messages.bedtime);
  if (snoozed() || Math.random() < 0.5) return pick(messages.care);
  return pick(messages.nag);
}

function chatter() {
  const busy: Mode[] = ["held", "fall", "dizzy"];
  if (busy.includes(mode)) {
    nextChatAt = Date.now() + 20_000;
    return;
  }
  nextChatAt = Date.now() + rand(CHAT_MIN, CHAT_MAX) * 60_000;
  if (mode !== "sleep") say(pickLine());
}

function openMenu() {
  bubble.hidden = true;
  menu.hidden = false;
  clearTimeout(menuTimer);
  menuTimer = window.setTimeout(closeMenu, 8000);
}

function closeMenu() {
  menu.hidden = true;
  clearTimeout(menuTimer);
}

// ---------- sparkle ----------

function hearts() {
  for (let i = 0; i < 3; i++) {
    const el = document.createElement("span");
    el.className = "heart";
    el.textContent = "♥";
    el.style.setProperty("--dx", `${rand(-100, 100)}px`);
    el.style.setProperty("--dy", `${rand(-150, -40)}px`);
    el.style.setProperty("--rot", `${rand(-360, 360)}deg`);
    fx.append(el);
    el.addEventListener("animationend", () => el.remove());
  }
}

// ---------- moving around ----------

let mode: Mode = "idle";
let modeUntil = 0;
let x = 0;
let y = 0;
let vx = 0;
let vy = 0;
let dir = 1;
let targetX = 0;
let scale = 1;
let bounds = { left: 0, right: 0, floor: 0 };
let placedX = NaN;
let placedY = NaN;

function setMode(next: Mode, seconds = 0) {
  mode = next;
  modeUntil = Date.now() + seconds * 1000;
  pal.dataset.mode = next;
}

function face_(direction: number) {
  dir = direction;
  pal.style.setProperty("--dir", String(dir));
}

async function refreshBounds() {
  const monitor = await currentMonitor();
  if (!monitor) return;
  scale = monitor.scaleFactor;
  const { position, size } = monitor.workArea;
  bounds = {
    left: position.x / scale - EDGE_PAD,
    right: (position.x + size.width) / scale - WIN_W + EDGE_PAD,
    floor: (position.y + size.height) / scale - WIN_H,
  };
}

function place() {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px === placedX && py === placedY) return;
  placedX = px;
  placedY = py;
  win.setPosition(new LogicalPosition(px, py));
}

function nextBehaviour() {
  if (mode !== "idle") {
    setMode("idle", rand(2, 5));
    return;
  }
  const hour = new Date().getHours();
  const sleepy = hour >= 23 || hour < 6 || snoozed();
  const roll = Math.random();
  if (roll < (sleepy ? 0.4 : 0.12)) {
    setMode("sleep", rand(25, 70));
  } else if (roll < 0.8) {
    targetX = rand(bounds.left, bounds.right);
    face_(targetX > x ? 1 : -1);
    setMode("walk");
  } else {
    setMode("idle", rand(3, 8));
  }
}

function fall(dt: number) {
  vy += GRAVITY * dt;
  x += vx * dt;
  y += vy * dt;
  if (x < bounds.left || x > bounds.right) {
    x = Math.min(Math.max(x, bounds.left), bounds.right);
    vx *= -0.5;
  }
  if (y < bounds.floor) return;
  y = bounds.floor;
  const impact = vy;
  vx = 0;
  vy = 0;
  if (impact > HARD_LANDING) {
    setMode("dizzy", 2.5);
    say(pick(messages.dizzy));
  } else {
    setMode("idle", rand(2, 4));
  }
}

let lastFrame = performance.now();

function frame(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (mode === "held") {
    followCursor();
  } else if (mode === "fall") {
    fall(dt);
  } else if (mode === "walk") {
    x += dir * WALK_SPEED * dt;
    if ((dir > 0 && x >= targetX) || (dir < 0 && x <= targetX)) {
      setMode("idle", rand(2, 6));
    }
  } else if (Date.now() >= modeUntil) {
    nextBehaviour();
  }

  place();
  if (Date.now() >= nextChatAt) chatter();
  requestAnimationFrame(frame);
}

// ---------- being picked up ----------

let pressed: { id: number; x: number; y: number } | null = null;
let cursorBusy = false;
let heldAt = 0;

function followCursor() {
  if (cursorBusy || !pressed) return;
  cursorBusy = true;
  const grab = pressed;
  cursorPosition()
    .then((p) => {
      if (mode !== "held") return;
      const now = performance.now();
      const nx = p.x / scale - grab.x;
      const ny = p.y / scale - grab.y;
      const dt = (now - heldAt) / 1000;
      if (dt > 0) {
        vx = 0.6 * vx + (0.4 * (nx - x)) / dt;
        vy = 0.6 * vy + (0.4 * (ny - y)) / dt;
      }
      x = nx;
      y = ny;
      heldAt = now;
    })
    .finally(() => (cursorBusy = false));
}

pal.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pal.setPointerCapture(e.pointerId);
  pressed = { id: e.pointerId, x: e.clientX, y: e.clientY };
});

pal.addEventListener("pointermove", (e) => {
  if (!pressed || mode === "held") return;
  if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) return;
  closeMenu();
  vx = 0;
  vy = 0;
  heldAt = performance.now();
  setMode("held");
});

async function release() {
  if (!pressed) return;
  pressed = null;
  if (mode !== "held") {
    pet();
    return;
  }
  const clamp = (v: number) => Math.min(Math.max(v, -2500), 2500);
  vx = clamp(vx);
  vy = clamp(vy);
  // She may have carried it to another screen.
  await refreshBounds();
  setMode("fall");
}

pal.addEventListener("pointerup", release);
pal.addEventListener("pointercancel", release);

function pet() {
  hearts();
  if (mode === "sleep") {
    setMode("idle", rand(3, 6));
    say(pick(messages.wake));
  } else if (Math.random() < 0.35) {
    say(pick(messages.pet));
  }
}

// ---------- the menu ----------

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!pal.contains(e.target as Node)) return;
  if (menu.hidden) openMenu();
  else closeMenu();
});

function snooze() {
  localStorage.setItem("pal-snoozed", dayKey());
  say(pick(messages.snooze));
  setMode("sleep", rand(40, 80));
}

function quit() {
  say(pick(messages.bye));
  window.setTimeout(() => win.close(), 1500);
}

const actions: Record<string, () => void> = { snooze, quit };

menu.addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).dataset.action;
  if (!action) return;
  closeMenu();
  actions[action]?.();
});

// ---------- go ----------

async function start() {
  await refreshBounds();
  // Drop in from above the floor.
  x = rand(bounds.left, bounds.right);
  y = bounds.floor - 260;
  place();
  await win.show();
  setMode("fall");
  window.setTimeout(() => say(pick(messages.hello)), 1200);
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

start();
