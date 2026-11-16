// Prime Journal – MCP-Server
// Supabase Edge Function "journal-mcp". Verbindet Claude, ChatGPT und andere MCP-fähige KIs mit deinem Journal.
// Zugang: https://<projekt>.supabase.co/functions/v1/journal-mcp/<dein-schlüssel>
// Den Schlüssel erzeugst du in der App unter Einstellungen → KI-Anbindung. Ohne gültigen Schlüssel gibt es keine Daten.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const VERSION = "1.0.0";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, accept",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

type Doc = Record<string, any>;
type Acc = { uid: string; write: boolean; appUrl: string };

/* ---------- Zugang ---------- */
async function account(token: string): Promise<Acc | null> {
  if (!token || token.length < 24 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const { data, error } = await sb.from("docs").select("user_id,data").eq("col", "meta").eq("id", "mcp").eq("data->>token", token).limit(1);
  if (error || !data || !data.length || data[0].data?.enabled === false) return null;
  return { uid: data[0].user_id, write: !!data[0].data?.write, appUrl: data[0].data?.appUrl || "" };
}

/* ---------- Daten laden ---------- */
type DB = { trades: Doc[]; playbooks: Doc[]; days: Record<string, Doc>; weeks: Record<string, Doc>; reports: Doc[]; news: Doc[]; settings: Doc; strategy: string };
async function load(uid: string): Promise<DB> {
  const rows: Doc[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("docs").select("col,id,data").eq("user_id", uid).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data); if (data.length < 1000) break;
  }
  const db: DB = { trades: [], playbooks: [], days: {}, weeks: {}, reports: [], news: [], settings: {}, strategy: "" };
  const newsMap: Record<string, Doc> = {};
  for (const r of rows) {
    const d = { ...r.data, id: r.id };
    if (r.col === "trades") db.trades.push(d);
    else if (r.col === "playbooks") db.playbooks.push(d);
    else if (r.col === "days") db.days[r.id] = d;
    else if (r.col === "weeks") db.weeks[r.id] = d;
    else if (r.col === "reports") db.reports.push(d);
    else if (r.col === "news") (r.data.events || []).forEach((e: Doc) => newsMap[e.t + e.cur + e.title] = e);
    else if (r.col === "meta" && r.id === "settings") db.settings = r.data;
    else if (r.col === "meta" && r.id === "strategy") db.strategy = r.data.text || "";
  }
  db.news = Object.values(newsMap).sort((a, b) => a.t.localeCompare(b.t));
  db.trades.sort((a, b) => String(a.closeTime).localeCompare(String(b.closeTime)));
  return db;
}

/* ---------- Kennzahlen (gleiche Logik wie in der App) ---------- */
const pipSize = (s: string) => { const x = String(s || "").toUpperCase().replace(/[^A-Z]/g, ""); return /^[A-Z]{6}$/.test(x) ? (x.endsWith("JPY") ? 0.01 : 0.0001) : 1; };
const dir = (t: Doc) => t.side === "long" ? 1 : -1;
const pipsOf = (t: Doc) => t.entry != null && t.exit != null ? +(((t.exit - t.entry) * dir(t)) / pipSize(t.symbol)).toFixed(1) : null;
const riskPrice = (t: Doc) => t.sl != null && t.entry != null && Math.abs(t.entry - t.sl) > 0 ? Math.abs(t.entry - t.sl) : null;
const rOf = (t: Doc) => { if (t.risk > 0) return +(t.net / t.risk).toFixed(2); const rp = riskPrice(t); return rp && t.exit != null ? +(((t.exit - t.entry) * dir(t)) / rp).toFixed(2) : null; };
const crvOf = (t: Doc) => { const rp = riskPrice(t); return rp && t.tp != null ? +(Math.abs(t.tp - t.entry) / rp).toFixed(2) : null; };
const hm = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) + (m || 0) / 60; };
function sessionOf(t: Doc, st: Doc) {
  const s = t.openTime || ""; if (s.length < 16) return "unbekannt";
  const x = hm(s.slice(11, 16));
  if (x < hm(st.sessLondon || "09:00")) return "Asien"; if (x < hm(st.sessOverlap || "14:30")) return "London"; if (x < hm(st.sessNY || "17:30")) return "London/NY"; return "New York";
}
const WD = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const wd = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return WD[(new Date(y, m - 1, dd).getDay() + 6) % 7]; };
const holdMin = (t: Doc) => t.openTime && t.closeTime ? Math.round((Date.parse(t.closeTime) - Date.parse(t.openTime)) / 60000) : null;
const monday = (d: string) => { const [y, m, dd] = d.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, dd)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
function newsHits(t: Doc, db: DB) {
  if (!t.openTime || !t.closeTime) return [];
  const a = Date.parse(t.openTime) - 30 * 60000, b = Date.parse(t.closeTime) + 5 * 60000;
  return db.news.filter(e => e.impact === "High" && Date.parse(e.t) >= a && Date.parse(e.t) <= b).map(e => `${e.t.slice(11, 16)} ${e.cur} ${e.title}`);
}
function shape(t: Doc, db: DB, full = false) {
  const pb = db.playbooks.find(p => p.id === t.playbook);
  const rules = pb?.rules || [];
  const o: Doc = {
    id: t.id, date: t.date, open: t.openTime, close: t.closeTime, weekday: wd(t.date), session: sessionOf(t, db.settings),
    symbol: t.symbol, side: t.side, qty: t.qty, entry: t.entry, exit: t.exit, sl: t.sl ?? null, tp: t.tp ?? null,
    crv_planned: crvOf(t), r: rOf(t), pips: pipsOf(t), net: t.net, fees: t.fees, currency: t.currency, hold_min: holdMin(t),
    playbook: pb?.name || null, setup: t.fields || {}, rules_followed: rules.filter((r: string) => (t.rules || []).includes(r)).length + "/" + rules.length,
    tags: t.tags || [], mistakes: t.mistakes || [], rating: t.rating || null, news_during: newsHits(t, db), screenshots: (t.shots || []).length,
  };
  if (full) {
    o.rules_missed = rules.filter((r: string) => !(t.rules || []).includes(r)); o.rules_checked = (t.rules || []).filter((r: string) => rules.includes(r));
    o.notes = t.notes || ""; o.ai_notes = t.aiNotes || []; o.gross = t.gross; o.risk_amount = t.risk ?? null; o.executions = t.execs || []; o.source = t.source;
    const day = db.days[t.date]; if (day) o.day_journal = { plan: day.plan || "", review: day.review || "", mood: day.mood || "" };
  } else if (t.notes) o.notes = String(t.notes).slice(0, 280);
  if (t.demo) o.demo = true;
  return o;
}
function stats(ts: Doc[]) {
  let net = 0, gw = 0, gl = 0, w = 0, l = 0, be = 0, fees = 0, eq = 0, peak = 0, dd = 0, rS = 0, rN = 0, pipsS = 0;
  const daily: Record<string, number> = {};
  for (const t of ts) {
    const n = +t.net || 0; net += n; fees += +t.fees || 0;
    if (n > 0) { w++; gw += n; } else if (n < 0) { l++; gl += n; } else be++;
    eq += n; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak);
    daily[t.date] = (daily[t.date] || 0) + n;
    const r = rOf(t); if (r != null) { rS += r; rN++; }
    const p = pipsOf(t); if (p != null) pipsS += p;
  }
  const dv = Object.values(daily);
  const r2 = (x: number) => +x.toFixed(2);
  return {
    trades: ts.length, net: r2(net), fees: r2(fees), wins: w, losses: l, breakeven: be,
    win_rate: w + l ? r2(w / (w + l) * 100) : null, profit_factor: gl ? r2(gw / -gl) : (gw > 0 ? "∞" : null),
    avg_win: w ? r2(gw / w) : null, avg_loss: l ? r2(gl / l) : null, expectancy: ts.length ? r2(net / ts.length) : null,
    avg_r: rN ? r2(rS / rN) : null, trades_with_r: rN, total_pips: r2(pipsS), max_drawdown: r2(dd),
    trading_days: dv.length, green_days: dv.filter(v => v > 0).length, red_days: dv.filter(v => v < 0).length,
    best_day: dv.length ? r2(Math.max(...dv)) : null, worst_day: dv.length ? r2(Math.min(...dv)) : null,
  };
}

/* ---------- Filter ---------- */
const FILTER_PROPS = {
  from: { type: "string", description: "Startdatum YYYY-MM-DD (Schließdatum des Trades)" },
  to: { type: "string", description: "Enddatum YYYY-MM-DD" },
  last_n: { type: "integer", description: "Nur die letzten N Trades (nach Filterung)" },
  symbol: { type: "string" }, side: { type: "string", enum: ["long", "short"] },
  session: { type: "string", enum: ["Asien", "London", "London/NY", "New York"] },
  playbook: { type: "string", description: "Name des Playbooks, z. B. TrendFlow" },
  field: { type: "string", description: "Playbook-Merkmal, z. B. Trade-Qualität" }, field_value: { type: "string", description: "Wert des Merkmals, z. B. A" },
  tag: { type: "string" }, mistake: { type: "string" },
  result: { type: "string", enum: ["win", "loss", "breakeven"] },
  min_crv: { type: "number" }, max_crv: { type: "number" },
  weekday: { type: "string", description: "z. B. Montag" },
  include_demo: { type: "boolean", description: "Demo-Trades einbeziehen (Standard: nein)" },
};
function filter(db: DB, a: Doc) {
  let ts = db.trades.filter(t => a.include_demo || !t.demo);
  if (a.from) ts = ts.filter(t => t.date >= a.from); if (a.to) ts = ts.filter(t => t.date <= a.to);
  if (a.symbol) ts = ts.filter(t => String(t.symbol).toUpperCase().includes(String(a.symbol).toUpperCase().replace("/", ".")));
  if (a.side) ts = ts.filter(t => t.side === a.side);
  if (a.session) ts = ts.filter(t => sessionOf(t, db.settings) === a.session);
  if (a.playbook) { const p = db.playbooks.find(p => String(p.name).toLowerCase() === String(a.playbook).toLowerCase()); ts = ts.filter(t => p ? t.playbook === p.id : false); }
  if (a.field) ts = ts.filter(t => (t.fields || {})[a.field] === a.field_value || (!a.field_value && (t.fields || {})[a.field]));
  if (a.tag) ts = ts.filter(t => (t.tags || []).includes(a.tag));
  if (a.mistake) ts = ts.filter(t => (t.mistakes || []).includes(a.mistake));
  if (a.result) ts = ts.filter(t => a.result === "win" ? t.net > 0 : a.result === "loss" ? t.net < 0 : t.net === 0);
  if (a.min_crv != null) ts = ts.filter(t => (crvOf(t) ?? -1) >= a.min_crv);
  if (a.max_crv != null) ts = ts.filter(t => { const c = crvOf(t); return c != null && c <= a.max_crv; });
  if (a.weekday) ts = ts.filter(t => wd(t.date) === a.weekday);
  if (a.last_n) ts = ts.slice(-Math.max(1, Math.min(1000, a.last_n)));
  return ts;
}
function groupKey(t: Doc, by: string, db: DB): string[] {
  switch (by) {
    case "session": return [sessionOf(t, db.settings)];
    case "weekday": return [wd(t.date)];
    case "hour": return [(t.openTime || "").slice(11, 13) + ":00"];
    case "month": return [t.date.slice(0, 7)];
    case "week": return [monday(t.date)];
    case "side": return [t.side];
    case "symbol": return [t.symbol];
    case "playbook": return [db.playbooks.find(p => p.id === t.playbook)?.name || "ohne Playbook"];
    case "tag": return (t.tags || []).length ? t.tags : ["ohne Tag"];
    case "mistake": return (t.mistakes || []).length ? t.mistakes : ["keine Fehler"];
    case "rating": return [t.rating ? t.rating + " Sterne" : "ohne Bewertung"];
    case "crv": { const c = crvOf(t); return [c == null ? "ohne SL/TP" : c < 1 ? "< 1" : c < 1.5 ? "1–1,5" : c < 2 ? "1,5–2" : c < 3 ? "2–3" : "≥ 3"]; }
    case "hold": { const m = holdMin(t); return [m == null ? "unbekannt" : m < 5 ? "< 5 Min" : m < 15 ? "5–15 Min" : m < 30 ? "15–30 Min" : m < 60 ? "30–60 Min" : m < 240 ? "1–4 Std" : "> 4 Std"]; }
    case "news": return [newsHits(t, db).length ? "High-Impact-News während des Trades" : "ohne News im Trade"];
    case "rules_followed": { const p = db.playbooks.find(p => p.id === t.playbook); if (!p || !(p.rules || []).length) return ["ohne Playbook"]; const f = (t.rules || []).filter((r: string) => p.rules.includes(r)).length; return [f === p.rules.length ? "alle Regeln erfüllt" : `${p.rules.length - f} Regel(n) verletzt`]; }
  }
  if (by.startsWith("field:")) { const f = by.slice(6); return [(t.fields || {})[f] || "nicht gesetzt"]; }
  return ["?"];
}

/* ---------- Tools ---------- */
const TOOLS: Doc[] = [
  { name: "get_context", description: "Zuerst aufrufen. Liefert Strategie-Beschreibung, Playbooks mit allen Regeln und Merkmalen, Einstellungen (Währung, Limits, Session-Zeiten), Datenumfang und die Liste der Tags und Fehler.", inputSchema: { type: "object", properties: {} } },
  { name: "get_stats", description: "Kennzahlen (Netto, Trefferquote, Profit-Faktor, Erwartungswert, Ø R, Pips, Drawdown, grüne Tage) für gefilterte Trades, optional gruppiert. group_by: session, weekday, hour, month, week, side, symbol, playbook, tag, mistake, rating, crv, hold, news, rules_followed oder field:<Merkmal> (z. B. field:Trade-Qualität).", inputSchema: { type: "object", properties: { ...FILTER_PROPS, group_by: { type: "string" } } } },
  { name: "list_trades", description: "Liste von Trades mit allen Kerndaten (Entry, Exit, SL, TP, CRV, R, Pips, Session, Playbook, Merkmale, Regeln, Tags, Fehler, News, gekürzte Notiz). Standard: neueste 50.", inputSchema: { type: "object", properties: { ...FILTER_PROPS, sort: { type: "string", enum: ["newest", "oldest", "best", "worst"] }, limit: { type: "integer", description: "max. 300" } } } },
  { name: "get_trade", description: "Ein Trade komplett: Notizen, erfüllte und verletzte Regeln, Merkmale, Ausführungen, Tagebuch des Tages, KI-Notizen. Mit include_screenshots=true werden die Chart-Screenshots als Bilder mitgeliefert.", inputSchema: { type: "object", properties: { id: { type: "string" }, include_screenshots: { type: "boolean" } }, required: ["id"] } },
  { name: "get_journal", description: "Tagebuch: Tagesplan, Rückblick und Stimmung pro Tag sowie Antworten im Wochenrückblick, für einen Zeitraum. Inklusive Tages-P&L und Limit-Verstößen.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
  { name: "get_rule_check", description: "Regeltreue und Fehleranalyse: pro Playbook-Regel wie oft sie erfüllt wurde und Ergebnis mit/ohne; Fehler sortiert nach Kosten; Tage über Trade- oder Verlustlimit.", inputSchema: { type: "object", properties: { ...FILTER_PROPS } } },
  { name: "get_news", description: "Gespeicherte Wirtschaftstermine für GBP und JPY (Zeit, Wichtigkeit, Prognose, Vorwert) in einem Zeitraum.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, impact: { type: "string", enum: ["High", "Medium", "Low"] } } } },
  { name: "list_reports", description: "Bereits gespeicherte KI-Berichte (Wochen-/Monatsberichte) mit Titel und Zeitraum; mit id den vollen Text.", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
  { name: "search", description: "Volltextsuche über Trades (Symbol, Notizen, Tags, Fehler), Tagebuch und Berichte. Liefert Treffer mit id für fetch.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "fetch", description: "Holt einen Treffer aus search vollständig (id wie trade:…, day:YYYY-MM-DD, week:YYYY-MM-DD, report:…).", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
];
const WRITE_TOOLS: Doc[] = [
  { name: "add_note", description: "Speichert eine KI-Notiz im Journal, sichtbar in der App. target: trade:<id>, day:YYYY-MM-DD oder week:YYYY-MM-DD (Montag).", inputSchema: { type: "object", properties: { target: { type: "string" }, text: { type: "string" } }, required: ["target", "text"] } },
  { name: "save_report", description: "Speichert einen Bericht (Markdown) im Journal unter KI-Berichte.", inputSchema: { type: "object", properties: { title: { type: "string" }, kind: { type: "string", enum: ["woche", "monat", "analyse"] }, from: { type: "string" }, to: { type: "string" }, markdown: { type: "string" } }, required: ["title", "markdown"] } },
];
const PROMPTS = [
  { name: "wochenbericht", description: "Wochenbericht für die letzte oder eine bestimmte Woche", arguments: [{ name: "woche", description: "Montag der Woche (YYYY-MM-DD), leer = letzte Woche", required: false }] },
  { name: "monatsbericht", description: "Monatsbericht mit Entwicklung und Schwerpunkten", arguments: [{ name: "monat", description: "YYYY-MM, leer = letzter Monat", required: false }] },
  { name: "trade_review", description: "Einzelnen Trade gegen Strategie und Regeln prüfen", arguments: [{ name: "trade_id", required: true }] },
  { name: "fehleranalyse", description: "Welche Fehler und Regelverstöße kosten am meisten?", arguments: [] },
];
function promptText(name: string, a: Doc) {
  const base = "Nutze die Tools des Prime Journals. Rufe zuerst get_context auf, damit du Strategie und Regeln kennst. Antworte auf Deutsch, konkret und mit Zahlen. Trenne Fakten aus den Daten klar von deinen Einschätzungen.";
  if (name === "wochenbericht") return `${base}\nErstelle meinen Wochenbericht${a.woche ? " für die Woche ab " + a.woche : " für die letzte abgeschlossene Woche"}: Kennzahlen (get_stats), Vergleich zur Vorwoche, Sessions, Playbooks und Trade-Qualität, Regeltreue und Fehler (get_rule_check), Tagebuch und Wochenrückblick (get_journal), News-Einfluss. Schließe mit 3 konkreten Fokuspunkten für nächste Woche. Speichere den Bericht danach mit save_report, falls verfügbar.`;
  if (name === "monatsbericht") return `${base}\nErstelle meinen Monatsbericht${a.monat ? " für " + a.monat : " für den letzten Monat"}: Entwicklung Woche für Woche, Equity und Drawdown, stärkste und schwächste Muster (Session, Wochentag, CRV, Merkmale), wiederkehrende Fehler, Regeltreue. Schließe mit Prioritäten für den nächsten Monat. Speichere den Bericht mit save_report, falls verfügbar.`;
  if (name === "trade_review") return `${base}\nAnalysiere Trade ${a.trade_id} mit get_trade (inkl. Screenshots). Prüfe ihn gegen das passende Playbook: Setup, Zone, Bestätigung, Liquidität, Trend, CRV, Regeln. Was war gut, was nicht, welche Trade-Qualität (A–D) hätte er verdient?`;
  return `${base}\nFinde mit get_rule_check und get_stats (group_by mistake, rules_followed, field:Trade-Qualität) heraus, welche Fehler und Regelverstöße mich am meisten Geld kosten, und gib konkrete Gegenmaßnahmen.`;
}

const b64 = (buf: ArrayBuffer) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const text = (o: unknown) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });

async function callTool(name: string, a: Doc, acc: Acc) {
  if ((name === "add_note" || name === "save_report") && !acc.write) return { ...text("Schreiben ist ausgeschaltet. Aktiviere es in der App unter Einstellungen → KI-Anbindung."), isError: true };
  const db = await load(acc.uid);
  switch (name) {
    case "get_context": {
      const real = db.trades.filter(t => !t.demo);
      return text({
        hinweis: "Persönliches Tradingjournal von Martin. Gehandelt wird GBP/JPY über Interactive Brokers. Beträge in " + (db.settings.currency || "EUR") + ". R = Netto / Risiko bzw. Kursbewegung / Abstand zum SL. CRV = geplantes Chance-Risiko-Verhältnis aus SL und TP.",
        strategie: db.strategy || "(noch keine Strategie-Beschreibung hinterlegt)",
        playbooks: db.playbooks.map(p => ({ name: p.name, beschreibung: p.description, regeln: p.rules, merkmale: p.fields })),
        einstellungen: { waehrung: db.settings.currency || "EUR", max_trades_pro_tag: db.settings.maxTrades ?? null, max_tagesverlust: db.settings.maxLoss ?? null, sessions: { london: db.settings.sessLondon || "09:00", london_ny: db.settings.sessOverlap || "14:30", new_york: db.settings.sessNY || "17:30" }, wochenfragen: db.settings.weekQuestions || [] },
        tags: db.settings.tags || [], fehler_liste: db.settings.mistakes || [],
        daten: { trades: real.length, demo_trades: db.trades.length - real.length, erster_trade: real[0]?.date || null, letzter_trade: real[real.length - 1]?.date || null, tagebuch_tage: Object.keys(db.days).length, berichte: db.reports.length, news_termine: db.news.length },
        schreiben_erlaubt: acc.write,
      });
    }
    case "get_stats": {
      const ts = filter(db, a); const out: Doc = { gesamt: stats(ts) };
      if (a.group_by) {
        const g: Record<string, Doc[]> = {}; ts.forEach(t => groupKey(t, a.group_by, db).forEach(k => (g[k] = g[k] || []).push(t)));
        out.gruppen = Object.entries(g).map(([k, x]) => ({ gruppe: k, ...stats(x) })).sort((x, y) => y.net - x.net);
      }
      return text(out);
    }
    case "list_trades": {
      let ts = filter(db, a); const lim = Math.min(300, a.limit || 50);
      if (a.sort === "best") ts = [...ts].sort((x, y) => y.net - x.net); else if (a.sort === "worst") ts = [...ts].sort((x, y) => x.net - y.net); else if (a.sort !== "oldest") ts = [...ts].reverse();
      return text({ anzahl_gesamt: ts.length, trades: ts.slice(0, lim).map(t => shape(t, db)) });
    }
    case "get_trade": {
      const t = db.trades.find(t => t.id === a.id); if (!t) return { ...text("Trade nicht gefunden: " + a.id), isError: true };
      const res: Doc = text(shape(t, db, true));
      if (a.include_screenshots) {
        for (const path of (t.shots || []).slice(0, 4)) {
          if (String(path).startsWith("local:")) continue;
          const { data } = await sb.storage.from("shots").download(path);
          if (data) res.content.push({ type: "image", data: b64(await data.arrayBuffer()), mimeType: data.type || "image/jpeg" });
        }
      }
      return res;
    }
    case "get_journal": {
      const from = a.from || "0000", to = a.to || "9999";
      const pnl: Record<string, { net: number; n: number }> = {}; db.trades.filter(t => !t.demo).forEach(t => { const x = pnl[t.date] = pnl[t.date] || { net: 0, n: 0 }; x.net += t.net; x.n++; });
      const dates = [...new Set([...Object.keys(db.days), ...Object.keys(pnl)])].filter(d => d >= from && d <= to).sort();
      const mt = +db.settings.maxTrades || 0, ml = +db.settings.maxLoss || 0;
      return text({
        tage: dates.map(d => ({ datum: d, wochentag: wd(d), trades: pnl[d]?.n || 0, netto: pnl[d] ? +pnl[d].net.toFixed(2) : 0, trade_limit_ueberschritten: mt > 0 && (pnl[d]?.n || 0) > mt, verlust_limit_erreicht: ml > 0 && (pnl[d]?.net || 0) <= -ml, plan: db.days[d]?.plan || "", rueckblick: db.days[d]?.review || "", stimmung: db.days[d]?.mood || "", ki_notizen: db.days[d]?.aiNotes || [] })),
        wochen: Object.entries(db.weeks).filter(([k]) => k >= monday(from === "0000" ? "2000-01-03" : from) && k <= to).map(([k, w]) => ({ woche_ab: k, antworten: w.answers || {}, ki_notizen: w.aiNotes || [] })),
      });
    }
    case "get_rule_check": {
      const ts = filter(db, a);
      const pbs = db.playbooks.map(p => { const x = ts.filter(t => t.playbook === p.id); return { playbook: p.name, trades: x.length, regeln: (p.rules || []).map((r: string) => { const y = x.filter(t => (t.rules || []).includes(r)), n = x.filter(t => !(t.rules || []).includes(r)); const sy = stats(y), sn = stats(n); return { regel: r, erfuellt_in_prozent: x.length ? +(y.length / x.length * 100).toFixed(0) : null, mit_regel: { trades: y.length, win_rate: sy.win_rate, net: sy.net, avg_r: sy.avg_r }, ohne_regel: { trades: n.length, win_rate: sn.win_rate, net: sn.net, avg_r: sn.avg_r } }; }) }; }).filter(p => p.trades);
      const mis: Record<string, Doc[]> = {}; ts.forEach(t => (t.mistakes || []).forEach((m: string) => (mis[m] = mis[m] || []).push(t)));
      const fehler = Object.entries(mis).map(([m, x]) => ({ fehler: m, ...stats(x) })).sort((x, y) => x.net - y.net);
      const byDay: Record<string, Doc[]> = {}; ts.forEach(t => (byDay[t.date] = byDay[t.date] || []).push(t));
      const mt = +db.settings.maxTrades || 0, ml = +db.settings.maxLoss || 0;
      const limit = Object.entries(byDay).filter(([, x]) => (mt > 0 && x.length > mt) || (ml > 0 && x.reduce((s, t) => s + t.net, 0) <= -ml)).map(([d, x]) => ({ datum: d, trades: x.length, netto: +x.reduce((s, t) => s + t.net, 0).toFixed(2) }));
      return text({ playbooks: pbs, fehler_nach_kosten: fehler, tage_ueber_limit: limit, ohne_playbook: ts.filter(t => !t.playbook).length });
    }
    case "get_news": {
      let ev = db.news; if (a.from) ev = ev.filter(e => e.t >= a.from); if (a.to) ev = ev.filter(e => e.t.slice(0, 10) <= a.to); if (a.impact) ev = ev.filter(e => e.impact === a.impact);
      return text({ hinweis: "Termine werden erst ab der ersten Nutzung der App wöchentlich gespeichert.", termine: ev });
    }
    case "list_reports": {
      if (a.id) { const r = db.reports.find(r => r.id === a.id); return r ? text(r) : { ...text("Bericht nicht gefunden"), isError: true }; }
      return text(db.reports.sort((x, y) => String(y.created).localeCompare(String(x.created))).map(r => ({ id: r.id, titel: r.title, art: r.kind, von: r.from, bis: r.to, erstellt: r.created })));
    }
    case "search": {
      const q = String(a.query || "").toLowerCase().trim(); const res: Doc[] = []; const url = (h: string) => acc.appUrl ? acc.appUrl + h : "";
      const hit = (s: unknown) => q && String(s || "").toLowerCase().includes(q);
      db.trades.forEach(t => { if (hit(t.symbol) || hit(t.notes) || (t.tags || []).some(hit) || (t.mistakes || []).some(hit) || hit(t.date) || (t.aiNotes || []).some((n: Doc) => hit(n.text))) res.push({ id: "trade:" + t.id, title: `${t.date} ${t.symbol} ${t.side} ${t.net}`, url: url("#trades") }); });
      Object.entries(db.days).forEach(([d, x]) => { if (hit(d) || hit(x.plan) || hit(x.review) || hit(x.mood)) res.push({ id: "day:" + d, title: "Tagebuch " + d, url: url("#tagebuch") }); });
      Object.entries(db.weeks).forEach(([d, x]) => { if (hit(d) || Object.values(x.answers || {}).some(hit)) res.push({ id: "week:" + d, title: "Wochenrückblick ab " + d, url: url("#tagebuch") }); });
      db.reports.forEach(r => { if (hit(r.title) || hit(r.markdown)) res.push({ id: "report:" + r.id, title: r.title, url: url("#berichte") }); });
      return text({ results: res.slice(0, 50) });
    }
    case "fetch": {
      const [kind, ...rest] = String(a.id || "").split(":"); const id = rest.join(":"); let doc: Doc | null = null, title = a.id;
      if (kind === "trade") { const t = db.trades.find(t => t.id === id); if (t) { doc = shape(t, db, true); title = `${t.date} ${t.symbol}`; } }
      else if (kind === "day") { doc = { datum: id, ...db.days[id], trades: db.trades.filter(t => t.date === id).map(t => shape(t, db)) }; title = "Tagebuch " + id; }
      else if (kind === "week") { doc = db.weeks[id] || null; title = "Wochenrückblick ab " + id; }
      else if (kind === "report") { const r = db.reports.find(r => r.id === id); if (r) { doc = r; title = r.title; } }
      if (!doc) return { ...text("Nicht gefunden: " + a.id), isError: true };
      return text({ id: a.id, title, text: JSON.stringify(doc, null, 1), url: acc.appUrl || "", metadata: { quelle: "Prime Journal" } });
    }
    case "add_note": {
      const [kind, ...rest] = String(a.target || "").split(":"); const id = rest.join(":");
      const col = kind === "trade" ? "trades" : kind === "day" ? "days" : kind === "week" ? "weeks" : null;
      if (!col || !id) return { ...text("target muss trade:<id>, day:YYYY-MM-DD oder week:YYYY-MM-DD sein"), isError: true };
      const { data: rows } = await sb.from("docs").select("data").eq("user_id", acc.uid).eq("col", col).eq("id", id).limit(1);
      if (col === "trades" && !rows?.length) return { ...text("Trade nicht gefunden: " + id), isError: true };
      const cur = rows?.[0]?.data || {};
      const note = { at: new Date().toISOString(), text: String(a.text).slice(0, 20000), source: "KI" };
      const { error } = await sb.from("docs").upsert({ user_id: acc.uid, col, id, data: { ...cur, aiNotes: [...(cur.aiNotes || []), note] }, updated_at: new Date().toISOString() });
      if (error) return { ...text("Speichern fehlgeschlagen: " + error.message), isError: true };
      return text("Notiz gespeichert bei " + a.target);
    }
    case "save_report": {
      const id = "r" + Date.now().toString(36);
      const data = { title: String(a.title).slice(0, 200), kind: a.kind || "analyse", from: a.from || "", to: a.to || "", markdown: String(a.markdown).slice(0, 200000), created: new Date().toISOString(), source: "KI" };
      const { error } = await sb.from("docs").upsert({ user_id: acc.uid, col: "reports", id, data, updated_at: data.created });
      if (error) return { ...text("Speichern fehlgeschlagen: " + error.message), isError: true };
      return text(`Bericht gespeichert (${id}). Er erscheint in der App unter „Berichte“.`);
    }
  }
  return { ...text("Unbekanntes Tool: " + name), isError: true };
}

async function handle(msg: Doc, acc: Acc): Promise<Doc | null> {
  const { id, method, params = {} } = msg;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return null; // Notification
  try {
    switch (method) {
      case "initialize": return ok({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "prime-journal", title: "Prime Journal", version: VERSION },
        instructions: "Persönliches Tradingjournal (GBP/JPY, Strategien TrendFlow und RangeFlow). Rufe zuerst get_context auf, um Strategie, Regeln und Einstellungen zu kennen. Nutze get_stats mit group_by für Vergleiche, get_rule_check für Regeltreue und Fehler, get_trade für Details inkl. Screenshots, get_journal für Tagebuch und Wochenrückblicke. Antworte auf Deutsch.",
      });
      case "ping": return ok({});
      case "tools/list": return ok({ tools: acc.write ? [...TOOLS, ...WRITE_TOOLS] : TOOLS });
      case "tools/call": return ok(await callTool(params.name, params.arguments || {}, acc));
      case "prompts/list": return ok({ prompts: PROMPTS });
      case "prompts/get": return ok({ description: PROMPTS.find(p => p.name === params.name)?.description || "", messages: [{ role: "user", content: { type: "text", text: promptText(params.name, params.arguments || {}) } }] });
      case "resources/list": return ok({ resources: [] });
      case "resources/templates/list": return ok({ resourceTemplates: [] });
      default: return err(-32601, "Methode nicht unterstützt: " + method);
    }
  } catch (e) { return err(-32603, (e as Error).message || String(e)); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  const token = (seg.length && seg[seg.length - 1] !== "journal-mcp" ? seg[seg.length - 1] : "") || url.searchParams.get("key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const acc = await account(token);
  if (!acc) return json({ error: "Kein gültiger Zugangsschlüssel. Erzeuge ihn in der App unter Einstellungen → KI-Anbindung." }, 401);
  if (req.method === "GET") return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);
  let body: Doc; try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Ungültiges JSON" } }, 400); }
  const sid = req.headers.get("mcp-session-id") || crypto.randomUUID();
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(m, acc)))).filter(Boolean);
    return out.length ? json(out, 200, { "Mcp-Session-Id": sid }) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await handle(body, acc);
  return res ? json(res, 200, { "Mcp-Session-Id": sid }) : new Response(null, { status: 202, headers: CORS });
});
