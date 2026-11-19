# Paperclip lokal (Branch `local-harness`)

Paperclip ohne Container auf einem Linux-Rechner. Alles läuft über ein Skript:

```sh
./paperclip-local.sh setup     # einmalig: Abhängigkeiten, Einstellungen
./paperclip-local.sh start     # starten → http://127.0.0.1:3100
./paperclip-local.sh stop      # herunterfahren (inkl. Datenbank)
./paperclip-local.sh status    # läuft es? welches Profil?
./paperclip-local.sh reset     # Werkszustand: alle Firmen, Agents, Aufgaben weg
./paperclip-local.sh update    # Neues vom Original anzeigen (update merge = übernehmen)
```

- **Voraussetzung:** Node.js 24 (`nvm install 24`), git, curl.
- **Einstellungen:** `~/.config/paperclip-local/env`, Standardprofil
  `local_only` (nur lokale Modelle, keine Preise, ein Run zur Zeit).
- **Daten** liegen in `~/.paperclip`, nicht im Repo. Ein neuer Klon sieht
  deshalb dieselben Firmen. Frischer Stand: `stop`, dann `reset`. Die alten
  Daten wandern nach `~/.paperclip/reset-backups/`; mit `reset --delete`
  werden sie endgültig gelöscht.
- **LM Studio / llama.cpp:** Beim Verbinden listet Paperclip die Modelle des
  Servers auf; anhaken statt Modell-IDs tippen.
- **Anderer Rechner:** per SSH-Tunnel `ssh -L 3100:127.0.0.1:3100 du@host`.

Ausführlich: [doc/local/ANLEITUNG-LOCAL-HARNESS.md](doc/local/ANLEITUNG-LOCAL-HARNESS.md) ·
Updates vom Original: [doc/local/ANLEITUNG-UPSTREAM-MERGE.md](doc/local/ANLEITUNG-UPSTREAM-MERGE.md)
