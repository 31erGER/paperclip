# Anleitung: Paperclip Local Harness (Branch `local-harness`)

Diese Anleitung beschreibt, was der Branch `local-harness` im Fork
`31erGER/paperclip` gegenüber dem Original ändert, wie du ihn auf einem
Linux-Rechner installierst und wie du ihn im Alltag benutzt.

Kurz gesagt: Paperclip läuft auf **einem Linux-Rechner ohne Container**,
ohne Docker, ohne Rust und ohne C-Compiler. Paperclip verwaltet als
„Meta-Harness“ mehrere Firmen, Projekte und Agents. **Ein Projekt ist ein
Ordner** auf dem Rechner, so wie in Claude Code. Die Agents laufen als
normale Prozesse direkt in diesem Ordner.

---

## 1. Was sich geändert hat

| Änderung | Wirkung |
| --- | --- |
| **Deployment-Profile** (`PAPERCLIP_DEPLOYMENT_PROFILE`) | `standard`, `local` oder `local_only`, siehe Abschnitt 4. |
| **Nur Host-Ausführung** | In `local` und `local_only` laufen alle Agents über ihren normalen Host-Adapter (`pi_local`, `claude_local`, `codex_local`, …). Paperclip Runner, Managed Sandbox, Dot, Grok Bot und Muse sind abgeschaltet. Beim Start wird nichts mit Rust gebaut. |
| **Projektordner** | Der Dialog „Add Project“ hat ein Feld **Project folder**. In den lokalen Profilen ist es Pflicht, und der Server prüft, ob der Ordner existiert. |
| **Agent-Run-Queue** | Einstellungen → General → **Agent run queue**: Höchstzahl gleichzeitiger Agent-Runs über alle Firmen. Weitere Runs warten und starten in Ankunftsreihenfolge. |
| **Keine Preis-Metriken** | Im Profil `local_only` fehlen Costs-Seiten, Ausgaben-Kacheln, Budget-Tabs und Dollarbeträge. Token und Laufzeiten bleiben sichtbar. |
| **Start-Skript** | `./paperclip-local.sh` mit `setup`, `start`, `dev`, `status`, `stop` und `check`, dazu eine systemd-Unit. |
| **Update-Skript** | `scripts/local/update-from-upstream.sh` holt Änderungen vom Original, siehe [ANLEITUNG-UPSTREAM-MERGE.md](ANLEITUNG-UPSTREAM-MERGE.md). |
| **Agent-Leitfaden** | `AGENTS.fork.md`: kurze Karte der Fork-Module für Coding-Agents wie Pi. |
| **Lokales Onboarding** | In den lokalen Profilen bietet das Onboarding für den ersten Agent zusätzlich Pi und Hermes mit LM Studio oder llama.cpp an. |
| **Aus OneDrive übernommen** | Datenschutz-Härtung (Telemetrie und externe Diagnose aus) und die lokale Verbindungsart für Pi und Hermes. |

Die Dateien im Überblick:

```
packages/shared/src/deployment-profile.ts            Profile + Queue-Rechenregeln
server/src/lib/deployment-profile.ts                 Profil lesen, Feature-Flags überschreiben
server/src/lib/local-project-folder.ts               Ordnerprüfung
server/src/services/heartbeat/instance-run-slots.ts  instanzweite Queue (Prüfung in der Claim-Transaktion)
server/src/services/heartbeat/run-slot-admission.ts  Einhang: ruft die instanzweite Prüfung auf
ui/src/hooks/useDeploymentProfile.ts                 Profil in der Oberfläche
ui/src/components/AgentRunQueueSetting.tsx           Queue-Einstellung
ui/src/components/CostMetricsGate.tsx                sperrt Kostenseiten
paperclip-local.sh                                   Start-/Stop-/Reset-Skript (Hauptordner)
scripts/local/                                       Update-Skript, systemd-Unit, Einstellungsvorlage
doc/local/                                           diese Anleitungen
AGENTS.fork.md                                      Leitfaden für Coding-Agents
```

In großen Original-Dateien gibt es nur kurze Einhänge. Sie sind mit dem
Kommentar `fork 31erGER` markiert.

---

## 2. Voraussetzungen

- Linux x64 oder arm64 (Ubuntu, Debian, Fedora …; WSL2 geht auch)
- `git` und `curl`
- Node.js 24 und pnpm 9. Das Setup-Skript prüft beides und aktiviert pnpm
  selbst. Docker, Rust und gcc sind **nicht** nötig.

Node.js 24 ohne Root-Rechte über nvm installieren:

```sh
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 24
nvm alias default 24
```

---

## 3. Installation

```sh
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/31erGER/paperclip.git paperclip-local
cd paperclip-local
git switch local-harness
./paperclip-local.sh setup
./paperclip-local.sh start
```

`setup` installiert die Abhängigkeiten und legt die Einstellungsdatei
`~/.config/paperclip-local/env` an. Danach öffnest du **http://127.0.0.1:3100**.

Beim ersten Start legt Paperclip seine Datenbank in `~/.paperclip` an. Das
dauert etwa eine Minute. Ob der Server bereit ist:

```sh
./paperclip-local.sh status
# status=ok profile=local_only version=…
```

### Als Dienst (startet mit dem Rechner)

```sh
mkdir -p ~/.config/systemd/user
cp scripts/local/paperclip-local.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now paperclip-local
loginctl enable-linger "$USER"        # läuft weiter, wenn du dich abmeldest
journalctl --user -u paperclip-local -f   # Logs
```

Liegt der Klon nicht unter `~/dev/paperclip-local`, passe die Pfade in der
Unit-Datei an.

---

## 4. Einstellungen und Profile

Datei: `~/.config/paperclip-local/env` (Vorlage: `scripts/local/env.example`)

```sh
PAPERCLIP_DEPLOYMENT_PROFILE=local_only
HOST=127.0.0.1
PORT=3100
```

| Profil | Wann |
| --- | --- |
| `local_only` (Standard) | Nur lokale Modelle (llama.cpp, LM Studio). Keine Preise, ein Run zur Zeit. |
| `local` | Host-Ausführung, aber auch Cloud-Modelle wie Claude oder Codex. Kosten bleiben sichtbar, die Queue ist unbegrenzt, solange du keine Grenze einstellst. |
| `standard` | Verhalten wie im Original. Unter Linux x64 braucht es dann Rust für den Paperclip Runner. |

### Zugriff von einem anderen Rechner

Ohne Anmeldung (Modus `local_trusted`, Standard) bekommen nur **Prozesse auf
dem Paperclip-Rechner selbst** Board-Rechte. Das Original prüft bei jeder
Verbindung, welcher lokale Prozess sie geöffnet hat, damit sich Agents nicht
als Board ausgeben können. Ein Browser auf einem anderen Rechner sieht daher
„Board access required“, auch mit `HOST=0.0.0.0`.

Empfohlen: ein SSH-Tunnel vom Arbeitsrechner aus.

```sh
ssh -L 3100:127.0.0.1:3100 du@linux-rechner
# danach im Browser des Arbeitsrechners: http://127.0.0.1:3100
```

Die Verbindung kommt dann vom SSH-Prozess auf dem Linux-Rechner. Das ist
noch nicht getestet. Die Alternative ist der Modus mit Anmeldung
(`authenticated`, siehe `doc/DEPLOYMENT-MODES.md`).

Nach jeder Änderung an der Datei neu starten (`systemctl --user restart
paperclip-local` oder `start` erneut ausführen).

---

## 5. Im Alltag

### Firma und Projekt anlegen

1. Firma über das Onboarding oder den Firmenumschalter anlegen.
2. **Projects → Add Project**: Namen eingeben, bei **Project folder** den
   absoluten Pfad, z. B. `/home/du/projekte/shop`.
   Der Ordner muss existieren (`mkdir -p /home/du/projekte/shop`) und muss
   kein Git-Repository sein.
3. Aufgaben im Projekt anlegen und einem Agent zuweisen. Der Agent arbeitet
   direkt in diesem Ordner, ohne Kopie und ohne Worktree.

Den Ordner eines bestehenden Projekts änderst du unter Projekt →
Configuration → Codebase → „Change local folder“.

### Agent-Run-Queue

Settings (Adresse `/company/settings`) → General → Abschnitt
**Agent run queue**:

- **1 at a time**: richtig, wenn alle Agents denselben llama.cpp- oder
  LM-Studio-Server nutzen. Parallele Anfragen an einen lokalen Server
  liefern sonst oft unbrauchbare Antworten.
- **2 / 4 / 8**: wenn dein Server mehrere Slots sauber bedient.
- **Profile default / Unlimited**: Profilvorgabe (`local_only`: 1) oder
  keine Grenze.

Die Grenze gilt für alle Firmen zusammen. Ist ein Run fertig, startet sofort
der älteste wartende Run, egal von welchem Agent.

### Lokale Modelle mit Pi

1. Einen OpenAI-kompatiblen Server starten:
   - LM Studio: Modell laden, `lms server start` (Adresse
     `http://localhost:1234/v1`)
   - llama.cpp: `llama-server -m modell.gguf --port 8080 -c 32768`
     (Adresse `http://localhost:8080/v1`)

   Das Modell sollte Tool-Calling zuverlässig beherrschen und mindestens
   32k Kontext haben. Paperclip schickt lange Anweisungen.
2. Pi installieren: `npm install -g @earendil-works/pi-coding-agent@0.74.0`
3. **Erster Agent im Onboarding:** In den Profilen `local` und
   `local_only` bietet der Schritt „Connect a model“ zusätzlich **Pi** und
   **Hermes** an (unter `local_only` an erster Stelle). Pi wählen, dann
   **Connect LM Studio**: Die Adresse ist mit `http://localhost:1234/v1`
   vorbelegt, ein API-Schlüssel ist nicht nötig. Für llama.cpp die Adresse
   anpassen (z. B. `http://localhost:8080/v1`). Paperclip fragt den Server
   nach seinen Modellen und zeigt sie als Liste („Models on the server“). Bei
   LM Studio sind Embedding-Modelle ausgeblendet und geladene Modelle markiert
   und vorausgewählt. Modelle anhaken statt IDs tippen, **Save connection**,
   Modell wählen, **Connect**. Der Agent läuft in der lokalen Umgebung, ohne
   Cloud-Konto.
4. **Weitere Agents:** Agents → **Add agent** → **Pi**, Modellquelle
   **Local** wählen und dieselbe lokale Verbindung verwenden.

Im Profil `standard` zeigt das Onboarding wie im Original nur Claude und
Codex.

### Agents stellen Agents ein

Hat ein Agent die Berechtigung „Can create agents“, kann er selbst weitere
Agents einstellen. Nutzt er eine **lokale** Verbindung (LM Studio,
llama.cpp), erbt der neue Agent automatisch:

- dieselbe Modellverbindung (sie wird für ihn freigeschaltet),
- das Modell des einstellenden Agents, falls der Hire keines nennt,
- die lokale Ausführungsumgebung.

Der neue Agent kann also ohne Handarbeit loslegen. Nennt der Hire selbst eine
Verbindung oder ein Modell, gilt diese Angabe. Cloud- und Gateway-Verbindungen
werden nie automatisch vererbt. Den Arbeitsordner bestimmt weiterhin das
Projekt der Aufgabe, nicht der Agent.

### Pi-Konfiguration und Extensions unter Paperclip

Paperclip startet dasselbe `pi`-Programm wie du im Terminal (Befehl `pi` aus
dem `PATH`), aber mit **eigener Konfiguration**: Bei einer in Paperclip
verwalteten Verbindung setzt es `PI_CODING_AGENT_DIR` (und `HOME`) auf einen
eigenen Ordner, in dem nur die Modell-Liste (`models.json`) liegt. Deine
persönlichen Einstellungen und globalen Extensions unter `~/.pi/agent/`
werden dort nicht geladen. Zusätzlich lädt Paperclip seine eigenen Skills
und eine eigene kleine Extension.

Extensions, die im Projektordner unter `.pi/extensions/` liegen, sollte Pi
weiterhin laden, weil es dort im Arbeitsordner sucht. Das ist nicht getestet.

### Paperclip selbst mit Pi im Terminal ändern

```sh
cd ~/dev/paperclip-local
./paperclip-local.sh dev    # Terminal 1: Server mit Live-Neuladen
pi                                      # Terminal 2: Pi im Repository
```

Pi liest `AGENTS.md`. Ganz oben verweist sie auf `AGENTS.fork.md` mit den
zuständigen Dateien, Regeln und schnellen Prüfungen. Nach einer Änderung:

```sh
pnpm local:check        # Fork-Tests + Typprüfung, ca. 20 Sekunden
git add -A && git commit -m "…"
git push origin local-harness
```

`pnpm build` und `pnpm test:run` brauchst du für kleine Änderungen nicht.
Der volle Build verlangt Rust und gcc für Pakete, die der lokale Betrieb
nicht nutzt.

---

## 6. Befehle im Überblick

| Befehl | Zweck |
| --- | --- |
| `./paperclip-local.sh setup` | Node/pnpm prüfen, Abhängigkeiten installieren |
| `./paperclip-local.sh start` | Server starten (Vordergrund) |
| `./paperclip-local.sh dev` | Server mit Live-Neuladen für Entwicklung |
| `./paperclip-local.sh status` | Zustand und aktives Profil |
| `./paperclip-local.sh stop` | Server herunterfahren, inkl. eingebetteter Datenbank |
| `./paperclip-local.sh reset` | Werkszustand (siehe Abschnitt 6a) |
| `./paperclip-local.sh update` | wie `scripts/local/update-from-upstream.sh` (`check` oder `merge`) |
| `./paperclip-local.sh check` | Fork-Tests (wie `pnpm local:check`) |
| `scripts/local/update-from-upstream.sh check` | Neues vom Original anzeigen |
| `scripts/local/update-from-upstream.sh merge` | Original einmergen |

---

## 6a. Daten und Werkszustand (Factory Reset)

Paperclip speichert alles, was zur Laufzeit entsteht, **nicht im Repo**,
sondern in `~/.paperclip/instances/default`: die Datenbank mit Firmen,
Agents, Aufgaben, Verbindungen und Secrets, dazu Logs, Backups und die
Home-Ordner der Agents. Jeder Klon auf demselben Benutzerkonto benutzt diese
Daten. Ein neuer Klon startet deshalb **nicht** leer.

Frischer Stand:

```sh
./paperclip-local.sh stop
./paperclip-local.sh reset          # fragt nach; Daten wandern nach ~/.paperclip/reset-backups/
./paperclip-local.sh start
```

- `reset --yes` fragt nicht nach, `reset --delete` löscht endgültig statt zu
  sichern.
- Erhalten bleiben: das Repo, `~/.config/paperclip-local/env` und **deine
  Projektordner** (die liegen außerhalb von `~/.paperclip`).
- Rückgängig machen (Paperclip gestoppt): den von `reset` angezeigten
  `mv`-Befehl ausführen.
- Läuft nach einem Absturz noch die eingebettete Datenbank, fahren `stop`
  und `reset` sie sauber herunter.
- In `~/.paperclip/instances/default/.env` liegen die Instanz-Geheimnisse
  (u. a. `PAPERCLIP_AGENT_JWT_SECRET` für die Agent-Tokens). `start` legt
  sie an, falls sie fehlen; nach einem `reset` entstehen neue.

Tipp für Experimente: Mit `PAPERCLIP_INSTANCE_ID=test` in der
Einstellungsdatei nutzt Paperclip eine zweite, getrennte Instanz unter
`~/.paperclip/instances/test`.

## 7. Fehlerbehebung

| Problem | Lösung |
| --- | --- |
| Agent meldet „keine Berechtigung“ / „Unauthorized“ beim Einstellen (Hire) oder bei anderen API-Aufrufen, obwohl der Schalter an ist | Dem Agent fehlt das Bearer-Token (`PAPERCLIP_API_KEY`). Der Server kann es nur ausstellen, wenn die Instanz `PAPERCLIP_AGENT_JWT_SECRET` hat. `./paperclip-local.sh start` legt es automatisch in `~/.paperclip/instances/default/.env` an. Also: aktualisieren (`git pull`), `stop`, `start`. Im Startbanner muss „Agent JWT  set“ stehen (vorher: „missing“). |
| Agent darf trotz Token nicht einstellen: „Missing permission: agents:create“ | Auf der Berechtigungsseite des Agents „Can create agents“ einschalten. |
| Neu eingestellter Agent steht auf „paused“ mit „The execution command was not found“ | Paperclip prüft jeden neuen Agent. Der Befehl des Adapters fehlt auf dem Rechner, z. B. `pi`. Installieren (`npm install -g @earendil-works/pi-coding-agent@0.74.0`), dann beim Agent „Retry now“. |
| Hire abgelehnt: „Agent keys cannot configure host-executed process adapters“ | Agents dürfen keine `process`-Agents (beliebige Befehle) anlegen. Der eingestellte Agent muss einen normalen Adapter nutzen, z. B. Pi. |
| Alte Testfirmen nach neuem Klon | Daten liegen in `~/.paperclip`, nicht im Repo: `./paperclip-local.sh stop`, dann `reset` (Abschnitt 6a). |
| `cargo: not found` beim Start | Das Profil ist `standard`. In `~/.config/paperclip-local/env` `PAPERCLIP_DEPLOYMENT_PROFILE=local_only` setzen. |
| „Project folder does not exist on this host“ | Ordner anlegen (`mkdir -p …`) und den absoluten Pfad verwenden. |
| Agent liefert Unsinn | Queue auf „1 at a time“ stellen; Modell mit Tool-Calling und genug Kontext verwenden. |
| Modellliste: „Could not reach a model server“ | Modellserver starten (`lms server start` bzw. `llama-server`), dann „Reload models“. |
| Modellliste: „answered HTTP 404“ | Die Adresse endet meist auf `/v1`, z. B. `http://localhost:1234/v1`. |
| `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | `pnpm install --no-frozen-lockfile` (das Setup-Skript macht das automatisch). |
| Oberfläche nicht erreichbar | `./paperclip-local.sh status`. Von einem anderen Rechner per SSH-Tunnel zugreifen (Abschnitt 4). |
| „Board access required“ im Browser | Der Browser läuft nicht auf dem Paperclip-Rechner (oder unter WSL im Windows-Browser). SSH-Tunnel oder Modus mit Anmeldung verwenden (Abschnitt 4). |
| Pi-Agent: „model not found“ | Modell-ID in der Verbindung muss exakt der ID im Modellserver entsprechen. |

## 8. Bekannte Grenzen

- In der Agent-Konfiguration steht „Paperclip Runner“ noch als ausgegraute
  Option. In lokalen Profilen lehnt der Server ihn ab.
- Der Befehl `background` ist unter WSL unzuverlässig. Dort `start` in
  einem Terminal oder systemd verwenden.
- Ein vollständiger Lauf mit Pi gegen ein lokales Modell ist noch nicht
  automatisiert getestet.
- Unter WSL bekommt ein Windows-Browser keine Board-Rechte (siehe
  Abschnitt 4). Auf einem echten Linux-Rechner mit Browser auf demselben
  Rechner betrifft das nicht.
