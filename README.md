# Raumplanung

Lokale App für den Eigengebrauch. Foto eines Raums oder Platzes hochladen, kurz beschreiben, dann:

- **KI-Redesign** des Fotos in 10 Stilvorlagen (Atlas Cloud), mit Vorher/Nachher-Regler
- **Ideen für Raum und Möbel** von Claude: Analyse, 3 Konzepte, Farben, Materialien, Möbel mit Maßen, Platzierung und Suchbegriff

## Start

1. Node.js 20 oder neuer installieren (`node -v` prüfen).
2. `.env.example` nach `.env` kopieren und beide API-Schlüssel eintragen.
3. Doppelklick auf `start.command` oder im Terminal `node server.js`. Dann `http://localhost:3000` öffnen.

## Fotoformate

JPEG, PNG, WebP, GIF, AVIF und BMP liest der Browser selbst. HEIC (iPhone), TIFF und andere Formate wandelt der lokale Server mit `sips` um, das in macOS eingebaut ist. Alles bleibt auf dem Rechner.

## Datenschutz

- Der Server lauscht nur auf `127.0.0.1`.
- Fotos, Redesigns und Ideen liegen im Ordner `data/` (nicht im Repo, siehe `.gitignore`).
- Schlüssel stehen nur in `.env` (nicht im Repo).
- Zur Bearbeitung gehen Foto und Beschreibung an Anthropic (Ideen) und Atlas Cloud (Redesign).

## Kosten

Ein Tageslimit schützt vor Überraschungen (`DAILY_LIMIT_USD`, Standard 2). Es rechnet mit Listenpreisen aus `models.json` und einer Schätzung für Claude. Die echte Abrechnung steht bei Anthropic und Atlas Cloud.

## Anpassen

- Stile: `styles.json` (Name, drei Farben, englischer Prompt)
- Bildmodelle: `models.json` (Modell-ID aus der Atlas-Cloud-Dokumentation, Preis, Feldname des Eingabebilds)
