# Prime Journal

Dein eigenes Tradingjournal für GBP/JPY: Dashboard, Kalender, Tagebuch mit Wochenrückblick, Trades mit Playbook-Regeln und Screenshots, Reports nach Session und News, Wirtschaftskalender für GBP und JPY, Import von Interactive Brokers.

Die App läuft kostenlos auf **GitHub Pages**, deine Daten liegen in einer kostenlosen **Supabase**-Datenbank. Du meldest dich mit E-Mail und Passwort an und hast auf Mac, iPad und iPhone dieselben Daten.

Dauer der Einrichtung: etwa 20 Minuten, nur einmal. Die KI-Anbindung (Teil 6) ist optional und dauert noch einmal 10 Minuten.

## Aufbau

| Ebene | Was | Wo |
|---|---|---|
| 1. Journal | Trades, SL/TP/CRV, Risiko, P&L, Screenshots, Notizen, Tagebuch, Playbooks, Strategie | App (`index.html`) auf GitHub Pages, Daten in Supabase |
| 2. KI-Anbindung | MCP-Server, über den Claude, ChatGPT oder andere KIs dein Journal lesen | Supabase Edge Function `journal-mcp` (`mcp/journal-mcp.ts`) |
| 3. Analyse & Coaching | Wochen- und Monatsberichte, Regelverstöße, Fehler, CRV und Muster; Ergebnisse als KI-Notizen und Berichte zurück ins Journal | Die KI über die MCP-Tools; Anzeige in der App unter „KI-Berichte“ |

Das Journal funktioniert vollständig ohne KI-Abo. Die KI-Anbindung ist ein Zusatz und nicht an einen Anbieter gebunden.

---

## 1. Datenbank anlegen (Supabase)

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto erstellen (z. B. mit deinem GitHub-Konto).
2. **New project** anlegen. Name z. B. `prime-journal`, ein Datenbank-Passwort vergeben (gut aufheben, wird für die App aber nicht gebraucht), Region **Frankfurt (eu-central-1)**.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).
4. Links **SQL Editor** → **New query**. Den kompletten Inhalt der Datei `supabase-setup.sql` einfügen und auf **Run** klicken. Es sollte „Success“ erscheinen.
5. Links **Authentication** → **Sign In / Providers** → **Email**: Schalte **Confirm email** aus und speichere. Dann kannst du dich direkt nach dem Registrieren anmelden. (Lässt du es an, kommt eine Bestätigungs-E-Mail, die du einmal anklicken musst.)
6. Links **Project Settings** → **API Keys** (bzw. **Data API**). Notiere:
   - **Project URL**, z. B. `https://abcdefgh.supabase.co`
   - den **Publishable key** (beginnt mit `sb_publishable_`). Den „secret“ Key niemals eintragen.

Der anon Key ist kein Geheimnis. Er darf in öffentlichem Code stehen. Deine Daten sind über den Login und die Regeln aus Schritt 4 geschützt: Nur dein Konto kann deine Trades lesen oder ändern.

## 2. Zugangsdaten eintragen

Öffne `config.js` mit einem Texteditor (am Mac: TextEdit, vorher unter *Format* → *In reinen Text umwandeln*) und trage beide Werte zwischen die Anführungszeichen ein:

```js
window.PJ_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseKey: "eyJhbGciOi..."
};
```

## 3. Online stellen (GitHub Pages)

1. Auf [github.com](https://github.com) ein kostenloses Konto erstellen.
2. Oben rechts **+** → **New repository**. Name z. B. `prime-journal`, Sichtbarkeit **Public**, auf **Create repository** klicken.
3. Auf der leeren Seite **uploading an existing file** wählen und diese Dateien hineinziehen:
   - `index.html`
   - `config.js` (mit deinen Werten)
   - `README.md`
   - `supabase-setup.sql`
   - den Ordner `mcp` (optional, enthält keine Geheimnisse)

   Dann **Commit changes**.

   **Nicht hochladen:** die Datei `prime-playbooks.json`. Sie enthält die Inhalte deiner Prime-Trading-Checklisten, und das Repository ist öffentlich.
4. Im Repository **Settings** → **Pages**. Unter *Build and deployment* bei *Source* **Deploy from a branch** wählen, Branch **main** und Ordner **/ (root)**, dann **Save**.
5. Nach 1–2 Minuten ist die App erreichbar unter
   `https://DEIN-GITHUB-NAME.github.io/prime-journal/`

## 4. Erster Start

1. Die Adresse öffnen, auf **Konto erstellen** klicken, E-Mail und Passwort festlegen.
2. **Einstellungen** → **Sicherung einspielen** → `prime-playbooks.json` auswählen. Damit sind TrendFlow und RangeFlow mit allen Regeln und Merkmalen angelegt.
3. In den Einstellungen deine Limits setzen (max. Trades und max. Verlust pro Tag) und die Session-Zeiten prüfen.
4. **Import** → deine IBKR-Datei hineinziehen (Anleitung steht direkt daneben).

## 5. Auf iPhone und iPad

Die Adresse in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**. Das Journal startet dann wie eine App. Mit denselben Zugangsdaten anmelden.

## 6. KI-Anbindung (optional, für Claude und ChatGPT)

**a) MCP-Server in Supabase anlegen**

1. Im Supabase-Projekt links **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Als Namen genau `journal-mcp` eintragen.
3. Den Beispielcode im Editor vollständig löschen und den Inhalt von `mcp/journal-mcp.ts` einfügen. Auf **Deploy function** klicken.
4. In der Funktion unter **Details** bzw. **Settings** die Option **Verify JWT** / **Enforce JWT verification** ausschalten und speichern. Der Server prüft stattdessen deinen eigenen Zugangsschlüssel.

**b) Zugangsschlüssel erzeugen**

In der App: **Einstellungen** → **KI-Anbindung** → **Zugangsschlüssel erzeugen**. Kopiere die angezeigte Connector-Adresse. Behandle sie wie ein Passwort: Wer sie kennt, kann dein Journal lesen. Mit „Neuen Schlüssel erzeugen“ machst du die alte Adresse sofort ungültig.

Wenn die KI Notizen und Berichte im Journal speichern soll, setze dort den Haken. Trades, Kennzahlen und Einstellungen kann die KI nie ändern.

**c) In Claude verbinden**

claude.ai → **Customize** → **Connectors** → **Add custom connector**. Name `Prime Journal`, URL einfügen, Anmeldung **No sign-in** wählen. Im Free-Plan ist ein eigener Connector möglich.

**d) In ChatGPT verbinden**

ChatGPT → **Einstellungen** → **Apps & Connectors** → **Advanced settings** → **Developer mode** einschalten → **Create**. URL einfügen, Authentifizierung **No authentication**. Dafür braucht ChatGPT ein bezahltes Abo; welche Pläne es genau unterstützen, ändert OpenAI gelegentlich.

**e) Ausprobieren**

- „Analysiere meine letzten 20 GBP/JPY-Trades.“
- „Welche Fehler kosten mich am meisten Geld?“
- „Wie erfolgreich bin ich bei Trades mit einem CRV über 2?“
- „Vergleiche meine London-Trades mit meinen NY-Trades.“
- „Wo weiche ich am häufigsten von meiner Checkliste ab?“
- „Erstelle meinen Wochenbericht und speichere ihn im Journal.“

In Claude gibt es dafür auch fertige Vorlagen (Prompts): *wochenbericht*, *monatsbericht*, *trade_review* und *fehleranalyse*.

**Was die KI abrufen kann**

| Tool | Inhalt |
|---|---|
| `get_context` | Strategie-Text, Playbooks mit Regeln und Merkmalen, Limits, Sessions, Datenumfang |
| `get_stats` | Kennzahlen mit Filtern und Gruppierung (Session, Wochentag, Uhrzeit, CRV, Playbook, Merkmal, Fehler, News, Regeltreue …) |
| `list_trades` / `get_trade` | Trades mit allen Feldern; einzelne Trades mit Notizen, verletzten Regeln, Ausführungen und Screenshots |
| `get_journal` | Tagesplan, Rückblick, Stimmung, Wochenrückblicke, Limit-Verstöße |
| `get_rule_check` | Regeltreue pro Regel, Ergebnis mit und ohne, Fehler nach Kosten |
| `get_news` | Gespeicherte GBP- und JPY-Termine |
| `search` / `fetch` | Volltextsuche (auch für die ChatGPT-Suche) |
| `add_note` / `save_report` | Nur wenn erlaubt: KI-Notiz an Trade, Tag oder Woche; Bericht unter „KI-Berichte“ |

---

## Gut zu wissen

- **Supabase pausiert inaktive Gratis-Projekte** nach etwa einer Woche ohne Nutzung. Deine Daten bleiben erhalten. Du reaktivierst das Projekt im Supabase-Dashboard mit einem Klick auf „Restore“. Wer das Journal regelmäßig öffnet, merkt davon nichts.
- **Sicherung:** Unter Einstellungen → *Sicherung (JSON)* einmal im Monat eine Kopie herunterladen.
- **News:** Die Termine der laufenden Woche kommen von ForexFactory und werden beim Öffnen gespeichert. Die Auswertungen „News-Tag“ und „News-Fenster“ füllen sich deshalb ab dem Tag, ab dem du die App nutzt. Für kommende Wochen gibt es zusätzlich den TradingView-Kalender.
- **Zeiten:** Alle Zeiten werden in der Ortszeit deines Geräts angezeigt. Exportiert IBKR in New-York-Zeit, stellst du unter Einstellungen die *Zeitverschiebung Import* ein (für deutsche Zeit meist +6).
- **Ohne Supabase:** Bleibt `config.js` leer, läuft das Journal lokal im Browser. Das ist gut zum Ausprobieren, aber dann gibt es keine Synchronisation zwischen Geräten.
- **Tradezella:** Exportiere in Tradezella deine Trades als CSV und ziehe die Datei in den Import. Die App erkennt das Format selbst. Notizen, die nicht im CSV stehen, kann eine KI über die offizielle Tradezella-Verbindung auslesen und als Sicherung aufbereiten.
- **Updates:** Eine neue Version installierst du, indem du nur `index.html` im Repository ersetzt (*Add file* → *Upload files*). `config.js` bleibt, wie sie ist.
