# Änderungsprotokoll

Alles bleibt vorerst in Version 1. Kleine Schritte: 1.0.x für Korrekturen, 1.1, 1.2 und so weiter für neue Funktionen.
Jeder Stand bekommt einen Git-Tag (`v1.0.0`, `v1.1.0` ...).

## 1.8.2
- Fehler behoben: Der Schalter "Vorhandene Möbel und Raumaufteilung beibehalten" im Redesign-Bereich sprang nach Projektwechsel, Neuladen oder Bildwechsel wieder auf "an". Er wird jetzt im Projekt gespeichert und ist derselbe wie unter "Deine Angaben" und im Formular "Neues Projekt"

## 1.8.1
- Fehler "Claude hat kein gültiges JSON geliefert" behoben: Die App repariert kleine Formatfehler der Antwort selbst (Codeblock, überzählige Kommas)
- Ist die Antwort trotzdem unbrauchbar oder abgeschnitten, wiederholt die App die Anfrage einmal automatisch mit mehr Spielraum. Das kostet nur dann zusätzlich etwa 0,05 USD
- Claude bekommt die Anweisung, keine geraden Anführungszeichen in Texten zu verwenden (häufigste Ursache)
- Bei einem Fehler steht der Rohtext in data/last-claude-error.txt und im Terminal eine Zeile dazu

## 1.8.0
- Der Stil wird jetzt direkt im Bereich "Ideen von Claude" gewählt (Stilvorlagen oder "Offen"). Die Auswahl wird im Projekt gespeichert, Claude erzeugt die Ideen auf dieser Basis, und derselbe Stil gilt für das Redesign
- Im Redesign-Bereich gibt es keine zweite Stilauswahl mehr, nur noch eine Zeile mit dem gewählten Stil. Das vermeidet doppelte Eingaben
- Ändert man den Stil nach den Ideen, erscheint der Hinweis "Ideen neu erzeugen"

## 1.7.2
- "Vorhandene Möbel und Raumaufteilung beibehalten" steht jetzt schon im Formular "Neues Projekt" (standardmäßig an). Es gilt für die Ideen von Claude und für das erste Redesign
- Die Einstellung wird im Projekt gespeichert, steht unter "Deine Angaben", ist dort änderbar und löst bei Änderung den Hinweis "Ideen neu erzeugen" aus
- Claude bekommt die Einstellung für die Ideen: An bedeutet, er plant um die vorhandenen Möbel herum. Aus bedeutet, er darf alles neu planen

## 1.7.1
- Stil "Offen (nach Konzept)" im Redesign. Hat ein Projekt keinen Stil, wählt das Bildmodell jetzt einen stimmigen Stil passend zum Konzept. Vorher war unbemerkt "Skandinavisch" voreingestellt und hat das erste Redesign beeinflusst
- Nach "Ideen neu erzeugen" wird eine selbst bearbeitete Anweisung zurückgesetzt, weil sie zum alten Konzept gehörte
- Neues Projekt: Hinweis, dass zuerst ein Foto nötig ist; Stilfeld kürzer beschriftet

## 1.7.0
- Redesign-Bereich aufgeräumt: Stil, Konzept (mit Möbeln und eigenen Möbeln), eine Anweisung, dann Schalter, Modell, Anzahl
- Es gibt nur noch EIN Textfeld "Anweisung an das Bildmodell" (vorher zwei: "Zusätzlich" und die Anweisung). Es ist auf Deutsch, füllt sich automatisch aus Angaben, Konzept, gewählten Möbeln und eigenen Möbeln und ist jederzeit frei änderbar. "Automatisch neu erstellen" setzt zurück, "Von Claude formulieren lassen" lässt Claude einen Text schreiben
- Fehler behoben: "Dieses Konzept fürs Redesign wählen" wurde nicht übernommen, wenn vorher eine Anweisung gespeichert war. Jetzt aktualisiert sich die Anweisung sofort
- Bild vergrößern: Knopf rechts unten im Bild öffnet eine Großansicht mit Vorher-Nachher-Regler (Esc schließt), das normale Bild ist ebenfalls größer
- Stil und Preisniveau (Budget oder mittlere Qualität) ergänzt die App im Hintergrund selbst

## 1.6.2
- Die Bildanweisung, die Claude schreibt, ist jetzt auf Deutsch und lässt sich auf Deutsch bearbeiten
- Die festen Schutzregeln für Raum und Möbel im Hintergrund bleiben englisch, weil Bildmodelle Englisch am zuverlässigsten umsetzen

## 1.6.1
- "Ideen neu erzeugen" zeigt sofort Rückmeldung: Knopf gesperrt mit Ladeanzeige und Sekundenzähler direkt im Ideen-Bereich (vorher war am Hinweis-Knopf nichts zu sehen)
- Eigenes Möbelstück entfernen geht sofort, ohne Rückfrage

## 1.6.0
- Eigene Möbel: Im Redesign-Bereich Fotos von Möbelstücken hochladen (Name und Platzwunsch dazu). Das Bildmodell bekommt Raumfoto und Möbelfotos und baut genau diese Stücke ein
- Eigene Möbel sind pro Bild an- und abwählbar (bis zu 4 gleichzeitig) und lassen sich entfernen
- Claude kennt die eigenen Möbel bei den Ideen (er plant um sie herum, sie zählen nicht zum Budget) und in der Bildanweisung
- Nur mit Nano Banana 2 und Seedream 4.5, Grok Imagine verarbeitet nur ein Bild und zeigt einen Hinweis

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
