"use client";

// Cicilan PayLater — daftar rencana, jadwal, bayar cicilan, buat rencana (manual / screenshot).
// Data lewat /api/cicilan (FNB & Fishing berbagi satu akun PayLater).

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCicilan, postCicilan } from "../lib/repo.js";
import { aiParse } from "../lib/appState.js";
import {
  analyzeTenorOptions,
  buildJadwal,
  cicilanOverview,
  normalizeScreenshotParse,
  planSummary,
} from "../lib/cicilan.js";

function todayWib() {
  try {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function nextMonth(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const money = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(n) || 0);

const pct = (x) => `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

function shortDate(v) {
  if (!v) return "—";
  const [y, m, d] = String(v).slice(0, 10).split("-");
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][Number(m) - 1];
  return `${Number(d)} ${bln} ${y}`;
}

const digits = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const S = {
  pad: { padding: "16px" },
  card: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 700, color: "var(--ink2, var(--ink))", marginBottom: 6, display: "block" },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 15 },
  btn: { width: "100%", padding: "13px 14px", borderRadius: 12, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  btnGhost: { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  muted: { fontSize: 12, color: "var(--ink3)" },
  err: { background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 },
  ok: { background: "#ECFDF5", color: "#047857", border: "1px solid #A7F3D0", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 },
};

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <span style={S.label}>{label}</span>
      {children}
      {hint && <div style={{ ...S.muted, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder }) {
  return (
    <input
      style={S.input}
      inputMode="numeric"
      placeholder={placeholder}
      value={value ? new Intl.NumberFormat("id-ID").format(value) : ""}
      onChange={(e) => onChange(digits(e.target.value))}
    />
  );
}

function StatusBadge({ plan, sum }) {
  let text = "Berjalan";
  let bg = "#EEF2FF";
  let color = "#4338CA";
  if (plan.status === "lunas") { text = "Lunas"; bg = "#ECFDF5"; color = "#047857"; }
  else if (plan.status === "batal") { text = "Batal"; bg = "#F3F4F6"; color = "#6B7280"; }
  else if (sum.overdue) { text = "Terlambat"; bg = "#FEF2F2"; color = "#B91C1C"; }
  else if (sum.dueSoon) { text = sum.daysToDue === 0 ? "Jatuh tempo hari ini" : `H-${sum.daysToDue}`; bg = "#FEF3C7"; color = "#B45309"; }
  return <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 99, background: bg, color, whiteSpace: "nowrap" }}>{text}</span>;
}

// ── Daftar ──────────────────────────────────────────────────────────────────

function PlanList({ data, onOpen, onCreate }) {
  const today = todayWib();
  const ov = cicilanOverview(data.plans, today);
  const others = data.plans.filter((p) => p.status !== "berjalan");
  const debt = data.paylater.balance < 0 ? -data.paylater.balance : 0;
  return (
    <div style={S.pad}>
      <div style={{ ...S.card, background: "linear-gradient(135deg,#B45309,#92400E)", color: "#fff", border: "none" }}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>Hutang {data.paylater.name}</div>
        <div className="money" style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(debt)}</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, opacity: 0.9, gap: 8 }}>
          <span>{ov.activeCount} cicilan berjalan</span>
          <span>Sisa tagihan {money(ov.sisaBayar)}</span>
        </div>
      </div>

      <button style={{ ...S.btn, marginBottom: 16 }} onClick={onCreate}>+ Buat rencana cicilan</button>

      {ov.items.length === 0 && (
        <div style={{ ...S.card, textAlign: "center", ...S.muted }}>Belum ada cicilan berjalan.</div>
      )}
      {ov.items.map(({ plan, sum }) => (
        <PlanRow key={plan.id} plan={plan} sum={sum} onOpen={() => onOpen(plan.id)} />
      ))}

      {others.length > 0 && (
        <>
          <div style={{ ...S.muted, fontWeight: 700, margin: "18px 0 8px" }}>Selesai / dibatalkan</div>
          {others.map((plan) => (
            <PlanRow key={plan.id} plan={plan} sum={planSummary(plan, today)} onOpen={() => onOpen(plan.id)} />
          ))}
        </>
      )}
    </div>
  );
}

function PlanRow({ plan, sum, onOpen }) {
  const progress = sum.tenor ? sum.paidCount / sum.tenor : 0;
  return (
    <button onClick={onOpen} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer", display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontWeight: 800, color: "var(--ink)", fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{plan.label}</div>
        <StatusBadge plan={plan} sum={sum} />
      </div>
      <div style={{ ...S.muted, marginTop: 4 }}>
        {money(plan.perBulan)} × {plan.tenor} bln{plan.totalBunga > 0 ? ` · bunga ${money(plan.totalBunga)}` : " · 0%"}
      </div>
      <div style={{ height: 6, borderRadius: 99, background: "var(--surface2)", marginTop: 10, overflow: "hidden" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", background: plan.status === "lunas" ? "#10B981" : "#B45309" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--ink)" }}>
        <span>{sum.paidCount}/{sum.tenor} dibayar</span>
        {sum.next ? <span>Ke-{sum.next.ke} · {shortDate(sum.next.due)}</span> : <span>Sisa {money(sum.sisaBayar)}</span>}
      </div>
    </button>
  );
}

// ── Detail + bayar ─────────────────────────────────────────────────────────────

function PlanDetail({ data, plan, bizId, onBack, onData }) {
  const sum = planSummary(plan, todayWib());
  const [paying, setPaying] = useState(null);
  const [fromWalletId, setFromWalletId] = useState(data.payWallets[0]?.id || "");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayWib());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const startPay = (row) => {
    setPaying(row);
    setAmount(row.amount);
    setDate(todayWib());
    setErr("");
    setMsg("");
  };

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await postCicilan({ businessId: bizId, action: "pay", planId: plan.id, ke: paying.ke, fromWalletId, amount, date });
      onData(res);
      setMsg(res.status === "lunas" ? "Cicilan lunas! 🎉" : `Cicilan ke-${paying.ke} tercatat.`);
      setPaying(null);
    } catch (e) {
      setErr(e.message || "Gagal mencatat pembayaran.");
    }
    setBusy(false);
  };

  const cancel = async () => {
    if (busy) return;
    const reason = window.prompt("Batalkan rencana cicilan ini? Transaksi yang sudah tercatat tidak dihapus.\nAlasan (opsional):", "Pesanan dibatalkan");
    if (reason === null) return;
    setBusy(true);
    setErr("");
    try {
      onData(await postCicilan({ businessId: bizId, action: "cancel", planId: plan.id, reason }));
    } catch (e) {
      setErr(e.message || "Gagal membatalkan.");
    }
    setBusy(false);
  };

  const extra = paying ? amount - paying.amount : 0;

  return (
    <div style={S.pad}>
      <button style={{ ...S.btnGhost, marginBottom: 12 }} onClick={onBack}>← Semua cicilan</button>
      {err && <div style={S.err}>{err}</div>}
      {msg && <div style={S.ok}>{msg}</div>}

      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>{plan.label}</div>
          <StatusBadge plan={plan} sum={sum} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12, fontSize: 12, color: "var(--ink)" }}>
          <div><div style={S.muted}>Pokok</div><b className="money">{money(plan.pokok)}</b></div>
          <div><div style={S.muted}>Total bayar</div><b className="money">{money(plan.totalBayar)}</b></div>
          <div><div style={S.muted}>Bunga</div><b className="money">{plan.totalBunga > 0 ? `${money(plan.totalBunga)} (${pct(plan.flatPerBulanPct)}/bln)` : "0%"}</b></div>
          <div><div style={S.muted}>Sisa tagihan</div><b className="money">{money(sum.sisaBayar)}</b></div>
          <div><div style={S.muted}>Jatuh tempo</div><b>Tiap tgl {plan.dueDay}</b></div>
          <div><div style={S.muted}>Bunga dicatat</div><b>{plan.bungaMode === "di_awal" ? "Di awal" : "Saat bayar"}</b></div>
        </div>
        {plan.cancelReason && <div style={{ ...S.muted, marginTop: 8 }}>Alasan batal: {plan.cancelReason}</div>}
      </div>

      {paying && (
        <div style={{ ...S.card, borderColor: "#B45309" }}>
          <div style={{ fontWeight: 800, marginBottom: 10, color: "var(--ink)" }}>Bayar cicilan ke-{paying.ke}</div>
          <Field label="Dibayar dari">
            <select style={S.input} value={fromWalletId} onChange={(e) => setFromWalletId(e.target.value)}>
              {data.payWallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Nominal dibayar" hint={extra > 0 ? `Lebih ${money(extra)} dari tagihan → dicatat sebagai denda/biaya.` : `Tagihan ${money(paying.amount)}`}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Tanggal bayar">
            <input type="date" style={S.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div style={{ ...S.muted, marginBottom: 12, lineHeight: 1.5 }}>
            {plan.bungaMode === "di_awal"
              ? <>Tercatat: transfer {money(paying.amount)} ke PayLater{extra > 0 ? ` + pengeluaran denda ${money(extra)}` : ""}.</>
              : <>Tercatat: transfer pokok {money(paying.pokok)} ke PayLater{paying.bunga + extra > 0 ? ` + pengeluaran bunga${extra > 0 ? "/denda" : ""} ${money(paying.bunga + extra)}` : ""}.</>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...S.btnGhost, flex: 1 }} onClick={() => setPaying(null)} disabled={busy}>Batal</button>
            <button style={{ ...S.btn, flex: 2, opacity: busy || amount < paying.amount || !fromWalletId ? 0.6 : 1 }} disabled={busy || amount < paying.amount || !fromWalletId} onClick={pay}>
              {busy ? "Menyimpan…" : "Simpan pembayaran"}
            </button>
          </div>
        </div>
      )}

      <div style={{ ...S.muted, fontWeight: 700, margin: "6px 0 8px" }}>Jadwal</div>
      <div style={S.card}>
        {plan.jadwal.map((r) => {
          const isNext = sum.next?.ke === r.ke;
          return (
            <div key={r.ke} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: r.ke < plan.tenor ? "1px solid var(--line)" : "none" }}>
              <div style={{ width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, background: r.paid ? "#10B981" : isNext ? "#FEF3C7" : "var(--surface2)", color: r.paid ? "#fff" : "var(--ink)" }}>
                {r.paid ? "✓" : r.ke}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="money" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{money(r.paid ? r.paidAmount : r.amount)}</div>
                <div style={S.muted}>{r.paid ? `Dibayar ${shortDate(r.paidAt)}` : `Jatuh tempo ${shortDate(r.due)}`}</div>
              </div>
              {isNext && !paying && (
                <button style={{ ...S.btnGhost, background: "#B45309", color: "#fff", border: "none" }} onClick={() => startPay(r)}>Bayar</button>
              )}
            </div>
          );
        })}
      </div>

      {plan.status === "berjalan" && (
        <button style={{ ...S.btnGhost, width: "100%", color: "#B91C1C", marginTop: 4 }} onClick={cancel} disabled={busy}>
          Batalkan rencana (pesanan batal / refund)
        </button>
      )}
    </div>
  );
}

// ── Buat rencana ─────────────────────────────────────────────────────────────

const TENOR_CHOICES = [1, 3, 6, 12, 18, 24];

/** Perkecil foto/screenshot di HP sebelum dikirim (screenshot iPhone bisa >4 MB → ditolak server). */
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { b64: canvas.toDataURL("image/jpeg", quality).split(",")[1], media: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Step({ n, title, children }) {
  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 22, height: 22, borderRadius: 99, background: "#B45309", color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>{n}</span>
        <span style={{ fontWeight: 800, color: "var(--ink)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function CreatePlan({ data, bizId, onBack, onData }) {
  const today = todayWib();
  const [pokok, setPokok] = useState(0);
  const [label, setLabel] = useState("");
  const [tenor, setTenor] = useState(null);
  const [perBulan, setPerBulan] = useState(0);
  const [scanOptions, setScanOptions] = useState([]);
  const [purchaseTxId, setPurchaseTxId] = useState("");
  const [purchaseCategoryId, setPurchaseCategoryId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [startMonth, setStartMonth] = useState(nextMonth(today));
  const [dueDay, setDueDay] = useState(5);
  const [bungaMode, setBungaMode] = useState("per_bayar");
  const [bungaCategoryId, setBungaCategoryId] = useState(data.suggestedBungaCategoryId || "");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scanMsg, setScanMsg] = useState("");

  const linked = data.purchases.find((p) => p.id === purchaseTxId) || null;
  const effPokok = linked ? linked.amount : pokok;
  const comparison = useMemo(() => analyzeTenorOptions(effPokok, scanOptions), [effPokok, scanOptions]);
  const chosen = useMemo(
    () => (tenor && perBulan ? analyzeTenorOptions(effPokok, [{ tenor, perBulan }]).rows[0] || null : null),
    [effPokok, tenor, perBulan]
  );
  const preview = useMemo(() => {
    if (!chosen || !(effPokok > 0)) return null;
    try {
      return buildJadwal({ pokok: effPokok, tenor: chosen.tenor, perBulan: chosen.perBulan, startMonth, dueDay });
    } catch (e) {
      return { error: e.message };
    }
  }, [chosen, effPokok, startMonth, dueDay]);

  const pickTenor = (t) => {
    setTenor(t);
    const fromScan = scanOptions.find((o) => o.tenor === t);
    if (fromScan) setPerBulan(fromScan.perBulan);
    else if (t === 1 && effPokok > 0) setPerBulan(effPokok);
    else setPerBulan(0);
  };

  const onScreenshot = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setScanBusy(true);
    setErr("");
    setScanMsg("");
    try {
      const { b64, media } = await compressImage(f);
      const parsed = normalizeScreenshotParse(await aiParse({ mode: "cicilan", image: b64, media }));
      if (!parsed.options.length) throw new Error("Tidak ada pilihan tenor di gambar.");
      if (parsed.pokok && !linked) setPokok(parsed.pokok);
      if (parsed.label && !label) setLabel(parsed.label);
      setScanOptions(parsed.options);
      setScanMsg(`Terbaca ${parsed.options.length} pilihan tenor. Ketuk salah satu di bawah.`);
    } catch (e2) {
      setErr(`Screenshot tidak terbaca (${e2?.message || "error"}). Isi manual saja di langkah 2.`);
    }
    setScanBusy(false);
  };

  const pickPurchase = (id) => {
    setPurchaseTxId(id);
    const p = data.purchases.find((x) => x.id === id);
    if (p) {
      if (!label) setLabel(p.desc || "");
      setPurchaseDate(p.date || today);
    }
  };

  const valid = effPokok > 0 && label.trim() && chosen && preview && !preview.error && dueDay >= 1 && dueDay <= 31;
  const missing = !label.trim() ? "Isi nama barang" : !(effPokok > 0) ? "Isi total yang dicicil" : !tenor ? "Pilih tenor" : !(perBulan > 0) ? "Isi cicilan per bulan" : preview?.error || null;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await postCicilan({
        businessId: bizId,
        action: "create",
        purchaseTxId: purchaseTxId || null,
        purchaseCategoryId: purchaseTxId ? null : purchaseCategoryId || null,
        plan: {
          label: label.trim(),
          pokok: effPokok,
          tenor: chosen.tenor,
          perBulan: chosen.perBulan,
          startMonth,
          dueDay,
          bungaMode: chosen.tanpaBunga ? "per_bayar" : bungaMode,
          bungaCategoryId: bungaCategoryId || null,
          purchaseDate,
        },
      });
      onData(res, res.planId);
    } catch (e) {
      setErr(e.message || "Gagal membuat rencana.");
    }
    setBusy(false);
  };

  return (
    <div style={S.pad}>
      <button style={{ ...S.btnGhost, marginBottom: 12 }} onClick={onBack}>← Kembali</button>
      {err && <div style={S.err}>{err}</div>}

      <Step n={1} title="Barang yang dicicil">
        <Field label="Nama barang">
          <input style={S.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. DJI Osmo Pocket 4P" />
        </Field>
        {data.purchases.length > 0 && (
          <Field label="Sudah dicatat sebagai belanja PayLater?" hint="Kalau belum, biarkan “Belum” — belanjanya ikut dicatat otomatis.">
            <select style={S.input} value={purchaseTxId} onChange={(e) => pickPurchase(e.target.value)}>
              <option value="">Belum dicatat</option>
              {data.purchases.map((p) => (
                <option key={p.id} value={p.id}>{shortDate(p.date)} · {money(p.amount)} · {p.desc || "tanpa ket."}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Total yang dicicil" hint={linked ? "Mengikuti nominal belanja yang dipilih." : "Total Pesanan di Shopee (sudah termasuk proteksi & biaya layanan)."}>
          {linked ? <div className="money" style={{ ...S.input, background: "var(--surface2)" }}>{money(linked.amount)}</div> : <MoneyInput value={pokok} onChange={setPokok} placeholder="Rp" />}
        </Field>
      </Step>

      <Step n={2} title="Tenor yang Anda pilih">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {TENOR_CHOICES.map((t) => (
            <button key={t} onClick={() => pickTenor(t)}
              style={{ ...S.btnGhost, minWidth: 64, border: tenor === t ? "2px solid #B45309" : "1px solid var(--line)", background: tenor === t ? "#FFFBEB" : "var(--surface)", color: tenor === t ? "#92400E" : "var(--ink)" }}>
              {t} bln
            </button>
          ))}
        </div>
        {tenor && (
          <Field label={`Cicilan per bulan (${tenor} bln)`} hint="Lihat angka “Rp… x bln” di layar SPayLater.">
            <MoneyInput value={perBulan} onChange={setPerBulan} placeholder="Rp" />
          </Field>
        )}
        {chosen && effPokok > 0 && (
          <div style={{ padding: 10, borderRadius: 10, fontSize: 13, background: chosen.tanpaBunga ? "#ECFDF5" : "#FEF3C7", color: chosen.tanpaBunga ? "#047857" : "#92400E" }}>
            Total bayar <b>{money(chosen.total)}</b> ·{" "}
            {chosen.tanpaBunga ? <b>bunga 0% 👍</b> : <>bunga <b>{money(chosen.bunga)}</b> ({pct(chosen.flatPerBulanPct)}/bln)</>}
          </div>
        )}

        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 13, fontWeight: 700, color: "var(--brand)", cursor: "pointer" }}>Bandingkan semua tenor dari screenshot (opsional)</summary>
          <div style={{ marginTop: 10 }}>
            <label style={{ ...S.btnGhost, display: "block", textAlign: "center", marginBottom: 10, cursor: scanBusy ? "wait" : "pointer" }}>
              {scanBusy ? "Membaca screenshot…" : "📷 Upload screenshot pilihan cicilan"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={onScreenshot} disabled={scanBusy} />
            </label>
            {scanMsg && <div style={S.ok}>{scanMsg}</div>}
            {comparison.rows.map((r) => (
              <button key={r.tenor} onClick={() => { setTenor(r.tenor); setPerBulan(r.perBulan); }}
                style={{ width: "100%", textAlign: "left", padding: 10, borderRadius: 10, marginBottom: 8, cursor: "pointer", border: tenor === r.tenor ? "2px solid #B45309" : "1px solid var(--line)", background: tenor === r.tenor ? "#FFFBEB" : "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ color: tenor === r.tenor ? "#111827" : "var(--ink)" }}>{r.tenor} bln × {money(r.perBulan)}</b>
                  {r.tenor === comparison.rekomendasi && <span style={{ fontSize: 10, fontWeight: 800, color: "#047857" }}>DISARANKAN</span>}
                </div>
                <div style={{ fontSize: 12, marginTop: 3, color: r.tanpaBunga ? "#047857" : "#B91C1C" }}>
                  {r.tanpaBunga ? "0% · tanpa bunga" : `+${money(r.bunga)} bunga (${pct(r.flatPerBulanPct)}/bln)`}
                </div>
              </button>
            ))}
          </div>
        </details>
      </Step>

      <Step n={3} title="Jatuh tempo & pencatatan">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Bayar pertama bulan">
              <input type="month" style={S.input} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            </Field>
          </div>
          <div style={{ width: 110 }}>
            <Field label="Tiap tanggal">
              <input type="number" min={1} max={31} style={S.input} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value) || 0)} />
            </Field>
          </div>
        </div>
        {!linked && (
          <Field label="Kategori belanja (opsional)">
            <select style={S.input} value={purchaseCategoryId} onChange={(e) => setPurchaseCategoryId(e.target.value)}>
              <option value="">— Tanpa kategori —</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {chosen && !chosen.tanpaBunga && (
          <>
            <Field label="Bunga dicatat">
              <div style={{ display: "flex", gap: 8 }}>
                {[["per_bayar", "Tiap bayar"], ["di_awal", "Sekaligus di awal"]].map(([v, t]) => (
                  <button key={v} onClick={() => setBungaMode(v)}
                    style={{ ...S.btnGhost, flex: 1, border: bungaMode === v ? "2px solid var(--brand)" : "1px solid var(--line)" }}>{t}</button>
                ))}
              </div>
            </Field>
            <Field label="Kategori bunga">
              <select style={S.input} value={bungaCategoryId} onChange={(e) => setBungaCategoryId(e.target.value)}>
                <option value="">— Tanpa kategori —</option>
                {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </>
        )}
        {preview && !preview.error && (
          <div style={{ ...S.muted, marginBottom: 12, lineHeight: 1.5 }}>
            {preview.length}× {money(chosen.perBulan)}, mulai {shortDate(preview[0].due)} s/d {shortDate(preview[preview.length - 1].due)}.
            {!linked && <> Belanja {money(effPokok)} dicatat dari {data.paylater.name}.</>}
          </div>
        )}
        <button style={{ ...S.btn, opacity: valid && !busy ? 1 : 0.6 }} disabled={!valid || busy} onClick={submit}>
          {busy ? "Menyimpan…" : "Simpan rencana cicilan"}
        </button>
        {!valid && missing && <div style={{ ...S.muted, textAlign: "center", marginTop: 8 }}>{missing}</div>}
      </Step>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

export default function CicilanPaylater({ bizId, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState({ name: "list" });

  const load = useCallback(async () => {
    setErr("");
    try {
      setData(await fetchCicilan(bizId));
    } catch (e) {
      setErr(e.message || "Gagal memuat cicilan.");
    }
  }, [bizId]);

  useEffect(() => { load(); }, [load]);

  const onData = (res, openPlanId) => {
    setData(res);
    if (openPlanId) setView({ name: "detail", planId: openPlanId });
    onChanged?.();
  };

  if (err && !data) {
    return (
      <div style={S.pad}>
        <div style={S.err}>{err}</div>
        <button style={S.btnGhost} onClick={load}>Coba lagi</button>
      </div>
    );
  }
  if (!data) return <div style={{ ...S.pad, ...S.muted }}>Memuat cicilan…</div>;

  if (view.name === "create") {
    return <CreatePlan data={data} bizId={bizId} onBack={() => setView({ name: "list" })} onData={onData} />;
  }
  const plan = view.name === "detail" ? data.plans.find((p) => p.id === view.planId) : null;
  if (plan) {
    return <PlanDetail key={plan.id} data={data} plan={plan} bizId={bizId} onBack={() => setView({ name: "list" })} onData={(res) => onData(res)} />;
  }
  return <PlanList data={data} onOpen={(planId) => setView({ name: "detail", planId })} onCreate={() => setView({ name: "create" })} />;
}

/** Kartu ringkas beranda — tampil hanya bila ada cicilan berjalan. */
export function CicilanBerandaCard({ bizId, hide, onOpen }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchCicilan(bizId).then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [bizId]);
  if (!data) return null;
  const ov = cicilanOverview(data.plans, todayWib());
  if (!ov.activeCount) return null;
  const next = ov.tagihanBerikut;
  const overdue = ov.overdueCount > 0;
  const soon = next && next.daysToDue != null && next.daysToDue <= 3;
  return (
    <div style={{ margin: "0 16px 20px" }}>
    <button onClick={onOpen} style={{ ...S.card, width: "100%", textAlign: "left", cursor: "pointer", display: "block", marginBottom: 0, borderColor: overdue ? "#FCA5A5" : soon ? "#FDE68A" : "var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 800, color: "var(--ink)", fontSize: 14 }}>💳 Cicilan PayLater</div>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>{ov.activeCount} berjalan ›</div>
      </div>
      {next && (
        <div style={{ marginTop: 6, fontSize: 13, color: overdue ? "#B91C1C" : soon ? "#B45309" : "var(--ink)" }}>
          {overdue ? "⚠ Terlambat · " : ""}{next.plan.label} ke-{next.row.ke}: <b className="money">{hide ? "•••" : money(next.row.amount)}</b> · {shortDate(next.row.due)}
          {!overdue && next.daysToDue != null && next.daysToDue <= 3 ? (next.daysToDue === 0 ? " (hari ini)" : ` (H-${next.daysToDue})`) : ""}
        </div>
      )}
      <div style={{ ...S.muted, marginTop: 4 }}>Sisa tagihan {hide ? "•••" : money(ov.sisaBayar)}</div>
    </button>
    </div>
  );
}
