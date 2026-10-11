# Änderungsprotokoll

Alles bleibt vorerst in Version 1. Kleine Schritte: 1.0.x für Korrekturen, 1.1, 1.2 und so weiter für neue Funktionen.
Jeder Stand bekommt einen Git-Tag (`v1.0.0`, `v1.1.0` ...).

## 1.5.0
- Beim Anlegen entsteht nach den Ideen gleich das erste Redesign (Button "Ideen und Redesign erzeugen")
- Das Redesign richtet sich nach dem Budget: Mit Budget wird das Konzept genommen, das es am besten ausnutzt, ohne es zu überschreiten. Ohne Budget gilt das mittlere Konzept mit mittlerem Preisniveau, nicht billig und nicht Luxus
- Ohne Budget staffelt Claude die Konzepte jetzt: sparsam, ausgewogen (mittlere Preisklasse), hochwertig
- Das gewählte Konzept ist mit "Empfohlen" markiert und beim Öffnen des Projekts schon für weitere Redesigns vorausgewählt
- Die Bildanweisung nennt das Preisniveau (Budget oder "mittlere Qualität")

## 1.4.0
- Budget: Wenn ein Budget angegeben ist, plant Claude die Konzepte um dieses Budget (Summe der Möbel höchstens so hoch wie das Budget, drei Stufen von sparsam bis voll genutzt). Ohne Budget bleibt alles wie bisher
- Möbelpreise sind jetzt Preisrahmen (von bis). Pro Konzept zeigt die App die Summe und ob sie im Budget liegt
- Neues Design im Apple-Stil: SF-Schrift, runde weiße Karten, Pill-Buttons, durchscheinende Seitenleiste, segmentierte Auswahl, Schalter, Dunkelmodus
- Kostenanzeige mit Balken in der Seitenleiste

## 1.3.0
- Projektname ist änderbar (Button "Umbenennen" oder unter "Deine Angaben")
- Neues Projekt fragt vorab: Beschreibung, was dich stört, Wünsche, Budget und Stil (optional). "Ideen von Claude holen" legt das Projekt an und liefert sofort die Ideen
- Alle Angaben stehen im Kasten "Deine Angaben", sind jederzeit änderbar und fließen in Ideen, Bildanweisung und Redesign ein
- Hinweis mit Button, wenn die Angaben nach den letzten Ideen geändert wurden
- Stil ist bei den Ideen jetzt optional (vorher war immer "Skandinavisch" voreingestellt); Redesign startet mit dem Stil des Projekts
- Das Feld im Redesign heißt jetzt "Zusätzlich für dieses Bild" und gilt nur für diese Bildrunde

## 1.2.0
- Projekte löschen: Kreuz in der Projektliste und Button im Projekt, mit eigener Rückfrage in der App (keine Browser-Dialoge mehr)
- Einzelne Redesign-Bilder löschen
- Ideen von Claude stehen jetzt vor dem Redesign und sind kompakt: Kurzfassung, Konzepte zum Auf- und Zuklappen, Möbel in zwei Zeilen
- Button "Dieses Konzept fürs Redesign wählen" übernimmt Konzept und Möbel ins Redesign
- Deine Beschreibung bleibt oben im Projekt sichtbar und lässt sich bearbeiten (inkl. Raumtyp); die App sagt, was in die Ideen einfließt
- Claude antwortet kürzer (weniger Text, höchstens 5 Möbel pro Konzept)

## 1.1.0
- Redesign mit eigenen Wünschen: Textfeld für Wünsche, die ins Bild einfließen
- Möbel aus einem Claude-Konzept einzeln auswählen und im Bild einbauen lassen
- Claude schreibt auf Wunsch die Bildanweisung (aus Foto, Wünschen und Möbeln); sie ist vor dem Erzeugen bearbeitbar
- Schalter "Vorhandene Möbel und Raumaufteilung beibehalten" (Standard: an)
- Strengere Grundanweisung, damit das Bildmodell Wände, Fenster und Perspektive nicht verändert

## 1.0.0
- Foto hochladen, Raumtyp und Kurzbeschreibung angeben
- KI-Redesign über Atlas Cloud (Nano Banana 2, Seedream 4.5, Grok Imagine), 10 Stilvorlagen, Vorher/Nachher-Regler
- Ideen von Claude: Analyse, 3 Konzepte, Farben, Materialien, Möbel mit Maßen und Suchbegriff
- Fotoformate: JPEG, PNG, WebP, GIF, AVIF, BMP direkt; HEIC, TIFF u. a. per lokaler Umwandlung (sips)
- Einstellungen in der App: API-Schlüssel, Claude-Modell und Tageslimit werden in `.env` gespeichert
- Tageslimit für Kosten, Schutz gegen fremde Webseiten, alle Daten nur lokal
