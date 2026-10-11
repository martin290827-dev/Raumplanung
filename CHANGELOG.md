# Änderungsprotokoll

Alles bleibt vorerst in Version 1. Kleine Schritte: 1.0.x für Korrekturen, 1.1, 1.2 und so weiter für neue Funktionen.
Jeder Stand bekommt einen Git-Tag (`v1.0.0`, `v1.1.0` ...).

## 1.0.0
- Foto hochladen, Raumtyp und Kurzbeschreibung angeben
- KI-Redesign über Atlas Cloud (Nano Banana 2, Seedream 4.5, Grok Imagine), 10 Stilvorlagen, Vorher/Nachher-Regler
- Ideen von Claude: Analyse, 3 Konzepte, Farben, Materialien, Möbel mit Maßen und Suchbegriff
- Fotoformate: JPEG, PNG, WebP, GIF, AVIF, BMP direkt; HEIC, TIFF u. a. per lokaler Umwandlung (sips)
- Einstellungen in der App: API-Schlüssel, Claude-Modell und Tageslimit werden in `.env` gespeichert
- Tageslimit für Kosten, Schutz gegen fremde Webseiten, alle Daten nur lokal
