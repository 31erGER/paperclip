# Anleitung: Änderungen vom Original in `local-harness` übernehmen

Diese Anleitung zeigt, wie du neue Änderungen aus dem Original-Repository
`paperclipai/paperclip` in deinen Branch `local-harness` übernimmst und das
Ergebnis in deinen Fork `31erGER/paperclip` pushst.

## Das Prinzip

```
paperclipai/paperclip (Original)  ──fetch──►  dein Klon  ──push──►  31erGER/paperclip (Fork)
        remote "upstream"                 Branch local-harness           remote "origin"
```

- Du brauchst **einen Klon**, keinen zweiten daneben.
- Der Klon kennt zwei Quellen: `origin` (dein Fork) und `upstream` (das
  Original).
- Git führt die Änderungen des Originals zusammen (**Merge**). Niemand muss
  sie nachprogrammieren. Handarbeit ist nur bei **Konflikten** nötig: wenn
  das Original dieselben Zeilen geändert hat wie dein Fork.
- Gearbeitet wird nur auf `local-harness`. Der `master` deines Forks wird
  nicht gebraucht.

---

## 1. Einmalige Einrichtung (pro Rechner)

```sh
cd ~/dev/paperclip-local
git switch local-harness
git remote add upstream https://github.com/paperclipai/paperclip.git   # das Skript macht das sonst selbst
git config user.name  "Dein Name"
git config user.email "deine@adresse"
```

Damit `git push` funktioniert, brauchst du eine Anmeldung bei GitHub, z. B.:

- **GitHub CLI:** `gh auth login` (danach `gh auth setup-git`)
- **SSH-Schlüssel:** `git remote set-url origin git@github.com:31erGER/paperclip.git`
- **Unter WSL:** den Windows Credential Manager nutzen:
  `git config credential.helper "/mnt/c/Program Files/Git/mingw64/bin/git-credential-manager.exe"`
  (Pfad an deine Git-Installation anpassen)

Prüfen:

```sh
git remote -v
# origin    https://github.com/31erGER/paperclip.git
# upstream  https://github.com/paperclipai/paperclip.git
```

---

## 2. Regelmäßiges Update mit dem Skript (empfohlen)

### Schritt 1: Nachsehen, was neu ist

```sh
scripts/local/update-from-upstream.sh check
```

Das Skript holt das Original und zeigt die Zahl der neuen Commits und die
Dateien, die voraussichtlich kollidieren. **Es ändert nichts.**

### Schritt 2: Arbeitsstand sichern

Eigene Änderungen müssen committet sein:

```sh
git status
git add -A && git commit -m "Eigene Änderungen vor Upstream-Merge"   # falls nötig
```

### Schritt 3: Mergen

```sh
scripts/local/update-from-upstream.sh merge
```

Das Skript:

1. legt einen Sicherungs-Branch `backup/local-harness-<Datum-Uhrzeit>` an,
2. führt `upstream/master` in `local-harness` zusammen,
3. installiert die Abhängigkeiten (`pnpm install`),
4. lässt die Fork-Tests laufen (`pnpm local:check`).

Ohne Konflikte geht es weiter mit Schritt 5. Bei Konflikten hält das Skript
an und listet die Dateien auf: weiter mit Abschnitt 3.

### Schritt 4: Prüfen

```sh
pnpm local:check
(cd server && npx tsc --noEmit -p .)
(cd ui && npx tsc --noEmit -p .)    # Fehler unter storybook/ sind bekannt und harmlos
./paperclip-local.sh start
./paperclip-local.sh status    # status=ok profile=local_only
```

Kurz in der Oberfläche prüfen:

- Im Dialog „Add Project“ gibt es das Feld „Project folder“.
- Settings → General zeigt „Agent run queue“.
- Im Profil `local_only` gibt es keinen Costs-Eintrag.

### Schritt 5: Pushen

```sh
git push origin local-harness
```

Kein `--force` nötig: Ein Merge hängt nur neue Commits an.

---

## 3. Konflikte lösen

Ein Konflikt sieht in der Datei so aus:

```
<<<<<<< HEAD
… dein Stand (local-harness) …
=======
… Stand des Originals …
>>>>>>> upstream/master
```

Offene Konfliktdateien anzeigen:

```sh
git diff --name-only --diff-filter=U
```

### Grundregel

**Das Original gewinnt, die Fork-Änderung wird wieder eingebaut.** Fork-Code
erkennst du am Kommentar `fork 31erGER`. Die zugehörigen Dateien stehen in
`AGENTS.fork.md`. Fast immer heißt das: neuen Original-Code übernehmen und
den kurzen Fork-Einhang (ein Import, eine `if`-Abfrage, ein Hook-Aufruf)
wieder einsetzen.

### Typische Fälle

| Datei | Vorgehen |
| --- | --- |
| `pnpm-lock.yaml` | Nicht von Hand lösen: `git checkout --theirs pnpm-lock.yaml`, dann `pnpm install --no-frozen-lockfile`, dann `git add pnpm-lock.yaml`. |
| Generierte Dateien, Maps (`maps/…`), Doku des Originals | Meist Original übernehmen: `git checkout --theirs <datei>`. |
| Dateien mit `fork 31erGER`-Einhängen (z. B. `heartbeat/queue.ts`, `instance-settings.ts`, `agent-runner-selection.ts`, `health.ts`, `projects.ts`) | Original-Version nehmen und den markierten Fork-Block wieder einsetzen. |
| Reine Fork-Dateien (`deployment-profile.ts`, `instance-run-slots.ts`, `scripts/local/…`, `doc/local/…`) | Kollidieren normalerweise nicht; sonst Fork-Version behalten: `git checkout --ours <datei>`. |
| Datenschutz-/Onboarding-Änderungen aus dem OneDrive-Import (`OnboardingWizard.tsx`, `instrumentation.ts`, `feedback.ts`, `MarkdownBody.tsx` …) | Original übernehmen und prüfen, ob die Datenschutz-Abschaltung noch greift. Hat das Original den Mechanismus umgebaut, die Änderung neu und möglichst klein einbauen. |

`--ours` bedeutet beim Merge „local-harness“, `--theirs` bedeutet „Original“.

Nach jeder gelösten Datei:

```sh
git add <datei>
```

Sind alle Dateien gelöst:

```sh
grep -rn "^<<<<<<< \|^>>>>>>> " $(git diff --cached --name-only) || echo "keine Marker mehr"
git commit --no-edit
pnpm install --no-frozen-lockfile
pnpm local:check
```

Danach weiter mit Abschnitt 2, Schritt 4 (Prüfen) und Schritt 5 (Pushen).

### Konflikte von einem Agent lösen lassen

Pi oder ein anderer Coding-Agent kann das übernehmen. Auftrag:

> Löse die Merge-Konflikte aus `git diff --name-only --diff-filter=U` nach
> `AGENTS.fork.md`: Original-Code übernehmen, Fork-Blöcke mit
> `fork 31erGER` wieder einsetzen, `pnpm-lock.yaml` mit `--theirs` und
> `pnpm install` lösen. Danach `pnpm local:check` ausführen und die
> geänderten Fork-Stellen zusammenfassen. Nicht committen.

Prüfe das Ergebnis mit `git diff --cached` und committe selbst.

### Abbrechen oder zurückrollen

| Situation | Befehl |
| --- | --- |
| Merge läuft noch, du willst abbrechen | `git merge --abort` |
| Merge ist committet, aber kaputt (noch nicht gepusht) | `git reset --hard backup/local-harness-<Datum-Uhrzeit>` |
| Schon gepusht | `git revert -m 1 <merge-commit>` und danach `git push origin local-harness` |

Sicherungs-Branches anzeigen: `git branch --list 'backup/*'`. Alte
Sicherungen löschen: `git branch -D backup/local-harness-…`.

---

## 4. Ohne Skript (dieselben Schritte von Hand)

```sh
git switch local-harness
git status                                   # muss sauber sein
git fetch upstream master
git log --oneline HEAD..upstream/master | wc -l          # Zahl neuer Commits
git merge-tree --write-tree --name-only HEAD upstream/master   # Konflikte vorhersagen
git branch backup/local-harness-$(date +%Y%m%d-%H%M)
git merge --no-ff upstream/master -m "Merge upstream master into local-harness"
# … Konflikte lösen (Abschnitt 3) …
pnpm install --no-frozen-lockfile
pnpm local:check
git push origin local-harness
```

---

## 5. Erfahrungen aus dem ersten Merge (2590 Commits, 26 Konfliktdateien)

- **Stark umgebaute Original-Dateien:** Hat das Original eine Datei grundlegend
  neu geschrieben (z. B. `heartbeat/queue.ts`, `OnboardingWizard.tsx`), nicht
  Block für Block flicken. Besser: Original-Version komplett übernehmen
  (`git show upstream/master:<datei> > <datei>`) und den Fork-Einhang neu und
  passend zur neuen Struktur einbauen.
- **Teilweise automatisch gemergte Dateien prüfen:** Git übernimmt
  konfliktfreie Fork-Stellen auch dann, wenn die Konfliktstellen „theirs“
  bekommen. Das kann halbe Fork-Änderungen hinterlassen (z. B. ein Import
  ohne Verwendung). Nach dem Lösen `git diff upstream/master -- <datei>`
  ansehen.
- **Verschobener Code:** Ist eine Funktion im Original umgezogen (z. B.
  `managedAiHomeEnvironment` nach `packages/adapter-utils`), die
  Fork-Änderung am neuen Ort einbauen: `git grep -n <name> upstream/master`.
- **Lockfile:** Das Original passt mit pnpm 9 nicht immer zu seiner eigenen
  Konfiguration. `git checkout --theirs pnpm-lock.yaml`, dann
  `pnpm install --no-frozen-lockfile` und die erzeugte Lockfile committen.
  Sonst ist der Arbeitsbaum nach jeder Installation verändert.
- **Migrationsprüfung:** Beim Start prüft Paperclip neue Datenbank-Migrationen
  gegen `upstream/master`. Während ein Merge noch nicht committet ist, meldet
  die Prüfung viele Original-Migrationen als unbekannt. Das verschwindet nach
  dem Merge-Commit. Die Quelle `upstream` muss eingerichtet und geholt sein
  (macht `setup` bzw. das Update-Skript).
- **Veraltete Build-Ausgaben:** Meldet die Server-Typprüfung fehlende Exporte
  aus `@paperclipai/plugin-sdk` oder dem Runner, zuerst neu bauen:
  `pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` und
  `pnpm --filter @paperclipai/paperclip-runner build:typescript`.
- **Neue Original-Oberflächen:** Das Original bringt eigene neue Seiten mit,
  z. B. die neue Agent-Übersicht mit Kostenkacheln. Nach dem Merge
  `grep -rn "formatCents\|Costs" ui/src` auf neue Kostenanzeigen prüfen und
  sie für `local_only` ausblenden.

## 6. Tipps

- **Oft mergen, z. B. wöchentlich.** Das Original bekommt tausende Commits
  pro Monat. Kleine Merges bringen kleine Konflikte.
- **Mergen, nicht rebasen.** Ein Rebase schreibt die Fork-Historie neu und
  verlangt `git push --force`.
- **Fork-Änderungen klein halten.** Neue Funktionen in eigene Module legen
  und in Original-Dateien nur kurze, mit `fork 31erGER` markierte Einhänge
  setzen. Das hält spätere Konflikte klein.
- **Nach dem Merge immer die drei Fork-Funktionen prüfen:** Projektordner,
  Agent-Run-Queue und ausgeblendete Kosten.
