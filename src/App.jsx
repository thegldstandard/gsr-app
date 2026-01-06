import React, { useEffect, useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import {

const dmyToISO = (dmy) => {
  const m = String(dmy || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const dd = m[1], mm = m[2], yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
};

const clampISODate = (iso, minIso, maxIso) => {
  if (!iso) return iso;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;

  const minT = Date.parse(minIso);
  const maxT = Date.parse(maxIso);

  if (Number.isFinite(minT) && t < minT) return minIso;
  if (Number.isFinite(maxT) && t > maxT) return maxIso;
  return iso;
};
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from "recharts";

/* ====================== CONFIG ====================== */
/** Put CSV at: public/data/prices.csv */
const CSV_REL_PATH = "data/prices.csv";

/**
 * ✅ IMPORTANT:
 * App uses CSV ONLY at runtime (static + identical across devices).
 * API is NOT called from the browser.
 */
const ENABLE_API_TOPUP = false;

/**
 * ✅ IMPORTANT:
 * Users are NOT allowed to use "today".
 * Latest selectable date is yesterday (local time).
 * Even if CSV contains today, it will be ignored.
 */
const DISALLOW_TODAY = true;
/* ==================================================== */

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

const fmtInt = (n) => {
  const x = typeof n === "bigint" ? n : BigInt(Math.trunc(n || 0));
  const abs = x < 0n ? -x : x;
  if (abs <= 9_000_000_000_000_000n) return Number(x).toLocaleString("en-GB");
  return x.toString();
};

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

const parseIntOrNull = (s) => {
  if (s == null) return null;
  const raw = String(s).trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
};

const startOfLocalDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* ----------------- UNIVERSAL DETERMINISTIC MATH ----------------- */
const PRICE_SCALE = 1_000_000n; // micro USD
const CENTS_TO_MICRO = 10_000n; // 1 cent = 10,000 micro USD
const OZ_SCALE = 1_000_000_000_000n; // 1e12

const bi = (x) => BigInt(x);

const divRoundHalfUp = (num, den) => {
  if (den === 0n) return 0n;
  const sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (a + b / 2n) / b;
  return sign * q;
};

const toPriceMicro = (priceNumber) => {
  if (!Number.isFinite(priceNumber)) return null;
  const s = Number(priceNumber).toFixed(6);
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1) : s;
  const [a, b = ""] = t.split(".");
  const frac = (b + "000000").slice(0, 6);
  const out = bi(a) * PRICE_SCALE + bi(frac);
  return neg ? -out : out;
};

const centsToMicro = (cents) => bi(cents) * CENTS_TO_MICRO;
const microToCents = (micro) => divRoundHalfUp(micro, CENTS_TO_MICRO);

const usdCentsToOuncesScaled = (usdCents, priceMicro) => {
  const usdMicro = centsToMicro(usdCents);
  return divRoundHalfUp(usdMicro * OZ_SCALE, priceMicro);
};

const ouncesScaledToUsdCents = (ozScaled, priceMicro) => {
  const usdMicro = divRoundHalfUp(ozScaled * priceMicro, OZ_SCALE);
  return microToCents(usdMicro);
};

const applyFee97pct = (usdCents) => divRoundHalfUp(bi(usdCents) * 97n, 100n);

const centsToRoundedDollars = (cents) => divRoundHalfUp(bi(cents), 100n);
const fmtMoney0 = (cents) => `$${fmtInt(centsToRoundedDollars(cents))}`;

/* -------- ticks -------- */
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

/* ---- CSV fetch: tries BOTH dev + gh-pages paths ---- */
async function fetchCSVText() {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  const bust = `?v=${Date.now()}`;

  const candidates = [
    `${base}${CSV_REL_PATH}${bust}`, // gh-pages + base
    `/${CSV_REL_PATH}${bust}`,       // dev root
  ];

  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`CSV HTTP ${res.status} for ${url}`);
        continue;
      }

      const textRaw = await res.text();

      if (
        /^\s*<!doctype/i.test(textRaw) ||
        (textRaw.includes("<html") && textRaw.includes("</html>"))
      ) {
        lastErr = new Error(
          `Got HTML instead of CSV from ${url}\n` +
            `Make sure you have: public/data/prices.csv (and restart npm run dev)`
        );
        continue;
      }

      return textRaw.replace(/^\uFEFF/, "");
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("prices.csv not found. Expected: public/data/prices.csv");
}

/* ----------------- mobile sizing hook ----------------- */
function useViewportMetrics() {
  const read = () => {
    const w = typeof window !== "undefined" ? Math.round(window.innerWidth) : 1200;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const h = Math.round(vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800));
    return {
      w,
      h,
      isMobile: w <= 640,
      isTablet: w > 640 && w <= 1024,
      isLandscape: w > h,
    };
  };

  const [m, setM] = useState(read);

  useEffect(() => {
    let rafId = 0;
    let until = 0;
    let last = read();

    const apply = () => {
      const next = read();
      if (next.w !== last.w || next.h !== last.h || next.isLandscape !== last.isLandscape) {
        last = next;
        setM(next);
      }
    };

    const loop = () => {
      apply();
      if (performance.now() < until) rafId = requestAnimationFrame(loop);
      else rafId = 0;
    };

    const shortPoll = (ms = 900) => {
      until = performance.now() + ms;
      if (!rafId) rafId = requestAnimationFrame(loop);
    };

    const onResize = () => {
      apply();
      shortPoll(1000);
    };

    const onScroll = () => shortPoll(1200);

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", onResize, { passive: true });
      vv.addEventListener("scroll", onScroll, { passive: true });
    }

    const onVis = () => {
      if (document.visibilityState === "visible") shortPoll(1200);
    };
    document.addEventListener("visibilitychange", onVis);

    apply();
    shortPoll(600);

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

  return m;
}

/* ----------------- tooltips ----------------- */
function InfoTip({ id, activeId, setActiveId, text }) {
  const open = activeId === id;
  const touchedRef = useRef(false);

  return (
    <span
      className="gsr-tipWrap"
      onMouseEnter={() => {
        if (!touchedRef.current) setActiveId(id);
      }}
      onMouseLeave={() => {
        if (!touchedRef.current) setActiveId(null);
      }}
    >
      <button
        type="button"
        className="gsr-tipBtn"
        aria-label="Info"
        aria-expanded={open}
        onPointerDown={(e) => {
          touchedRef.current = true;
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          setActiveId((cur) => (cur === id ? null : id));
        }}
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
  useEffect(() => setTxt((value ?? 0).toLocaleString("en-GB")), [value]);

  const handleChange = (e) => {
    const digits = e.target.value.replace(/[^\d]/g, "");
    const n = digits ? parseInt(digits, 10) : 0;
    onChange(n);
    setTxt(n.toLocaleString("en-GB"));
  };

  return <input className={`gsr-pill ${className}`} inputMode="numeric" value={txt} onChange={handleChange} />;
}

/* ----------------- Ratio input ----------------- */
function RatioInput({ label, valueText, onChangeText, isMobile, min = 0, max = 999, step = 1 }) {
  const sanitize = (raw) => raw.replace(/[^\d]/g, "").slice(0, 4);

  const commitClamp = () => {
    if (!valueText) return;
    const n = parseIntOrNull(valueText);
    if (n == null) return;
    onChangeText(String(clampInt(n, min, max)));
  };

  const nNow = parseIntOrNull(valueText);

  const bump = (dir) => {
    const base = nNow == null ? 0 : nNow;
    const next = clampInt(base + dir * step, min, max);
    onChangeText(String(next));
  };

  return (
    <div className="gsr-control">
      <span className="gsr-label">{label}</span>
      <div className={`gsr-stepper ${isMobile ? "is-mobile" : ""}`}>
        <input
          className="gsr-pill gsr-pill--small gsr-stepperInput"
          type="number"
          inputMode="numeric"
          step={step}
          value={valueText}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChangeText("");
            onChangeText(sanitize(raw));
          }}
          onBlur={commitClamp}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
              commitClamp();
            }
          }}
        />
        <div className="gsr-stepperBtns">
          <button type="button" className="gsr-stepBtn" onClick={() => bump(+1)} tabIndex={isMobile ? 0 : -1}>▲</button>
          <button type="button" className="gsr-stepBtn" onClick={() => bump(-1)} tabIndex={isMobile ? 0 : -1}>▼</button>
        </div>
      </div>
    </div>
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
    <div style={{ background: "rgba(255,255,255,0.96)", borderRadius: 12, padding: "10px 12px", color: "#0b1b2a", boxShadow: "0 10px 25px rgba(0,0,0,0.22)", minWidth: 220, maxWidth: 340 }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>{labelText}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: r.color, display: "inline-block" }} />
              <span>{r.name}</span>
            </div>
            <div style={{ fontWeight: 1000 }}>{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------- duration between 2 dates -------- */
function diffYearsMonths(startDate, endDate) {
  if (!startDate || !endDate) return { years: 0, months: 0 };
  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/* ================== component ================== */
export default function App() {
  const { isMobile, isTablet, w, h } = useViewportMetrics();

  const [activeTipId, setActiveTipId] = useState(null);
  useEffect(() => {
    const close = () => setActiveTipId(null);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const [rows, setRows] = useState([]);
const { minISO, maxISO } = useMemo(() => {
  if (!Array.isArray(rows) || rows.length === 0) return { minISO: "", maxISO: "" };

  const isValidISO = (iso) => Number.isFinite(Date.parse(iso));

  const isos = rows
    .map(r => dmyToISO(r.date ?? r.Date ?? r.DATE))
    .filter(iso => iso && isValidISO(iso))
    .sort(); // YYYY-MM-DD sorts lexicographically

  if (isos.length === 0) return { minISO: "", maxISO: "" };
  return { minISO: isos[0], maxISO: isos[isos.length - 1] };
}, [rows]);

  const [err, setErr] = useState("");

  const [show, setShow] = useState({ gold: true, silver: true, strat: true, gsr: true });
  const [amount, setAmount] = useState(1000);

  const [startIso, setStartIso] = useState("");
  const [endIso, setEndIso] = useState("");

  const [g2sText, setG2SText] = useState("85");
  const [s2gText, setS2GText] = useState("65");

  const [startMetal, setStartMetal] = useState("silver");

  const g2s = useMemo(() => {
    const n = parseIntOrNull(g2sText);
    return n == null ? null : clampInt(n, 0, 999);
  }, [g2sText]);

  const s2g = useMemo(() => {
    const n = parseIntOrNull(s2gText);
    return n == null ? null : clampInt(n, 0, 999);
  }, [s2gText]);

  const AXIS_COLOR = "#0b1b2a";
  const AXIS_WIDTH = isMobile ? 74 : isTablet ? 92 : 120;
  const SHOW_AXIS_LABELS = !isMobile;

  const CHART_MARGIN = useMemo(() => {
    if (isMobile) return { top: 18, right: 8, left: 8, bottom: 18 };
    return { top: 20, right: 15, left: 15, bottom: 22 };
  }, [isMobile]);

  const CHART_HEIGHT = useMemo(() => {
    const vh = h;
    const vw = w;
    const landscape = vw > vh;

    if (isMobile && landscape) return Math.max(260, Math.min(560, Math.round(vh * 0.78)));
    if (isMobile) return Math.max(320, Math.min(520, Math.round(vh * 0.52)));
    if (isTablet) return 520;
    return 660;
  }, [isMobile, isTablet, w, h]);

  /* ========= LOAD DATA (CSV ONLY; ignore "today") ========= */
  useEffect(() => {
    (async () => {
      try {
        const text = await fetchCSVText();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

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

        mapped.sort((a, b) => a.date - b.date);

        // ✅ enforce "yesterday only" (static, deterministic)
        if (DISALLOW_TODAY) {
          const yesterdayLocal = addDays(startOfLocalDay(new Date()), -1);
          mapped = mapped.filter((r) => startOfLocalDay(r.date) <= yesterdayLocal);
        }

        // ✅ App must never use API at runtime
        // (kept only as a hard guarantee)
        if (ENABLE_API_TOPUP) {
          console.warn("ENABLE_API_TOPUP is true, but runtime API usage is disabled in this build.");
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

  const bounds = useMemo(() => {
    if (!rows.length) return { minIso: "", maxIso: "" };
    return { minIso: toIsoLocal(rows[0].date), maxIso: toIsoLocal(rows[rows.length - 1].date) };
  }, [rows]);

  // ✅ snap any ISO date to nearest available (handles weekends/gaps)
  const snapToNearestAvailable = (iso) => {
    if (!iso || !rows.length) return iso;
    if (dateMap.has(iso)) return iso;

    const d0 = fromIsoLocal(iso);
    if (!d0) return iso;

    for (let i = 1; i <= 3660; i++) {
      const back = toIsoLocal(addDays(d0, -i));
      if (dateMap.has(back)) return back;
      const fwd = toIsoLocal(addDays(d0, +i));
      if (dateMap.has(fwd)) return fwd;
    }
    return iso;
  };

  // ✅ hard constrain date input to [min,max] and snap to nearest data
  const sanitizeIso = (rawIso) => {
    if (!rawIso || !rows.length) return rawIso;

    let iso = rawIso;
    if (bounds.minIso && iso < bounds.minIso) iso = bounds.minIso;
    if (bounds.maxIso && iso > bounds.maxIso) iso = bounds.maxIso;

    iso = snapToNearestAvailable(iso);

    if (bounds.minIso && iso < bounds.minIso) iso = bounds.minIso;
    if (bounds.maxIso && iso > bounds.maxIso) iso = bounds.maxIso;

    return iso;
  };

  const onChangeStartIso = (rawIso) => {
    const nextStart = sanitizeIso(rawIso);
    setStartIso(nextStart);

    setEndIso((curEnd) => {
      const endSan = sanitizeIso(curEnd);
      if (!endSan) return endSan;
      if (nextStart && endSan < nextStart) return nextStart;
      return endSan;
    });
  };

  const onChangeEndIso = (rawIso) => {
    const nextEnd = sanitizeIso(rawIso);
    setEndIso(nextEnd);

    setStartIso((curStart) => {
      const startSan = sanitizeIso(curStart);
      if (!startSan) return startSan;
      if (nextEnd && startSan > nextEnd) return nextEnd;
      return startSan;
    });
  };

  const { startIsoAdj, endIsoAdj } = useMemo(() => {
    return { startIsoAdj: sanitizeIso(startIso), endIsoAdj: sanitizeIso(endIso) };
  }, [startIso, endIso, rows, dateMap, bounds.minIso, bounds.maxIso]);

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
    const goldMicro0 = toPriceMicro(start.gold);
    const silverMicro0 = toPriceMicro(start.silver);
    if (!goldMicro0 || !silverMicro0) return [];

    const amountCents = bi(amount) * 100n;

    const goldOzScaledBH = amount > 0 && start.gold > 0 ? usdCentsToOuncesScaled(amountCents, goldMicro0) : 0n;
    const silverOzScaledBH = amount > 0 && start.silver > 0 ? usdCentsToOuncesScaled(amountCents, silverMicro0) : 0n;

    return windowed
      .map((r) => {
        const gMicro = toPriceMicro(r.gold);
        const sMicro = toPriceMicro(r.silver);
        if (!gMicro || !sMicro) return null;

        const goldValueCents = ouncesScaledToUsdCents(goldOzScaledBH, gMicro);
        const silverValueCents = ouncesScaledToUsdCents(silverOzScaledBH, sMicro);

        return {
          ...r,
          goldMicro: gMicro,
          silverMicro: sMicro,
          goldValueCents,
          silverValueCents,
          goldValue: Number(goldValueCents) / 100,
          silverValue: Number(silverValueCents) / 100,
        };
      })
      .filter(Boolean);
  }, [windowed, amount]);

  const withStrategy = useMemo(() => {
    if (!valuedRows.length) return { data: [], endsIn: "gold" };

    const amountCents = bi(amount) * 100n;
    let metal = startMetal === "silver" ? "silver" : "gold";
    const first = valuedRows[0];

    let ozGoldScaled = 0n;
    let ozSilverScaled = 0n;

    if (metal === "gold") ozGoldScaled = usdCentsToOuncesScaled(amountCents, first.goldMicro);
    else ozSilverScaled = usdCentsToOuncesScaled(amountCents, first.silverMicro);

    let switchesCount = 0;

    const out = valuedRows.map((r, idx) => {
      if (idx > 0) {
        const prev = valuedRows[idx - 1];
        const up = Number.isFinite(g2s) && prev.gsr < g2s && r.gsr >= g2s;
        const down = Number.isFinite(s2g) && prev.gsr > s2g && r.gsr <= s2g;

        if (metal === "gold" && up) {
          const usdCents = ouncesScaledToUsdCents(ozGoldScaled, r.goldMicro);
          const afterFee = applyFee97pct(usdCents);
          ozGoldScaled = 0n;
          ozSilverScaled = usdCentsToOuncesScaled(afterFee, r.silverMicro);
          metal = "silver";
          switchesCount++;
        } else if (metal === "silver" && down) {
          const usdCents = ouncesScaledToUsdCents(ozSilverScaled, r.silverMicro);
          const afterFee = applyFee97pct(usdCents);
          ozSilverScaled = 0n;
          ozGoldScaled = usdCentsToOuncesScaled(afterFee, r.goldMicro);
          metal = "gold";
          switchesCount++;
        }
      }

      const stratCents =
        metal === "gold"
          ? ouncesScaledToUsdCents(ozGoldScaled, r.goldMicro)
          : ouncesScaledToUsdCents(ozSilverScaled, r.silverMicro);

      return { ...r, stratCents, strat: Number(stratCents) / 100, switches: switchesCount, stratMetal: metal };
    });

    return { data: out, endsIn: out[out.length - 1]?.stratMetal || metal };
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
    const amountCents = bi(amount) * 100n;

    if (!data.length) {
      return {
        gvC: amountCents,
        svC: amountCents,
        pvC: amountCents,
        gchgC: 0n,
        schgC: 0n,
        pchgC: 0n,
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

    const gvC = end.goldValueCents ?? amountCents;
    const svC = end.silverValueCents ?? amountCents;
    const pvC = end.stratCents ?? amountCents;

    const gchgC = gvC - amountCents;
    const schgC = svC - amountCents;
    const pchgC = pvC - amountCents;

    const gpct = amountCents > 0n ? (Number(gvC) / Number(amountCents) - 1) * 100 : 0;
    const spct = amountCents > 0n ? (Number(svC) / Number(amountCents) - 1) * 100 : 0;
    const ppct = amountCents > 0n ? (Number(pvC) / Number(amountCents) - 1) * 100 : 0;

    const diffPg = ppct - gpct;
    const diffPs = ppct - spct;

    let totalG = 0, winsG = 0;
    let totalS = 0, winsS = 0;

    for (const r of data) {
      if (r.stratCents != null && r.goldValueCents != null) {
        totalG++;
        if (r.stratCents > r.goldValueCents) winsG++;
      }
      if (r.stratCents != null && r.silverValueCents != null) {
        totalS++;
        if (r.stratCents > r.silverValueCents) winsS++;
      }
    }

    const pBeatsG = totalG ? (winsG / totalG) * 100 : 0;
    const pBeatsS = totalS ? (winsS / totalS) * 100 : 0;

    return {
      gvC, svC, pvC,
      gchgC, schgC, pchgC,
      gpct, spct, ppct,
      diffPg, diffPs,
      switches: end.switches ?? 0,
      pBeatsG, pBeatsS,
      endsIn: (withStrategy.endsIn || "gold").toUpperCase(),
    };
  }, [data, amount, withStrategy.endsIn]);

  const { usdDomain, usdTicks } = useMemo(() => {
    if (!data.length) return { usdDomain: ["auto", "auto"], usdTicks: undefined };

    let min = Infinity;
    let max = -Infinity;

    for (const r of data) {
      if (show.gold && r.goldValue != null) { min = Math.min(min, r.goldValue); max = Math.max(max, r.goldValue); }
      if (show.silver && r.silverValue != null) { min = Math.min(min, r.silverValue); max = Math.max(max, r.silverValue); }
      if (show.strat && r.strat != null) { min = Math.min(min, r.strat); max = Math.max(max, r.strat); }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return { usdDomain: ["auto", "auto"], usdTicks: undefined };
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

    if (!Number.isFinite(min) || !Number.isFinite(max)) return { ratioDomain: ["auto", "auto"], ratioTicks: undefined };
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

  const leftLabel = hideAxisText ? "" : leftIsRatio ? "Ratio" : "Value (USD)";
  const rightLabel = hideAxisText ? "" : rightIsRatio ? "Ratio" : "Value (USD)";

  const usdAxisId = axisMode === "USD_BOTH" || axisMode === "MIXED" ? "rightAxis" : "leftAxis";

  const usdHelperKey = useMemo(() => {
    if (show.strat) return "strat";
    if (show.gold) return "goldValue";
    if (show.silver) return "silverValue";
    return "goldValue";
  }, [show.strat, show.gold, show.silver]);

  const axisKeyPart = useMemo(() => {
    return JSON.stringify({ axisMode, show, usdAxisId, usdDomain, usdTicks, ratioDomain, ratioTicks });
  }, [axisMode, show, usdAxisId, usdDomain, usdTicks, ratioDomain, ratioTicks]);

  const chartRemountKey = useMemo(
    () => JSON.stringify({ w, h, chartH: CHART_HEIGHT, axisKeyPart }),
    [w, h, CHART_HEIGHT, axisKeyPart]
  );

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
        @media (max-width: 1200px){ .gsr-controls{ grid-template-columns: 1fr 1fr; gap: 12px; } }
        @media (max-width: 520px){ .gsr-controls{ grid-template-columns: 1fr; } }

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

        .gsr-stepper{ position: relative; width: 100%; }
        .gsr-stepperInput{ padding-right: 44px; }
        .gsr-stepperBtns{
          position:absolute; right: 10px; top: 50%; transform: translateY(-50%);
          display: none; flex-direction: column; gap: 4px; z-index: 2;
        }
        .gsr-stepper.is-mobile .gsr-stepperBtns{ display:flex; }
        .gsr-stepBtn{
          width: 26px; height: 16px; border-radius: 10px; border: 0;
          background: rgba(11,27,42,0.10); color: #0b1b2a;
          font-weight: 1000; font-size: 11px; line-height: 16px;
          cursor: pointer; padding: 0;
          display:flex; align-items:center; justify-content:center; user-select:none;
        }

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

        .gsr-cards{
          display:grid;
          grid-template-columns: 360px 1fr;
          gap: 16px;
          margin-bottom: 12px;
          align-items: stretch;
        }
        @media (max-width: 1200px){ .gsr-cards{grid-template-columns: 1fr;} }
        .gsr-leftStack{ display:grid; grid-template-rows: 1fr 1fr; gap: 16px; }

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
        .gsr-muted{ color:#486076; font-weight: 900; display:inline-flex; align-items:center; }
        .gsr-strong{ color:#0b1b2a; font-weight: 1000; }

        .gsr-card--portfolio{ min-height: 100%; padding: 18px 18px 16px; }
        .gsr-card--portfolio .gsr-cardTitle{ font-size: 52px; }
        .gsr-card--portfolio .gsr-cardValue{ font-size: 38px; }
        .gsr-card--portfolio .gsr-cardInner{ font-size: 18px; padding: 16px 16px; }

        .gsr-portfolioGrid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 20px;
          row-gap: 10px;
          align-items:baseline;
        }
        .gsr-portfolioGrid .right{ text-align:right; }

        .gsr-error{color:#ffb4b4; font-weight:900; white-space:pre-line;}

        .gsr-chartWrap{
          background: var(--panel);
          border-radius: var(--radius);
          box-shadow: var(--shadow);
          padding: 10px 12px 12px;
        }
        .gsr-chartTop{ display:flex; justify-content:flex-end; gap: 14px; padding: 6px 6px 8px; flex-wrap: wrap; }
        .gsr-toggle{ display:flex; align-items:center; gap:6px; color: #0b1b2a; font-weight: 1000; user-select:none; white-space:nowrap; font-size: 14px; }
        .gsr-dot{ width: 11px; height: 11px; border-radius: 999px; display:inline-block; }
        .gsr-chartInner{ width: 100%; height: ${CHART_HEIGHT}px; max-height: 90dvh; display:flex; align-items:center; justify-content:center; }

        .gsr-tipWrap{ position: relative; display:inline-flex; align-items:center; margin-left: 6px; }
        .gsr-tipBtn{
          width: 18px; height: 18px; border-radius: 999px; border: 0;
          background: rgba(11,27,42,0.12); color: #0b1b2a;
          font-weight: 1000; font-size: 12px; line-height: 18px; text-align:center;
          cursor: pointer; padding: 0; display:inline-flex; align-items:center; justify-content:center;
          transform: translateY(-1px);
        }
        .gsr-tipBubble{
          position:absolute; z-index: 50;
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
          pointer-events: none;
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

        <section className="gsr-controls">
          <div className="gsr-control">
            <span className="gsr-label">Initial Amount (USD)</span>
            <CurrencyInput value={amount} onChange={setAmount} />
          </div>

          <DatePills label="Start Date (DD/MM/YYYY)" valueIso={startIsoAdj} onChangeIso={onChangeStartIso} compact />

          <div className="gsr-control">
            <span className="gsr-label">Ratio on Start Date</span>
            <div className="gsr-pillReadOnly gsr-pill--small">{startRatio != null ? fmt0(startRatio) : "—"}</div>
          </div>

          <DatePills label="End Date (DD/MM/YYYY)" valueIso={endIsoAdj} onChangeIso={onChangeEndIso} compact />

          <div className="gsr-control">
            <span className="gsr-label">Start Metal</span>
            <select className="gsr-pill gsr-pillSelect gsr-pill--small" value={startMetal} onChange={(e) => setStartMetal(e.target.value)}>
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
            </select>
          </div>

          <RatioInput label="Silver → Gold" valueText={s2gText} onChangeText={setS2GText} isMobile={isMobile} />
          <RatioInput label="Gold → Silver" valueText={g2sText} onChangeText={setG2SText} isMobile={isMobile} />
        </section>

        {err && <p className="gsr-error">Error: {err}</p>}

        {/* cards */}
        <section className="gsr-cards">
          <div className="gsr-leftStack">
            <div className="gsr-card">
              <div className="gsr-cardTitle">Gold</div>
              <div className="gsr-cardValue">{fmtMoney0(stats.gvC)}</div>
              <div className="gsr-cardInner">
                <div className="gsr-twoLine">
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Change:
                      <InfoTip id="gold_change" activeId={activeTipId} setActiveId={setActiveTipId} text="Change in value (USD) for the selected period." />
                    </span>
                    <span className="gsr-strong">{fmtMoney0(stats.gchgC)}</span>
                  </div>
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Return:
                      <InfoTip id="gold_return" activeId={activeTipId} setActiveId={setActiveTipId} text="Percentage return for the selected period." />
                    </span>
                    <span className="gsr-strong">{fmt0(stats.gpct)}%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="gsr-card">
              <div className="gsr-cardTitle">Silver</div>
              <div className="gsr-cardValue">{fmtMoney0(stats.svC)}</div>
              <div className="gsr-cardInner">
                <div className="gsr-twoLine">
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Change:
                      <InfoTip id="silver_change" activeId={activeTipId} setActiveId={setActiveTipId} text="Change in value (USD) for the selected period." />
                    </span>
                    <span className="gsr-strong">{fmtMoney0(stats.schgC)}</span>
                  </div>
                  <div className="gsr-row">
                    <span className="gsr-muted">
                      Return:
                      <InfoTip id="silver_return" activeId={activeTipId} setActiveId={setActiveTipId} text="Percentage return for the selected period." />
                    </span>
                    <span className="gsr-strong">{fmt0(stats.spct)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="gsr-card gsr-card--portfolio">
            <div className="gsr-cardTitle">My Portfolio</div>
            <div className="gsr-cardValue">{fmtMoney0(stats.pvC)}</div>

            <div className="gsr-cardInner">
              <div className="gsr-portfolioGrid">
                <div className="gsr-muted">
                  Change:
                  <InfoTip id="p_change" activeId={activeTipId} setActiveId={setActiveTipId} text="Change in value (USD) and percentage return for the selected period." />
                </div>
                <div className="right gsr-strong">{fmtMoney0(stats.pchgC)} | {fmt0(stats.ppct)}%</div>

                <div className="gsr-muted">
                  Duration:
                  <InfoTip id="p_duration" activeId={activeTipId} setActiveId={setActiveTipId} text="Total time between your chosen start date and end date (years and months)." />
                </div>
                <div className="right gsr-strong">{durationText}</div>

                <div className="gsr-muted">
                  Beats Gold (Time):
                  <InfoTip id="p_beats_g" activeId={activeTipId} setActiveId={setActiveTipId} text="Percentage of days where My Portfolio value is higher than staying in Gold." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.pBeatsG)}%</div>

                <div className="gsr-muted">
                  Beats Silver (Time):
                  <InfoTip id="p_beats_s" activeId={activeTipId} setActiveId={setActiveTipId} text="Percentage of days where My Portfolio value is higher than staying in Silver." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.pBeatsS)}%</div>

                <div className="gsr-muted">
                  vs Gold:
                  <InfoTip id="p_vs_g" activeId={activeTipId} setActiveId={setActiveTipId} text="My Portfolio return minus Gold-only return (percentage points)." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.diffPg)}%</div>

                <div className="gsr-muted">
                  vs Silver:
                  <InfoTip id="p_vs_s" activeId={activeTipId} setActiveId={setActiveTipId} text="My Portfolio return minus Silver-only return (percentage points)." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.diffPs)}%</div>

                <div className="gsr-muted">
                  Switches:
                  <InfoTip id="p_switches" activeId={activeTipId} setActiveId={setActiveTipId} text="Number of switches between Gold and Silver based on your thresholds." />
                </div>
                <div className="right gsr-strong">{fmt0(stats.switches)} &nbsp; <span className="gsr-muted">Ends in:</span> {stats.endsIn}</div>
              </div>
            </div>
          </div>
        </section>

        {/* chart */}
        <div className="gsr-chartWrap">
          <div className="gsr-chartTop">
            <label className="gsr-toggle">
              <input type="checkbox" checked={show.gold} onChange={(e) => setShow((s) => ({ ...s, gold: e.target.checked }))} />
              <span className="gsr-dot" style={{ background: "#f2c36b" }} />
              Gold
            </label>
            <label className="gsr-toggle">
              <input type="checkbox" checked={show.silver} onChange={(e) => setShow((s) => ({ ...s, silver: e.target.checked }))} />
              <span className="gsr-dot" style={{ background: "#0e2d4a" }} />
              Silver
            </label>
            <label className="gsr-toggle">
              <input type="checkbox" checked={show.strat} onChange={(e) => setShow((s) => ({ ...s, strat: e.target.checked }))} />
              <span className="gsr-dot" style={{ background: "#a77d52" }} />
              My Portfolio
            </label>
            <label className="gsr-toggle">
              <input type="checkbox" checked={show.gsr} onChange={(e) => setShow((s) => ({ ...s, gsr: e.target.checked }))} />
              <span className="gsr-dot" style={{ background: "#960019" }} />
              GSR
            </label>
          </div>

          <div className="gsr-chartInner">
            <ResponsiveContainer width="100%" height="100%" debounce={0} key={chartRemountKey}>
              <LineChart data={data} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />

                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    d instanceof Date ? d.toLocaleDateString("en-GB", { year: "2-digit", month: "short" }) : d
                  }
                  minTickGap={18}
                  tickMargin={10}
                  padding={{ left: 6, right: 6 }}
                  tick={{ fontSize: xTickFont, fontWeight: 900 }}
                />

                <YAxis
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
                  domain={leftIsRatio ? ratioDomain : usdDomain}
                  ticks={leftIsRatio ? ratioTicks : usdTicks}
                  tickFormatter={(v) => fmt0(Number(v))}
                  label={
                    hideAxisText || !SHOW_AXIS_LABELS
                      ? undefined
                      : { value: leftLabel, angle: -90, position: "insideLeft", offset: 0, dy: 0, fill: AXIS_COLOR, fontWeight: 900 }
                  }
                />

                <YAxis
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
                  domain={rightIsRatio ? ratioDomain : usdDomain}
                  ticks={rightIsRatio ? ratioTicks : usdTicks}
                  tickFormatter={(v) => fmt0(Number(v))}
                  label={
                    hideAxisText || !SHOW_AXIS_LABELS
                      ? undefined
                      : { value: rightLabel, angle: 90, position: "insideRight", offset: 0, dy: 0, fill: AXIS_COLOR, fontWeight: 900 }
                  }
                />

                <Tooltip content={<CustomTooltip />} cursor={{ strokeOpacity: 0.25 }} isAnimationActive={false} />

                {show.gold && <Line name="Gold" yAxisId={usdAxisId} type="monotone" dataKey="goldValue" stroke="#f2c36b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />}
                {show.silver && <Line name="Silver" yAxisId={usdAxisId} type="monotone" dataKey="silverValue" stroke="#0e2d4a" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />}
                {show.strat && <Line name="My Portfolio" yAxisId={usdAxisId} type="monotone" dataKey="strat" stroke="#a77d52" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />}
                {show.gsr && <Line name="GSR" yAxisId="leftAxis" type="monotone" dataKey="gsr" stroke="#960019" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#960019" }} connectNulls isAnimationActive={false} />}

                {(axisMode === "RATIO_BOTH" || axisMode === "MIXED") && show.gsr && g2s != null && <ReferenceLine yAxisId="leftAxis" y={g2s} stroke="#94a3b8" strokeDasharray="4 4" />}
                {(axisMode === "RATIO_BOTH" || axisMode === "MIXED") && show.gsr && s2g != null && <ReferenceLine yAxisId="leftAxis" y={s2g} stroke="#94a3b8" strokeDasharray="4 4" />}

                {axisMode === "USD_BOTH" && (
                  <Line name="__axis_helper__usd_left__" yAxisId="leftAxis" dataKey={usdHelperKey} type="monotone" stroke="transparent" strokeWidth={1} dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls isAnimationActive={false} />
                )}
                {axisMode === "RATIO_BOTH" && show.gsr && (
                  <Line name="__axis_helper__ratio_right__" yAxisId="rightAxis" dataKey="gsr" type="monotone" stroke="transparent" strokeWidth={1} dot={false} activeDot={false} legendType="none" tooltipType="none" connectNulls isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

