import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from "recharts";

/* ----------------- helpers ----------------- */
function parseDMY(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = +m[1],
      mm = +m[2],
      yy = m[3];
    const yyyy = yy.length === 2 ? (+yy > 50 ? 1900 + +yy : 2000 + +yy) : +yy;
    const d = new Date(yyyy, (mm || 1) - 1, dd || 1);
    return isNaN(+d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const norm = (k) => String(k ?? "").toLowerCase().replace(/\uFEFF/g, "").trim();

const fmt0 = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.round(n).toLocaleString("en-GB", { maximumFractionDigits: 0 })
    : "0";

const pad2 = (n) => String(n).padStart(2, "0");
const toIsoLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const fromIsoLocal = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(+d) ? null : d;
};

const addDays = (d, days) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const clampInt = (n, min, max) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, Math.trunc(x)));
};

function niceTicks(min, max, target = 7) {
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return { domain: ["auto", "auto"], ticks: undefined };

  if (min === max) {
    const a = min - 1;
    const b = max + 1;
    return { domain: [a, b], ticks: [a, min, b] };
  }

  const range = max - min;
  const roughStep = range / Math.max(2, target - 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow10);
  const step = candidates.reduce(
    (best, s) => (Math.abs(s - roughStep) < Math.abs(best - roughStep) ? s : best),
    candidates[0]
  );

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(v);
  return { domain: [niceMin, niceMax], ticks };
}

function niceTicksWithPadding(min, max, target = 7, padFrac = 0.06, clampMinToZero = false) {
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return { domain: ["auto", "auto"], ticks: undefined };

  if (min === max) {
    const a = min - 1;
    const b = max + 1;
    return { domain: [a, b], ticks: [a, min, b] };
  }

  const range = max - min;
  const pad = range * padFrac;

  let paddedMin = min - pad * 0.25;
  let paddedMax = max + pad;

  if (clampMinToZero) paddedMin = Math.max(0, paddedMin);

  return niceTicks(paddedMin, paddedMax, target);
}

/* ---- CSV-first; API only to top-up the latest day (>=1990) ---- */
async function fetchCSVText() {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");

  const candidates = [
    "prices.csv",
    "data/prices.csv",
    `${base}prices.csv`,
    `${base}data/prices.csv`,
  ];

  let lastErr = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`CSV HTTP ${res.status} for ${url}`);
        continue;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const textRaw = await res.text();

      if (ct.includes("text/html") || /^\s*<!doctype/i.test(textRaw)) {
        lastErr = new Error(`Got HTML instead of CSV from ${url}`);
        continue;
      }

      return textRaw.replace(/^\uFEFF/, "");
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("prices.csv not found");
}

async function fetchLatestFromAPI() {
  try {
    const key =
      import.meta?.env?.VITE_METAL_API_KEY || "98ce31de34ecaadcd00d49d12137a56a";
    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${key}&base=USD&currencies=XAU,XAG`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    const json = await res.json();
    const rXAU = Number(json?.rates?.XAU);
    const rXAG = Number(json?.rates?.XAG);
    if (!(rXAU > 0) || !(rXAG > 0)) throw new Error("API missing XAU/XAG");

    const goldUSD = 1 / rXAU;
    const silverUSD = 1 / rXAG;

    const today = new Date();
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return {
      ok: true,
      row: { date: todayLocal, gold: goldUSD, silver: silverUSD, gsr: goldUSD / silverUSD },
    };
  } catch (e) {
    console.warn("MetalPriceAPI latest failed:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ----------------- bulletproof breakpoint hook ----------------- */
function useBreakpoint() {
  const read = () => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const h = Math.round(vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800));

    return {
      w: Math.round(w),
      h,
      isMobile: w <= 640,
      isTablet: w > 640 && w <= 1024,
      isLandscape: w > h,
    };
  };

  const [bp, setBp] = useState(read);

  useEffect(() => {
    let rafId = 0;
    let last = read();
    let pollUntil = 0;

    const applyIfChanged = () => {
      const next = read();
      if (next.w !== last.w || next.h !== last.h || next.isLandscape !== last.isLandscape) {
        last = next;
        setBp(next);
      }
    };

    const pollLoop = () => {
      applyIfChanged();
      if (performance.now() < pollUntil) {
        rafId = requestAnimationFrame(pollLoop);
      } else {
        rafId = 0;
      }
    };

    const startShortPoll = (ms = 900) => {
      pollUntil = performance.now() + ms;
      if (!rafId) rafId = requestAnimationFrame(pollLoop);
    };

    const onResize = () => {
      applyIfChanged();
      startShortPoll(900);
    };

    const onScroll = () => {
      startShortPoll(1200);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", onResize, { passive: true });
      vv.addEventListener("scroll", onScroll, { passive: true });
    }

    const onVis = () => {
      if (document.visibilityState === "visible") startShortPoll(1200);
    };
    document.addEventListener("visibilitychange", onVis);

    applyIfChanged();
    startShortPoll(600);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("scroll", onScroll);
      if (vv) {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onScroll);
      }
      document.removeEventListener("visibilitychange", onVis);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return bp;
}

/* ----------------- tiny info tooltip (tap/hover) ----------------- */
function InfoTip({ text }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onDoc = (e) => {
      // close when clicking outside any tooltip
      if (!e.target.closest?.(".gsr-tipWrap")) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  return (
    <span className="gsr-tipWrap">
      <button
        type="button"
        className="gsr-tipBtn"
        aria-label="Info"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((s) => !s);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        i
      </button>

      {open && (
        <span className="gsr-tipBubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/* ----------------- DD/MM/YYYY pill input ----------------- */
function DatePills({ label, valueIso, onChangeIso, compact = false }) {
  const d = useMemo(() => fromIsoLocal(valueIso) || new Date(2000, 0, 1), [valueIso]);
  const [dd, setDd] = useState(pad2(d.getDate()));
  const [mm, setMm] = useState(pad2(d.getMonth() + 1));
  const [yyyy, setYyyy] = useState(String(d.getFullYear()));

  useEffect(() => {
    const x = fromIsoLocal(valueIso);
    if (!x) return;
    setDd(pad2(x.getDate()));
    setMm(pad2(x.getMonth() + 1));
    setYyyy(String(x.getFullYear()));
  }, [valueIso]);

  const commit = () => {
    const day = clampInt(dd, 1, 31);
    const mon = clampInt(mm, 1, 12);
    const year = clampInt(yyyy, 1900, 2100);
    const lastDay = new Date(year, mon, 0).getDate();
    const safeDay = Math.min(day, lastDay);
    const finalD = new Date(year, mon - 1, safeDay);
    onChangeIso(toIsoLocal(finalD));
  };

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      commit();
    }
  };

  return (
    <div className={`gsr-control ${compact ? "is-compact" : ""}`}>
      <span className="gsr-label">{label}</span>
      <div className={`gsr-datePills ${compact ? "gsr-datePills--compact" : ""}`} onBlur={commit}>
        <input
          className="gsr-dateSeg"
          inputMode="numeric"
          value={dd}
          onChange={(e) => setDd(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
          onKeyDown={onKey}
        />
        <span className="gsr-dateSlash">/</span>
        <input
          className="gsr-dateSeg"
          inputMode="numeric"
          value={mm}
          onChange={(e) => setMm(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
          onKeyDown={onKey}
        />
        <span className="gsr-dateSlash">/</span>
        <input
          className="gsr-dateSeg gsr-dateYear"
          inputMode="numeric"
          value={yyyy}
          onChange={(e) => setYyyy(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
          onKeyDown={onKey}
        />
      </div>
    </div>
  );
}

/* ----------------- Currency input ----------------- */
function CurrencyInput({ value, onChange, className = "" }) {
  const [txt, setTxt] = useState((value ?? 0).toLocaleString("en-GB"));

  useEffect(() => {
    setTxt((value ?? 0).toLocaleString("en-GB"));
  }, [value]);

  const handleChange = (e) => {
    const digits = e.target.value.replace(/[^\d]/g, "");
    const n = digits ? parseInt(digits, 10) : 0;
    onChange(n);
    setTxt(n.toLocaleString("en-GB"));
  };

  return (
    <input
      className={`gsr-pill ${className}`}
      inputMode="numeric"
      value={txt}
      onChange={handleChange}
    />
  );
}

/* ----------------- chart tooltip ----------------- */
function CustomTooltip({ active, label, payload }) {
  if (!active || !payload?.length) return null;

  const dt =
    label instanceof Date
      ? label
      : typeof label === "string" || typeof label === "number"
      ? new Date(label)
      : null;

  const labelText =
    dt && !isNaN(+dt)
      ? dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "";

  const withUnits = (name, valueNum) => {
    if (!Number.isFinite(valueNum)) return "";
    if (name === "Gold" || name === "Silver" || name === "My Portfolio") return `$${fmt0(valueNum)}`;
    return fmt0(valueNum);
  };

  const rows = (payload || [])
    .filter((p) => p && p.value != null && Number.isFinite(p.value))
    .map((p) => ({ name: p.name, value: withUnits(p.name, Number(p.value)), color: p.color }))
    .filter((r) => !String(r.name).startsWith("__axis_helper__"));

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.96)",
        borderRadius: 12,
        padding: "10px 12px",
        color: "#0b1b2a",
        boxShadow: "0 10px 25px rgba(0,0,0,0.22)",
        minWidth: 220,
        maxWidth: 340,
      }}
    >
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>{labelText}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: r.color,
                  display: "inline-block",
                }}
              />
              <span>{r.name}</span>
            </div>
            <div style={{ fontWeight: 1000 }}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function diffYearsMonths(startDate, endDate) {
  if (!startDate || !endDate) return { years: 0, months: 0 };
  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/* ----------------- component ----------------- */
export default function App() {
  const { isMobile, isTablet, w, h } = useBreakpoint();

  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const [show, setShow] = useState({ gold: true, silver: true, strat: true, gsr: true });
  const [amount, setAmount] = useState(1000);

  const [startIso, setStartIso] = useState("");
  const [endIso, setEndIso] = useState("");

  const [g2s, setG2S] = useState(85);
  const [s2g, setS2G] = useState(65);
  const [startMetal, setStartMetal] = useState("silver");

  /* ================= RESPONSIVE CHART SETTINGS ================= */
  const AXIS_COLOR = "#0b1b2a";
  const AXIS_WIDTH = isMobile ? 74 : isTablet ? 92 : 120;
  const SHOW_AXIS_LABELS = !isMobile;

  const CHART_MARGIN = useMemo(
    () => ({
      top: isMobile ? 12 : 20,
      right: isMobile ? 10 : 15,
      left: isMobile ? 10 : 15,
      bottom: isMobile ? 14 : 22,
    }),
    [isMobile]
  );

  const CHART_HEIGHT = useMemo(() => {
    const vh = h;
    const vw = w;
    const landscape = vw > vh;

    if (isMobile && landscape) return Math.max(260, Math.min(560, Math.round(vh * 0.78)));
    if (isMobile) return Math.max(320, Math.min(520, Math.round(vh * 0.52)));
    if (isTablet) return 520;
    return 660;
  }, [isMobile, isTablet, w, h]);
  /* ============================================================ */

  useEffect(() => {
    (async () => {
      try {
        const text = await fetchCSVText();
        const lines = text.split(/\r?\n/);
        const header = lines.find((l) => l.trim().length > 0) || "";
        const pref = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";

        let parsed = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          delimiter: "",
          newline: "",
        });

        let mapped = (parsed.data || [])
          .map((o) => {
            const m = {};
            for (const k in o) m[norm(k)] = o[k];
            const gold = toNum(m.gold);
            const silver = toNum(m.silver);
            const date = parseDMY(m.date) || parseDMY(m.datetime) || parseDMY(m.day);
            const gsr = gold != null && silver != null && silver !== 0 ? gold / silver : null;
            return { date, gold, silver, gsr };
          })
          .filter((d) => d.date && d.gold != null && d.silver != null && d.gsr != null);

        if (!mapped.length) {
          parsed = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter: pref });
          mapped = (parsed.data || [])
            .map((o) => {
              const m = {};
              for (const k in o) m[norm(k)] = o[k];
              const gold = toNum(m.gold);
              const silver = toNum(m.silver);
              const date = parseDMY(m.date);
              const gsr = gold != null && silver != null && silver !== 0 ? gold / silver : null;
              return { date, gold, silver, gsr };
            })
            .filter((d) => d.date && d.gold != null && d.silver != null && d.gsr != null);
        }

        mapped.sort((a, b) => a.date - b.date);

        try {
          if (mapped.length) {
            const last = mapped[mapped.length - 1].date;
            const today = new Date();
            const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            if (last < todayLocal) {
              const api = await fetchLatestFromAPI();
              if (api.ok && api.row?.date) {
                const key = toIsoLocal(api.row.date);
                const seen = new Set(mapped.map((r) => toIsoLocal(r.date)));
                if (!seen.has(key)) mapped.push(api.row);
                mapped.sort((a, b) => a.date - b.date);
              }
            }
          }
        } catch (e) {
          console.warn("Top-up merge failed:", e);
        }

        setRows(mapped);

        if (mapped.length) {
          const minIso = toIsoLocal(mapped[0].date);
          const maxIso = toIsoLocal(mapped[mapped.length - 1].date);
          setStartIso((s) => s || minIso);
          setEndIso((s) => s || maxIso);
        }
      } catch (e) {
        setErr(String(e.message || e));
      }
    })();
  }, []);

  const dateMap = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(toIsoLocal(r.date), r);
    return map;
  }, [rows]);

  const adjustToAvailable = (iso) => {
    if (!iso || !rows.length) return iso;
    if (dateMap.has(iso)) return iso;
    const start = fromIsoLocal(iso);
    if (!start) return iso;
    let cur = start;
    for (let i = 0; i < 3660; i++) {
      cur = addDays(cur, 1);
      const key = toIsoLocal(cur);
      if (dateMap.has(key)) return key;
    }
    return iso;
  };

  const { startIsoAdj, endIsoAdj } = useMemo(() => {
    if (!rows.length || !startIso || !endIso) return { startIsoAdj: startIso, endIsoAdj: endIso };

    const minIso = toIsoLocal(rows[0].date);
    const maxIso = toIsoLocal(rows[rows.length - 1].date);

    let s = startIso;
    let e = endIso;

    if (s < minIso) s = minIso;
    if (s > maxIso) s = maxIso;
    if (e < minIso) e = minIso;
    if (e > maxIso) e = maxIso;
    if (s > e) e = s;

    return { startIsoAdj: adjustToAvailable(s), endIsoAdj: adjustToAvailable(e) };
  }, [rows, startIso, endIso, dateMap]);

  const windowed = useMemo(() => {
    if (!rows.length || !startIsoAdj || !endIsoAdj) return [];
    const s = fromIsoLocal(startIsoAdj);
    const e = fromIsoLocal(endIsoAdj);
    if (!s || !e) return [];
    const start = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0);
    const end = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59);
    return rows.filter((r) => r.date >= start && r.date <= end);
  }, [rows, startIsoAdj, endIsoAdj]);

  const valuedRows = useMemo(() => {
    if (!windowed.length) return [];
    const start = windowed[0];
    const goldOzBH = amount > 0 && start.gold > 0 ? amount / start.gold : 0;
    const silverOzBH = amount > 0 && start.silver > 0 ? amount / start.silver : 0;

    return windowed.map((r) => ({
      ...r,
      goldValue: goldOzBH * r.gold,
      silverValue: silverOzBH * r.silver,
    }));
  }, [windowed, amount]);

  const withStrategy = useMemo(() => {
    if (!valuedRows.length) return { data: [], endsIn: "gold" };

    let metal = startMetal === "silver" ? "silver" : "gold";
    const first = valuedRows[0];

    let ozGold = 0;
    let ozSilver = 0;

    if (metal === "gold") ozGold = amount / first.gold;
    else ozSilver = amount / first.silver;

    let switchesCount = 0;

    const out = valuedRows.map((r, idx) => {
      if (idx > 0) {
        const prev = valuedRows[idx - 1];
        const up = Number.isFinite(g2s) && prev.gsr < g2s && r.gsr >= g2s;
        const down = Number.isFinite(s2g) && prev.gsr > s2g && r.gsr <= s2g;

        if (metal === "gold" && up) {
          const usd = ozGold * r.gold;
          ozGold = 0;
          ozSilver = (usd / r.silver) * 0.97;
          metal = "silver";
          switchesCount++;
        } else if (metal === "silver" && down) {
          const usd = ozSilver * r.silver;
          ozSilver = 0;
          ozGold = (usd / r.gold) * 0.97;
          metal = "gold";
          switchesCount++;
        }
      }

      const strat = metal === "gold" ? ozGold * r.gold : ozSilver * r.silver;
      return { ...r, strat, switches: switchesCount, stratMetal: metal };
    });

    const endsIn = out[out.length - 1]?.stratMetal || metal;
    return { data: out, endsIn };
  }, [valuedRows, amount, g2s, s2g, startMetal]);

  const data = withStrategy.data;

  const startRatio = useMemo(() => {
    if (!startIsoAdj) return null;
    const r = dateMap.get(startIsoAdj);
    return r?.gsr != null && Number.isFinite(r.gsr) ? r.gsr : null;
  }, [dateMap, startIsoAdj]);

  const durationText = useMemo(() => {
    const s = fromIsoLocal(startIsoAdj);
    const e = fromIsoLocal(endIsoAdj);
    if (!s || !e) return "";
    const { years, months } = diffYearsMonths(s, e);
    const yPart = years ? `${years}y` : "";
    const mPart = months ? `${months}m` : "";
    const out = [yPart, mPart].filter(Boolean).join(" ");
    return out || "0m";
  }, [startIsoAdj, endIsoAdj]);

  const stats = useMemo(() => {
    if (!data.length) {
      return {
        gv: amount,
        sv: amount,
        pv: amount,
        gchg: 0,
        schg: 0,
        pchg: 0,
        gpct: 0,
        spct: 0,
        ppct: 0,
        diffPg: 0,
        diffPs: 0,
        switches: 0,
        pBeatsG: 0,
        pBeatsS: 0,
        endsIn: "GOLD",
      };
    }

    const end = data[data.length - 1];
    const gv = end.goldValue ?? amount;
    const sv = end.silverValue ?? amount;
    const pv = end.strat ?? amount;

    const gchg = gv - amount;
    const schg = sv - amount;
    const pchg = pv - amount;

    const gpct = amount > 0 ? (gv / amount - 1) * 100 : 0;
    const spct = amount > 0 ? (sv / amount - 1) * 100 : 0;
    const ppct = amount > 0 ? (pv / amount - 1) * 100 : 0;

    const diffPg = ppct - gpct;
    const diffPs = ppct - spct;

    let totalG = 0,
      winsG = 0;
    let totalS = 0,
      winsS = 0;
    for (const r of data) {
      if (r.strat != null && r.goldValue != null) {
        totalG++;
        if (r.strat > r.goldValue) winsG++;
      }
      if (r.strat != null && r.silverValue != null) {
        totalS++;
        if (r.strat > r.silverValue) winsS++;
      }
    }

    const pBeatsG = totalG ? (winsG / totalG) * 100 : 0;
    const pBeatsS = totalS ? (winsS / totalS) * 100 : 0;

    const switches = end.switches ?? 0;
    const endsIn = (withStrategy.endsIn || "gold").toUpperCase();

    return {
      gv,
      sv,
      pv,
      gchg,
      schg,
      pchg,
      gpct,
      spct,
      ppct,
      diffPg,
      diffPs,
      switches,
      pBeatsG,
      pBeatsS,
      endsIn,
    };
  }, [data, amount, withStrategy.endsIn]);

  const { usdDomain, usdTicks } = useMemo(() => {
    if (!data.length) return { usdDomain: ["auto", "auto"], usdTicks: undefined };

    let min = Infinity;
    let max = -Infinity;

    for (const r of data) {
      if (show.gold && r.goldValue != null) {
        min = Math.min(min, r.goldValue);
        max = Math.max(max, r.goldValue);
      }
      if (show.silver && r.silverValue != null) {
        min = Math.min(min, r.silverValue);
        max = Math.max(max, r.silverValue);
      }
      if (show.strat && r.strat != null) {
        min = Math.min(min, r.strat);
        max = Math.max(max, r.strat);
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max))
      return { usdDomain: ["auto", "auto"], usdTicks: undefined };

    const out = niceTicksWithPadding(min, max, 7, 0.06, true);
    return { usdDomain: out.domain, usdTicks: out.ticks };
  }, [data, show]);

  const { ratioDomain, ratioTicks } = useMemo(() => {
    if (!data.length) return { ratioDomain: ["auto", "auto"], ratioTicks: undefined };

    let min = Infinity;
    let max = -Infinity;

    for (const r of data) {
      if (r.gsr != null && Number.isFinite(r.gsr)) {
        min = Math.min(min, r.gsr);
        max = Math.max(max, r.gsr);
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max))
      return { ratioDomain: ["auto", "auto"], ratioTicks: undefined };

    const out = niceTicksWithPadding(min, max, 7, 0.06, false);
    return { ratioDomain: out.domain, ratioTicks: out.ticks };
  }, [data]);

  const anyUsdOn = show.gold || show.silver || show.strat;
  const gsrOn = show.gsr;

  const axisMode =
    !anyUsdOn && !gsrOn
      ? "NONE"
      : gsrOn && !anyUsdOn
      ? "RATIO_BOTH"
      : !gsrOn && anyUsdOn
      ? "USD_BOTH"
      : "MIXED";

  const hideAxisText = axisMode === "NONE";

  const leftIsRatio = axisMode === "MIXED" || axisMode === "RATIO_BOTH";
  const rightIsRatio = axisMode === "RATIO_BOTH";

  const leftDomain = leftIsRatio ? ratioDomain : usdDomain;
  const leftTicks = leftIsRatio ? ratioTicks : usdTicks;

  const rightDomain = rightIsRatio ? ratioDomain : usdDomain;
  const rightTicks = rightIsRatio ? ratioTicks : usdTicks;

  const leftLabel = hideAxisText ? "" : leftIsRatio ? "Ratio" : "Value (USD)";
  const rightLabel = hideAxisText ? "" : rightIsRatio ? "Ratio" : "Value (USD)";

  const usdAxisId = axisMode === "USD_BOTH" || axisMode === "MIXED" ? "rightAxis" : "leftAxis";
  const gsrAxisId = "leftAxis";

  const usdHelperKey = useMemo(() => {
    if (show.strat) return "strat";
    if (show.gold) return "goldValue";
    if (show.silver) return "silverValue";
    return "goldValue";
  }, [show.strat, show.gold, show.silver]);

  const axisKeyPart = useMemo(() => {
    return JSON.stringify({
      axisMode,
      show,
      leftDomain,
      leftTicks,
      rightDomain,
      rightTicks,
      usdAxisId,
    });
  }, [axisMode, show, leftDomain, leftTicks, rightDomain, rightTicks, usdAxisId]);

  const chartRemountKey = useMemo(() => {
    return JSON.stringify({
      chartH: CHART_HEIGHT,
      w,
      vh: h,
      axisKeyPart,
    });
  }, [CHART_HEIGHT, w, h, axisKeyPart]);

  const yTickFont = isMobile ? 11 : 13;
  const xTickFont = isMobile ? 11 : 12;
  const yTickMargin = isMobile ? 8 : 12;

  return (
    <div className="gsr-page">
      <style>{`
        :root{
          --bg:#123a5a;
          --panel:#f4efe7;
          --gold:#b58b58;
          --ink:#0b1b2a;
          --pill:#ffffff;
          --shadow: 0 16px 40px rgba(0,0,0,0.25);
          --radius: 22px;
          --ctrlH: 40px;
        }
        *{box-sizing:border-box}
        body{margin:0;background:var(--bg)}
        .gsr-page{
          min-height:100dvh;
          background:linear-gradient(180deg,#0f2d47 0%, #123a5a 55%, #123a5a 100%);
          padding: 22px 18px 34px;
          color:white;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }
        .gsr-container{ max-width: 1600px; margin: 0 auto; }

        .gsr-header{ display:flex; flex-direction:column; align-items:center; gap:10px; margin-bottom: 18px; }
        .gsr-title{
          font-family: Georgia, "Times New Roman", Times, serif;
          font-size: 56px;
          margin:0;
          letter-spacing:0.5px;
          text-align:center;
        }
        .gsr-title-underline{ width: 280px; height: 4px; background: var(--gold); border-radius: 999px; }

        .gsr-controls{
          display:grid;
          grid-template-columns: 1.15fr 1.35fr 0.75fr 1.35fr 0.85fr 0.75fr 0.75fr;
          gap: 12px;
          align-items:end;
          margin-bottom: 14px;
        }
        @media (max-width: 1200px){
          .gsr-controls{ grid-template-columns: 1fr 1fr; gap: 12px; }
        }
        @media (max-width: 520px){
          .gsr-controls{ grid-template-columns: 1fr; }
        }

        .gsr-control{display:flex; flex-direction:column; gap:6px; min-width:0;}
        .gsr-label{ font-size: 13px; color: rgba(255,255,255,0.75); font-weight: 800; text-align:center; }

        .gsr-pill{
          height: var(--ctrlH);
          width: 100%;
          border-radius: 999px;
          border: 0;
          padding: 0 14px;
          background: var(--pill);
          color: #0b1b2a;
          outline: none;
          font-weight: 900;
          min-width: 0;
          text-align: center;
          line-height: var(--ctrlH);
          font-size: 16px;
        }
        .gsr-pillReadOnly{
          height: var(--ctrlH);
          width: 100%;
          border-radius: 999px;
          border: 0;
          padding: 0 14px;
          background: #efe7dc;
          color: #0b1b2a;
          outline: none;
          font-weight: 1000;
          min-width: 0;
          text-align: center;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size: 16px;
        }
        .gsr-pill--small{ padding: 0 10px; font-size: 14px; font-weight: 1000; }
        .gsr-pillSelect{ text-align: center; text-align-last: center; }
        .gsr-pillSelect option{ text-align:left; }

        .gsr-datePills{
          height: var(--ctrlH);
          width: 100%;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding: 0 12px;
          background: var(--pill);
          border-radius: 999px;
          min-width: 0;
        }
        .gsr-dateSeg{
          width: 46px;
          height: calc(var(--ctrlH) - 10px);
          border: 0; outline: none;
          text-align:center; font-weight: 1000;
          color: #0b1b2a; background: transparent;
          min-width: 0;
          font-size: 16px;
          line-height: 1;
          padding: 0;
        }
        .gsr-dateYear{width: 88px;}
        .gsr-dateSlash{color:#64748b; font-weight:1000;}
        .gsr-datePills--compact{ gap:6px; padding: 0 10px; }
        .is-compact .gsr-label{ font-size: 12px; }

        @media (max-width: 420px){
          .gsr-dateSeg{ width: 42px; font-size: 15px; }
          .gsr-dateYear{ width: 82px; font-size: 15px; }
          .gsr-pill{ font-size: 15px; }
        }

        .gsr-cards{
          display:grid;
          grid-template-columns: 360px 1fr;
          gap: 16px;
          margin-bottom: 12px;
          align-items: stretch;
        }
        @media (max-width: 1200px){
          .gsr-cards{grid-template-columns: 1fr;}
        }

        .gsr-leftStack{
          display:grid;
          grid-template-rows: 1fr 1fr;
          gap: 16px;
        }

        .gsr-card{
          background: var(--gold);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 16px 16px 14px;
          min-height: 190px;
        }
        .gsr-cardTitle{
          font-family: Georgia, "Times New Roman", Times, serif;
          font-size: 42px;
          margin: 0 0 6px 0;
          color: rgba(255,255,255,0.95);
        }
        .gsr-cardValue{
          font-family: Georgia, "Times New Roman", Times, serif;
          font-size: 28px;
          font-weight: 900;
          color: #fff3d9;
          margin-bottom: 10px;
        }
        .gsr-cardInner{
          background: var(--panel);
          border-radius: 14px;
          padding: 12px 12px;
          color: var(--ink);
          font-weight: 900;
        }

        .gsr-twoLine{ display:flex; flex-direction:column; gap:8px; }
        .gsr-row{ display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
        .gsr-muted{ color:#486076; font-weight: 900; }
        .gsr-strong{ color:#0b1b2a; font-weight: 1000; }

        .gsr-card--portfolio{
          min-height: 100%;
          padding: 18px 18px 16px;
        }
        .gsr-card--portfolio .gsr-cardTitle{ font-size: 52px; }
        .gsr-card--portfolio .gsr-cardValue{ font-size: 38px; }
        .gsr-card--portfolio .gsr-cardInner{
          font-size: 18px;
          padding: 16px 16px;
        }
        .gsr-portfolioGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 20px;
          row-gap: 10px;
          align-items:baseline;
        }
        .gsr-portfolioGrid .right{ text-align:right; }

        .gsr-error{color:#ffb4b4; font-weight:900;}

        .gsr-chartWrap{
          background: var(--panel);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 10px 12px 12px;
        }
        .gsr-chartTop{
          display:flex;
          justify-content:flex-end;
          gap: 14px;
          padding: 6px 6px 8px;
          flex-wrap: wrap;
        }
        .gsr-toggle{
          display:flex; align-items:center; gap:6px;
          color: #0b1b2a;
          font-weight: 1000;
          user-select:none;
          white-space:nowrap;
          font-size: 14px;
        }
        .gsr-dot{
          width: 11px; height: 11px; border-radius: 999px; display:inline-block;
        }
        .gsr-chartInner{
          width: 100%;
          height: ${CHART_HEIGHT}px;
          max-height: 90dvh;
          display:flex;
          align-items:center;
          justify-content:center;
        }

        /* ✅ info tooltip styling */
        .gsr-tipWrap{
          position: relative;
          display:inline-flex;
          align-items:center;
          margin-left: 6px;
        }
        .gsr-tipBtn{
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 0;
          background: rgba(11,27,42,0.12);
          color: #0b1b2a;
          font-weight: 1000;
          font-size: 12px;
          line-height: 18px;
          text-align:center;
          cursor: pointer;
          padding: 0;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          transform: translateY(-1px);
        }
        .gsr-tipBtn:active{ transform: translateY(0px) scale(0.98); }
        .gsr-tipBubble{
          position:absolute;
          z-index: 50;
          bottom: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%);
          background: rgba(255,255,255,0.98);
          color: #0b1b2a;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.22);
          padding: 10px 12px;
          width: min(260px, 74vw);
          font-size: 13px;
          font-weight: 900;
          line-height: 1.25;
        }
        .gsr-tipBubble::after{
          content:"";
          position:absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 8px solid transparent;
          border-top-color: rgba(255,255,255,0.98);
        }
      `}</style>

      <div className="gsr-container">
        <header className="gsr-header">
          <h1 className="gsr-title">Gold Silver Ratio</h1>
          <div className="gsr-title-underline" />
        </header>

        {/* controls */}
        <section className="gsr-controls">
          <div className="gsr-control">
            <span className="gsr-label">Initial Amount (USD)</span>
            <CurrencyInput value={amount} onChange={setAmount} />
          </div>

          <DatePills label="Start Date (DD/MM/YYYY)" valueIso={startIso} onChangeIso={setStartIso} compact />

          <div className="gsr-control">
            <span className="gsr-label">Ratio on Start Date</span>
            <div className="gsr-pillReadOnly gsr-pill--small">{startRatio != null ? fmt0(startRatio) : "—"}</div>
          </div>

          <DatePills label="End Date (DD/MM/YYYY)" valueIso={endIso} onChangeIso={setEndIso} compact />

          <div className="gsr-control">
            <span className="gsr-label">Start Metal</span>
            <select
              className="gsr-pill gsr-pillSelect gsr-pill--small"
              value={startMetal}
              onChange={(e) => setStartMetal(e.target.value)}
            >
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
            </select>
          </div>

          <div className="gsr-control">
            <span className="gsr-label">Silver → Gold</span>
            <input
              className="gsr-pill gsr-pill--small"
              type="number"
              step="1"
              value={s2g}
              onChange={(e) => setS2G(Number(e.target.value) || 0)}
            />
          </div>

          <div className="gsr-control">
            <span className="gsr-label">Gold → Silver</span>
            <input
              className="gsr-pill gsr-pill--small"
              type="number"
              step="1"
              value={g2s}
              onChange={(e) => setG2S(Number(e.target.value) || 0)}
            />
          </div>
        </section>

        {/* cards */}
        <section className="gsr-cards">
          <div className="gsr-leftStack">
            <div className="gsr-card">
              <div className="gsr-cardTitle">Gold</div>
              <div className="gsr-cardValue">${fmt0(stats.gv)}</div>
              <div className="gsr-cardInner">
                <div className="gsr-twoLine">
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Change:
                      <InfoTip text="Sample tooltip: This shows how much the Gold-only strategy value changed (USD) from the start date to the end date." />
                    </span>
                    <span className="gsr-strong">${fmt0(stats.gchg)}</span>
                  </div>
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Return:
                      <InfoTip text="Sample tooltip: Percentage return if you stayed fully in Gold over the selected period." />
                    </span>
                    <span className="gsr-strong">{fmt0(stats.gpct)}%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="gsr-card">
              <div className="gsr-cardTitle">Silver</div>
              <div className="gsr-cardValue">${fmt0(stats.sv)}</div>
              <div className="gsr-cardInner">
                <div className="gsr-twoLine">
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Change:
                      <InfoTip text="Sample tooltip: This shows how much the Silver-only strategy value changed (USD) from the start date to the end date." />
                    </span>
                    <span className="gsr-strong">${fmt0(stats.schg)}</span>
                  </div>
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Return:
                      <InfoTip text="Sample tooltip: Percentage return if you stayed fully in Silver over the selected period." />
                    </span>
                    <span className="gsr-strong">{fmt0(stats.spct)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="gsr-card gsr-card--portfolio">
            <div className="gsr-cardTitle">My Portfolio</div>
            <div className="gsr-cardValue">${fmt0(stats.pv)}</div>

            <div className="gsr-cardInner">
              <div className="gsr-portfolioGrid">
                <div className="gsr-muted">
                  Change:
                  <InfoTip text="Sample tooltip: Your switching strategy total change and % return across the selected time period." />
                </div>
                <div className="right gsr-strong">
                  ${fmt0(stats.pchg)} | {fmt0(stats.ppct)}%
                </div>

                <div className="gsr-muted">
                  Duration:
                  <InfoTip text="Sample tooltip: Total time between your chosen start date and end date (years + months)." />
                </div>
                <div className="right gsr-strong">{durationText}</div>

                <div className="gsr-muted">
                  Beats Gold (Time):
                  <InfoTip text="Sample tooltip: % of days where the strategy value is higher than staying in Gold." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.pBeatsG)}%</div>

                <div className="gsr-muted">
                  Beats Silver (Time):
                  <InfoTip text="Sample tooltip: % of days where the strategy value is higher than staying in Silver." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.pBeatsS)}%</div>

                <div className="gsr-muted">
                  vs Gold:
                  <InfoTip text="Sample tooltip: Strategy return minus Gold-only return (percentage points)." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.diffPg)}%</div>

                <div className="gsr-muted">
                  vs Silver:
                  <InfoTip text="Sample tooltip: Strategy return minus Silver-only return (percentage points)." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.diffPs)}%</div>

                <div className="gsr-muted">
                  Switches:
                  <InfoTip text="Sample tooltip: How many times the strategy switched between Gold and Silver based on your thresholds." />
                </div>
                <div className="right gsr-strong">
                  {fmt0(stats.switches)} &nbsp; <span className="gsr-muted">Ends in:</span> {stats.endsIn}
                </div>
              </div>
            </div>
          </div>
        </section>

        {err && <p className="gsr-error">Error: {err}</p>}

        {/* chart */}
        <div className="gsr-chartWrap">
          <div className="gsr-chartTop">
            <label className="gsr-toggle">
              <input
                type="checkbox"
                checked={show.gold}
                onChange={(e) => setShow((s) => ({ ...s, gold: e.target.checked }))}
              />
              <span className="gsr-dot" style={{ background: "#f2c36b" }} />
              Gold
            </label>
            <label className="gsr-toggle">
              <input
                type="checkbox"
                checked={show.silver}
                onChange={(e) => setShow((s) => ({ ...s, silver: e.target.checked }))}
              />
              <span className="gsr-dot" style={{ background: "#0e2d4a" }} />
              Silver
            </label>
            <label className="gsr-toggle">
              <input
                type="checkbox"
                checked={show.strat}
                onChange={(e) => setShow((s) => ({ ...s, strat: e.target.checked }))}
              />
              <span className="gsr-dot" style={{ background: "#a77d52" }} />
              My Portfolio
            </label>
            <label className="gsr-toggle">
              <input
                type="checkbox"
                checked={show.gsr}
                onChange={(e) => setShow((s) => ({ ...s, gsr: e.target.checked }))}
              />
              <span className="gsr-dot" style={{ background: "#000000" }} />
              GSR
            </label>
          </div>

          <div className="gsr-chartInner">
            <ResponsiveContainer key={chartRemountKey} width="100%" height="100%" debounce={0}>
              <LineChart key={`lc_${chartRemountKey}`} data={data} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.10} />

                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    d instanceof Date
                      ? d.toLocaleDateString("en-GB", { year: "2-digit", month: "short" })
                      : d
                  }
                  tick={{ fontSize: xTickFont, fontWeight: 900, fill: AXIS_COLOR }}
                  minTickGap={isMobile ? 24 : 18}
                  tickMargin={10}
                  padding={{ left: 6, right: 6 }}
                />

                <YAxis
                  key={`leftAxis__${axisKeyPart}`}
                  yAxisId="leftAxis"
                  orientation="left"
                  type="number"
                  scale="linear"
                  allowDataOverflow={false}
                  axisLine={{ stroke: AXIS_COLOR }}
                  tickLine={hideAxisText ? false : { stroke: AXIS_COLOR }}
                  tick={hideAxisText ? false : { fill: AXIS_COLOR, fontWeight: 900, fontSize: yTickFont }}
                  tickMargin={yTickMargin}
                  width={AXIS_WIDTH}
                  domain={leftDomain}
                  ticks={leftTicks}
                  tickFormatter={(v) => fmt0(Number(v))}
                  label={
                    hideAxisText || !SHOW_AXIS_LABELS
                      ? undefined
                      : {
                          value: leftLabel,
                          angle: -90,
                          position: "insideLeft",
                          fill: AXIS_COLOR,
                          fontWeight: 900,
                        }
                  }
                />

                <YAxis
                  key={`rightAxis__${axisKeyPart}`}
                  yAxisId="rightAxis"
                  orientation="right"
                  type="number"
                  scale="linear"
                  allowDataOverflow={false}
                  axisLine={{ stroke: AXIS_COLOR }}
                  tickLine={hideAxisText ? false : { stroke: AXIS_COLOR }}
                  tick={hideAxisText ? false : { fill: AXIS_COLOR, fontWeight: 900, fontSize: yTickFont }}
                  tickMargin={yTickMargin}
                  width={AXIS_WIDTH}
                  domain={rightDomain}
                  ticks={rightTicks}
                  tickFormatter={(v) => fmt0(Number(v))}
                  label={
                    hideAxisText || !SHOW_AXIS_LABELS
                      ? undefined
                      : {
                          value: rightLabel,
                          angle: 90,
                          position: "insideRight",
                          fill: AXIS_COLOR,
                          fontWeight: 900,
                        }
                  }
                />

                <Tooltip content={<CustomTooltip />} cursor={{ strokeOpacity: 0.25 }} isAnimationActive={false} />

                {show.gold && (
                  <Line
                    name="Gold"
                    yAxisId={usdAxisId}
                    type="monotone"
                    dataKey="goldValue"
                    stroke="#f2c36b"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {show.silver && (
                  <Line
                    name="Silver"
                    yAxisId={usdAxisId}
                    type="monotone"
                    dataKey="silverValue"
                    stroke="#0e2d4a"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {show.strat && (
                  <Line
                    name="My Portfolio"
                    yAxisId={usdAxisId}
                    type="monotone"
                    dataKey="strat"
                    stroke="#a77d52"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {show.gsr && (
                  <Line
                    name="GSR"
                    yAxisId={gsrAxisId}
                    type="monotone"
                    dataKey="gsr"
                    stroke="#000000"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {(axisMode === "RATIO_BOTH" || axisMode === "MIXED") && show.gsr && Number.isFinite(g2s) && (
                  <ReferenceLine yAxisId="leftAxis" y={g2s} stroke="#94a3b8" strokeDasharray="4 4" />
                )}
                {(axisMode === "RATIO_BOTH" || axisMode === "MIXED") && show.gsr && Number.isFinite(s2g) && (
                  <ReferenceLine yAxisId="leftAxis" y={s2g} stroke="#94a3b8" strokeDasharray="4 4" />
                )}

                {axisMode === "USD_BOTH" && (
                  <Line
                    name="__axis_helper__usd_left__"
                    yAxisId="leftAxis"
                    dataKey={usdHelperKey}
                    type="monotone"
                    stroke="transparent"
                    strokeWidth={1}
                    dot={false}
                    activeDot={false}
                    legendType="none"
                    tooltipType="none"
                    connectNulls
                    isAnimationActive={false}
                  />
                )}

                {axisMode === "RATIO_BOTH" && show.gsr && (
                  <Line
                    name="__axis_helper__ratio_right__"
                    yAxisId="rightAxis"
                    dataKey="gsr"
                    type="monotone"
                    stroke="transparent"
                    strokeWidth={1}
                    dot={false}
                    activeDot={false}
                    legendType="none"
                    tooltipType="none"
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
