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
  input: { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 15 },
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

const DEFAULT_TENORS = [1, 3, 6, 12, 18, 24];

function CreatePlan({ data, bizId, onBack, onData }) {
  const today = todayWib();
  const [pokok, setPokok] = useState(0);
  const [label, setLabel] = useState("");
  const [options, setOptions] = useState(DEFAULT_TENORS.map((tenor) => ({ tenor, perBulan: 0 })));
  const [tenor, setTenor] = useState(null);
  const [purchaseTxId, setPurchaseTxId] = useState("");
  const [purchaseCategoryId, setPurchaseCategoryId] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [startMonth, setStartMonth] = useState(nextMonth(today));
  const [dueDay, setDueDay] = useState(5);
  const [bungaMode, setBungaMode] = useState("per_bayar");
  const [bungaCategoryId, setBungaCategoryId] = useState(data.suggestedBungaCategoryId || data.categories[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [err, setErr] = useState("");

  const linked = data.purchases.find((p) => p.id === purchaseTxId) || null;
  const effPokok = linked ? linked.amount : pokok;
  const analysis = useMemo(() => analyzeTenorOptions(effPokok, options), [effPokok, options]);
  const chosen = analysis.rows.find((r) => r.tenor === tenor) || null;
  const preview = useMemo(() => {
    if (!chosen) return null;
    try {
      return buildJadwal({ pokok: effPokok, tenor: chosen.tenor, perBulan: chosen.perBulan, startMonth, dueDay });
    } catch (e) {
      return { error: e.message };
    }
  }, [chosen, effPokok, startMonth, dueDay]);

  useEffect(() => {
    if (tenor == null && analysis.rekomendasi != null) setTenor(analysis.rekomendasi);
  }, [analysis.rekomendasi, tenor]);

  const setOpt = (t, perBulan) =>
    setOptions((prev) => {
      const has = prev.some((o) => o.tenor === t);
      const next = has ? prev.map((o) => (o.tenor === t ? { ...o, perBulan } : o)) : [...prev, { tenor: t, perBulan }];
      return next.sort((a, b) => a.tenor - b.tenor);
    });

  const onScreenshot = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setScanBusy(true);
    setErr("");
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      const parsed = normalizeScreenshotParse(await aiParse({ mode: "cicilan", image: b64, media: f.type }));
      if (!parsed.options.length) throw new Error("no options");
      if (parsed.pokok && !linked) setPokok(parsed.pokok);
      if (parsed.label && !label) setLabel(parsed.label);
      setOptions(parsed.options);
      setTenor(null);
    } catch {
      setErr("Screenshot tidak terbaca. Isi nominal per bulan secara manual.");
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
          bungaMode,
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

      <div style={S.card}>
        <div style={{ fontWeight: 800, marginBottom: 4, color: "var(--ink)" }}>1. Pilihan tenor</div>
        <div style={{ ...S.muted, marginBottom: 10 }}>Upload screenshot layar SPayLater, atau isi manual nominal per bulan yang muncul di aplikasi.</div>
        <label style={{ ...S.btnGhost, display: "block", textAlign: "center", marginBottom: 12, cursor: scanBusy ? "wait" : "pointer" }}>
          {scanBusy ? "Membaca screenshot…" : "📷 Upload screenshot cicilan"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={onScreenshot} disabled={scanBusy} />
        </label>

        {data.purchases.length > 0 && (
          <Field label="Belanja PayLater yang sudah dicatat (opsional)" hint="Pilih jika belanjanya sudah dicatat. Kosongkan untuk mencatat belanja baru sekalian.">
            <select style={S.input} value={purchaseTxId} onChange={(e) => pickPurchase(e.target.value)}>
              <option value="">— Belanja baru —</option>
              {data.purchases.map((p) => (
                <option key={p.id} value={p.id}>{shortDate(p.date)} · {money(p.amount)} · {p.desc || "tanpa ket."}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Total yang dicicil (pokok)" hint={linked ? "Mengikuti nominal belanja yang dipilih." : "Total pesanan (termasuk proteksi & biaya layanan) yang dibayar pakai PayLater."}>
          {linked ? <div className="money" style={{ ...S.input, background: "var(--surface2)" }}>{money(linked.amount)}</div> : <MoneyInput value={pokok} onChange={setPokok} placeholder="12.798.580" />}
        </Field>

        <span style={S.label}>Nominal per bulan</span>
        {options.map((o) => (
          <div key={o.tenor} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ width: 64, fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{o.tenor} bln</div>
            <div style={{ flex: 1 }}><MoneyInput value={o.perBulan} onChange={(v) => setOpt(o.tenor, v)} placeholder="—" /></div>
          </div>
        ))}
      </div>

      {analysis.rows.length > 0 && effPokok > 0 && (
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 10, color: "var(--ink)" }}>2. Bandingkan & pilih</div>
          {analysis.rows.map((r) => {
            const active = r.tenor === tenor;
            const rec = r.tenor === analysis.rekomendasi;
            return (
              <button key={r.tenor} onClick={() => setTenor(r.tenor)}
                style={{ width: "100%", textAlign: "left", padding: 10, borderRadius: 10, marginBottom: 8, cursor: "pointer", border: active ? "2px solid #B45309" : "1px solid var(--line)", background: active ? "#FFFBEB" : "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ color: active ? "#111827" : "var(--ink)" }}>{r.tenor} bln × {money(r.perBulan)}</b>
                  {rec && <span style={{ fontSize: 10, fontWeight: 800, color: "#047857" }}>DISARANKAN</span>}
                </div>
                <div style={{ fontSize: 12, marginTop: 3, color: r.tanpaBunga ? "#047857" : r.flatPerBulanPct > 0.02 ? "#B91C1C" : "#B45309" }}>
                  {r.tanpaBunga
                    ? `0% · total ${money(r.total)}`
                    : `+${money(r.bunga)} (${pct(r.bungaPct)} total · ${pct(r.flatPerBulanPct)}/bln flat) · total ${money(r.total)}`}
                </div>
              </button>
            );
          })}
          {chosen && !chosen.tanpaBunga && analysis.rows.some((r) => r.tanpaBunga) && (
            <div style={{ ...S.muted, color: "#B45309" }}>Ada tenor 0%. Tenor ini lebih mahal {money(chosen.bunga)}.</div>
          )}
        </div>
      )}

      {chosen && (
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 10, color: "var(--ink)" }}>3. Detail</div>
          <Field label="Nama barang / keterangan">
            <input style={S.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="DJI Osmo Pocket 4P" />
          </Field>
          {!linked && (
            <>
              <Field label="Kategori belanja">
                <select style={S.input} value={purchaseCategoryId} onChange={(e) => setPurchaseCategoryId(e.target.value)}>
                  <option value="">— Tanpa kategori —</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Tanggal belanja">
                <input type="date" style={S.input} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </Field>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label="Cicilan pertama">
                <input type="month" style={S.input} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              </Field>
            </div>
            <div style={{ width: 110 }}>
              <Field label="Tgl jatuh tempo">
                <input type="number" min={1} max={31} style={S.input} value={dueDay} onChange={(e) => setDueDay(Number(e.target.value) || 0)} />
              </Field>
            </div>
          </div>
          {!chosen.tanpaBunga && (
            <>
              <Field label="Bunga dicatat">
                <div style={{ display: "flex", gap: 8 }}>
                  {[["per_bayar", "Saat bayar tiap bulan"], ["di_awal", "Sekaligus di awal"]].map(([v, t]) => (
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
          {preview?.error && <div style={S.err}>{preview.error}</div>}
          {preview && !preview.error && (
            <div style={{ ...S.muted, marginBottom: 12, lineHeight: 1.5 }}>
              {preview.length}× {money(chosen.perBulan)} · pertama {shortDate(preview[0].due)} · terakhir {shortDate(preview[preview.length - 1].due)}.
              {!linked && <> Belanja {money(effPokok)} dicatat sebagai pengeluaran dari {data.paylater.name}.</>}
              {bungaMode === "di_awal" && chosen.bunga > 0 && <> Bunga {money(chosen.bunga)} langsung dicatat sebagai hutang.</>}
            </div>
          )}
          <button style={{ ...S.btn, opacity: valid && !busy ? 1 : 0.6 }} disabled={!valid || busy} onClick={submit}>
            {busy ? "Menyimpan…" : "Simpan rencana cicilan"}
          </button>
        </div>
      )}
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
