import fs from "node:fs";

const CSV_PATH = process.env.CSV_PATH;
const API_KEY  = process.env.METALPRICEAPI_KEY;
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS || "365");

if (!CSV_PATH) throw new Error("Missing env CSV_PATH");
if (!API_KEY)  throw new Error("Missing env METALPRICEAPI_KEY");
if (!Number.isFinite(BACKFILL_DAYS) || BACKFILL_DAYS <= 0 || BACKFILL_DAYS > 365) {
  throw new Error("BACKFILL_DAYS must be 1..365 (timeframe max range)");
}

function pad2(n){ return String(n).padStart(2,"0"); }

function toISO_UTC(d){
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
}
function toDMY_UTC(d){
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth()+1)}/${d.getUTCFullYear()}`;
}
function parseDMY_UTC(s){
  const m = String(s||"").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return null;
  const dd=+m[1], mm=+m[2], yyyy=+m[3];
  const dt = new Date(Date.UTC(yyyy, mm-1, dd, 0,0,0));
  return Number.isFinite(dt.valueOf()) ? dt : null;
}
function addDaysUTC(d, days){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()+days, 0,0,0));
}
function yesterdayUTC(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()-1, 0,0,0));
}
function csvEscape(v){
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function fmt6(x){ return Number(x).toFixed(6); }

function readCsvLines(){
  const raw = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/,"");
  const lines = raw.split(/\r?\n/);
  while(lines.length && !lines[lines.length-1].trim()) lines.pop();
  if(!lines.length) throw new Error("CSV empty");
  return lines;
}
function getHeaderInfo(headerLine){
  const header = headerLine.split(",").map(h => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const goldIdx = header.indexOf("gold");
  const silverIdx = header.indexOf("silver");
  const gsrIdx = header.indexOf("gsr"); // optional
  if(dateIdx===-1 || goldIdx===-1 || silverIdx===-1){
    throw new Error(`CSV header must include date,gold,silver. Found: ${headerLine}`);
  }
  return { dateIdx, goldIdx, silverIdx, gsrIdx, colCount: header.length };
}
function buildExisting(lines, header){
  const { dateIdx } = header;
  const byDMY = new Map();
  let min = null;
  for(let i=1;i<lines.length;i++){
    const line = lines[i];
    if(!line.trim()) continue;
    const cols = line.split(",");
    const dmy = (cols[dateIdx] ?? "").trim();
    const dt = parseDMY_UTC(dmy);
    if(!dt) continue;
    byDMY.set(dmy, line);
    if(!min || dt < min) min = dt;
  }
  return { byDMY, minDateUTC: min };
}

async function fetchTimeframe(startISO, endISO){
  const url =
    `https://api.metalpriceapi.com/v1/timeframe` +
    `?api_key=${encodeURIComponent(API_KEY)}` +
    `&base=USD&currencies=XAU,XAG` +
    `&start_date=${encodeURIComponent(startISO)}` +
    `&end_date=${encodeURIComponent(endISO)}`;

  const res = await fetch(url, { cache:"no-store" });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }

  if(!res.ok){
    throw new Error(`HTTP ${res.status} timeframe. Body: ${text.slice(0,200)}`);
  }
  if(json?.success === false || json?.error){
    throw new Error(`API error timeframe: ${JSON.stringify(json).slice(0,200)}`);
  }
  if(!json?.rates || typeof json.rates !== "object"){
    throw new Error(`Timeframe response missing 'rates'. Body: ${text.slice(0,200)}`);
  }
  return json.rates; // { "YYYY-MM-DD": { XAU:..., XAG:... }, ... }
}

async function main(){
  const lines = readCsvLines();
  const header = getHeaderInfo(lines[0]);
  const { byDMY, minDateUTC } = buildExisting(lines, header);

  if(!minDateUTC){
    throw new Error("CSV contains no parseable DD/MM/YYYY dates in date column.");
  }

  const endDate = yesterdayUTC();                 // static cap: yesterday (UTC)
  const windowStart = addDaysUTC(endDate, -BACKFILL_DAYS + 1);

  // Don’t try to fill earlier than the CSV’s own earliest date
  const startDate = (minDateUTC > windowStart) ? minDateUTC : windowStart;

  const startISO = toISO_UTC(startDate);
  const endISO   = toISO_UTC(endDate);

  console.log(`Updating CSV window: ${toDMY_UTC(startDate)} -> ${toDMY_UTC(endDate)} (UTC)`);
  const ratesByISO = await fetchTimeframe(startISO, endISO);

  const { dateIdx, goldIdx, silverIdx, gsrIdx, colCount } = header;

  let added = 0;
  // fill gaps day-by-day within window
  for(let d = startDate; d <= endDate; d = addDaysUTC(d, 1)){
    const dmy = toDMY_UTC(d);
    if(byDMY.has(dmy)) continue; // already in CSV

    const iso = toISO_UTC(d);
    const obj = ratesByISO[iso];
    const rXAU = Number(obj?.XAU);
    const rXAG = Number(obj?.XAG);

    // If API has no rates for that day, just skip (weekend/holiday/no data)
    if(!(rXAU > 0) || !(rXAG > 0)) continue;

    const goldUSD = 1 / rXAU;
    const silverUSD = 1 / rXAG;
    const gsr = silverUSD > 0 ? goldUSD / silverUSD : null;

    const cols = Array(colCount).fill("");
    cols[dateIdx] = dmy;
    cols[goldIdx] = fmt6(goldUSD);
    cols[silverIdx] = fmt6(silverUSD);
    if(gsrIdx !== -1 && gsr != null && Number.isFinite(gsr)) cols[gsrIdx] = fmt6(gsr);

    const line = cols.map(csvEscape).join(",");
    byDMY.set(dmy, line);
    added++;
  }

  // write file sorted by date
  const entries = Array.from(byDMY.entries());
  entries.sort((a,b) => {
    const ad = parseDMY_UTC(a[0])?.valueOf() ?? 0;
    const bd = parseDMY_UTC(b[0])?.valueOf() ?? 0;
    return ad - bd;
  });

  const outLines = [lines[0], ...entries.map(e => e[1])].join("\n") + "\n";
  fs.writeFileSync(CSV_PATH, outLines, "utf8");

  console.log(`Done. Added ${added} missing row(s). CSV now covers window through ${toDMY_UTC(endDate)} where data exists.`);
}

main().catch(err => { console.error(err?.stack || String(err)); process.exit(1); });
