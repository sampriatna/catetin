// lib/notificationSound.js — bunyi peringatan in-app (Web Audio, tanpa file eksternal)

let ctx = null;

export function unlockNotificationAudio() {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    /* ignore */
  }
}

function tone(freq, start, dur, vol = 0.16) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now + start);
  gain.gain.setValueAtTime(0, now + start);
  gain.gain.linearRampToValueAtTime(vol, now + start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now + start);
  osc.stop(now + start + dur + 0.04);
}

/** Chime pendek — permintaan revisi laporan omset (kasir). */
export function playRevisionAlertSound() {
  unlockNotificationAudio();
  if (!ctx) return;
  try {
    tone(880, 0, 0.16, 0.18);
    tone(660, 0.2, 0.2, 0.2);
    tone(880, 0.46, 0.22, 0.16);
    vibrateUrgent();
  } catch {
    /* ignore */
  }
}

/** Ping singkat — notifikasi operasional lainnya. */
export function playNotificationPing() {
  unlockNotificationAudio();
  if (!ctx) return;
  try {
    tone(740, 0, 0.12, 0.14);
    tone(880, 0.14, 0.16, 0.12);
    vibrateUrgent();
  } catch {
    /* ignore */
  }
}

function vibrateUrgent() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate([120, 60, 120, 60, 160]);
  }
}

/** Berhasil — "ting" naik, lembut. */
export function playSuccessSound() {
  unlockNotificationAudio();
  if (!ctx) return;
  try {
    tone(1047, 0, 0.12, 0.12);
    tone(1319, 0.1, 0.22, 0.12);
  } catch {
    /* ignore */
  }
}

/** Gagal — dua nada rendah & tegas + getar. */
export function playErrorSound() {
  unlockNotificationAudio();
  if (!ctx) return;
  try {
    tone(330, 0, 0.18, 0.22);
    tone(247, 0.22, 0.3, 0.22);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([200, 80, 200]);
  } catch {
    /* ignore */
  }
}
