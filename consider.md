s nachgedacht

Sicherheitsanalyse: bubblegumart-redesign

Ich prüfe das Repository 
meinitnet/bubblegumart-redesign 
 
unter der Annahme, dass eine Nginx-Instanz als Reverse Proxy vor einer Node.js-Anwendung steht und die Anwendung selbst nicht direkt aus dem Internet erreichbar sein soll.

Der Schwerpunkt liegt auf realistischen Angriffsvektoren, Fehlkonfigurationen zwischen Nginx und Node.js sowie Schwachstellen im Anwendungscode. Entscheidend ist dabei nicht nur, ob eine Schwachstelle im Code existiert, sondern auch, ob der Proxy sie verhindert, verschärft oder umgeht.

Wichtige Einschränkung: Ich kann den Repository-Link untersuchen, aber ohne Zugriff auf den vollständigen Quellcode und die Konfigurationen kann ich noch keine belastbare Aussage treffen, dass eine konkrete Schwachstelle tatsächlich vorhanden oder ausnutzbar ist. Ich unterscheide deshalb zwischen zu prüfenden Risiken und nachgewiesenen Befunden.
1. Architektur und Angriffsfläche

Das Repository ist laut README eine statische Website mit einem Node.js-HTTP-Server, der Instagram-Medien über die Meta-Graph-API abruft, lokal zwischenspeichert und als Bilder, Videos und HTML ausliefert. Die Anwendung verwendet unter anderem sharp zur Bildverarbeitung und esbuild zur Minifizierung. 
meinitnet/bubblegumart-redesign · GitHub
+1

Internet / Angreifer

Manipulierte HTTP-Requests, Bots, große Requests

Nginx Reverse Proxy

TLS, Host-Validierung, Limits, Header, Rate-Limits

Node.js auf Port 3000

Routing, HTML-Rendering, API, Cache und Dateisystem

Lokaler Medien-Cache und Instagram API

Dateien, Metadaten, Access Token, externe Downloads

Die wichtigste Sicherheitsgrenze ist die zwischen Nginx und Node.js: Nginx darf nicht die einzige Schutzmaßnahme sein. Der Node-Prozess sollte nur über einen lokalen Socket oder eine intern erreichbare Adresse erreichbar sein, und die Anwendung muss auch bei fehlerhaften Requests sicher reagieren.
2. Konkrete Prüfergebnisse im Quellcode

Ich habe insbesondere server.js, die Routen, den Medien-Cache und die Startkonfiguration untersucht. Die folgenden Punkte sind aus dem öffentlich zugänglichen Quellcode abgeleitete Befunde; die tatsächliche Ausnutzbarkeit hängt teilweise von der produktiven Nginx- und Netzwerk-Konfiguration ab.
1. Ungeprüfter Host-Header
Hoch priorisieren

server.js, Zeile 898

Der Server erstellt die URL jedes Requests mit:
js

const requestUrl = new URL(
  request.url,
  `http://${request.headers.host}`
);

Der Host-Header kommt grundsätzlich vom Client. Ein ungültiger Wert kann dazu führen, dass new URL() eine Exception auslöst. Weil dieser Aufruf außerhalb eines lokalen try/catch liegt, fehlt an dieser Stelle eine kontrollierte Fehlerbehandlung.

Angriffsvektor: Ein Angreifer sendet fehlerhafte oder unerwartete Host-Werte. Je nach Node.js-Version und Prozesskonfiguration kann das mindestens zu fehlerhaften Antworten und möglicherweise zu einem Prozessabsturz führen. Ein erfolgreicher Remote-Crash ist damit noch nicht nachgewiesen.

Maßnahmen:

    In Nginx nur den vorgesehenen Domainnamen akzeptieren; unbekannte Hosts über einen Default-VHost zurückweisen.

    Den Host nicht als URL-Basis verwenden, sondern die Request-URL unabhängig davon parsen.

    Fehler beim Parsen kontrolliert mit 400 Bad Request beantworten.
    GitHub
    +1

2. Begrenzung der Download-Größe
Hoch priorisieren

server.js, Zeilen 287–296 und 437–443

Das Profilbild und normale Bilder werden mit fetch() geladen und anschließend vollständig mit response.arrayBuffer() in den Speicher eingelesen. Für Videos gibt es dagegen eine explizite Obergrenze von 150 MiB.

Angriffsvektor: Übermäßig große oder unerwartete Mediendaten können RAM und Festplattenplatz beanspruchen. Ein solcher Angriff ist nicht unmittelbar über eine frei wählbare Upload-URL möglich; die Downloads stammen aus den von Instagram gelieferten Daten. Das Risiko setzt daher einen kontrollierbaren oder kompromittierten Upstream, fehlerhafte Mediendaten oder ein vergleichbares Szenario voraus.

Maßnahmen:

    Größenlimits auch für Bilder und Profilbilder einführen.

    Datenströme mit einer festen Byte-Obergrenze verarbeiten, statt unbeschränkt arrayBuffer() aufzurufen.

    Zeitlimits, Redirect-Limits und eine Prüfung der erlaubten Zielhosts ergänzen.

    Speicher- und Plattenplatzlimits für den Node-Dienst setzen.
    GitHub
    +1

3. Denial of Service über öffentliche Routen
Mittlere bis hohe Priorität

server.js, Zeilen 921–943, 950–962 und 988–995

Seiten wie /, /portfolio/, /videos/, /api/instagram-media und /sitemap.xml können die Instagram-Datenabfrage auslösen. Der Code verwendet zwar gemeinsame Refresh-Promises und einen Cache, was parallele Refreshes begrenzt. Das schützt jedoch nicht vollständig gegen hohe Request-Last, Bildverarbeitung oder teure Antwortgenerierung.

Angriffsvektor: Viele gleichzeitige Requests, insbesondere bei leerem Cache, nach Ablauf des Caches oder bei langsamen externen Antworten, können CPU, Speicher, Verbindungen und Bandbreite beanspruchen.

Maßnahmen:

    Rate-Limits in Nginx und angemessene Connection-Limits einsetzen.

    Request- und Upstream-Timeouts konfigurieren.

    Cache-Aktualisierungen unabhängig von beliebigen Client-Requests planen.

    Limits für parallele Bildverarbeitung sowie Speicher und CPU des Dienstes setzen.
    GitHub
    +1

4. Fehlerdetails werden an Clients zurückgegeben
Mittlere Priorität

server.js, unter anderem Zeilen 958–960, 982–985 und 1059–1062

Bei Fehlern geben mehrere Routen error.message direkt als HTTP-Antwort aus. Das betrifft beispielsweise die Medien- und Profil-API sowie die Startseite.

Angriffsvektor: Ein Angreifer kann externe Fehler, Integrationsprobleme und interne Betriebsdetails leichter erkennen. Die Meldungen können außerdem Informationen über den Zustand der Instagram-Integration preisgeben.

Maßnahmen:

    Intern detailliert protokollieren, extern nur generische Fehlermeldungen zurückgeben.

    Niemals Access Tokens oder vollständige URLs mit geheimen Query-Parametern in Logs oder Antworten aufnehmen.

    Fehlerantworten mit Cache-Control: no-store versehen, sofern sie sensible Betriebsinformationen betreffen.
    GitHub
    +1

3. Weitere Angriffsvektoren

Risiko
	

Bewertung
	

Einschätzung

Direktzugriff auf Node.js
	

Hoch, falls Port 3000 öffentlich erreichbar ist
	

server.listen(port) gibt keinen Host an. Node.js kann deshalb auf allen geeigneten Interfaces lauschen.

Fehlende HTTP-Sicherheitsheader
	

Mittel
	

In den untersuchten Response-Pfaden sind keine durchgängigen Security-Header erkennbar. Nginx könnte sie ergänzen.

Abhängigkeiten und Lieferkette
	

Offen
	

sharp und esbuild sind native bzw. buildbezogene Komponenten; die tatsächlichen Versionen und bekannten Advisories müssen geprüft werden.

Cache-Verzeichnis und Dateirechte
	

Mittel
	

Medien und JSON-Indizes werden dauerhaft auf dem Dateisystem gespeichert. Rechte und Schutz vor unbefugter Änderung sind betriebsabhängig.

Manipulation durch externe Medien
	

Bedingt
	

Bildverarbeitung mit sharp erhöht die Bedeutung aktueller Bibliotheken und begrenzter Dateigrößen. Die Medien stammen laut Code aus der Instagram-Integration.

HTTP-Request-Smuggling
	

Nicht nachgewiesen
	

Erfordert eine Prüfung der konkreten Nginx-/Node-HTTP-Konfiguration und der Parser-Differenzen.
Besonders wichtig: Ist Port 3000 wirklich geschützt?

In server.js wird der Server so gestartet:
js

server.listen(port, () => {
  console.log(`Bubblegum Art läuft auf http://localhost:${port}`);
});

Die Ausgabe mit localhost beweist nicht, dass der Server ausschließlich auf localhost lauscht. Ohne explizite Bind-Adresse kann Node.js auch Verbindungen über externe Netzwerkschnittstellen annehmen. 
GitHub
+1

Das bedeutet: Eine sichere Nginx-Konfiguration allein reicht nicht, wenn Angreifer Port 3000 direkt erreichen können.

Empfohlene Absicherung:

    Node.js explizit an 127.0.0.1 binden, wenn Nginx auf demselben Server läuft.

    Alternativ einen Unix-Domain-Socket verwenden.

    Port 3000 in der Firewall für externe Verbindungen sperren.

    Bei getrennten Hosts ausschließlich den Proxy-Host als Quelle für den Node-Port zulassen.

Wenn Nginx und Node.js auf demselben Rechner laufen, ist eine Bindung an 127.0.0.1 in der Regel die einfachste Lösung.
4. Nginx-Konfiguration als zusätzliche Schutzschicht

Die folgende Konfiguration ist ein Ausgangspunkt für eine Website, deren öffentlicher Hostname bubblegumart.de ist und deren Node.js-Prozess auf demselben Server läuft. Sie muss an die bestehende TLS-Konfiguration und die tatsächlich verwendeten Domainnamen angepasst werden.
nginx

# Unbekannte Hosts nicht an Node.js weiterleiten.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name bubblegumart.de www.bubblegumart.de;

    # Bestehende Zertifikats- und TLS-Konfiguration hier ergänzen.

    client_max_body_size 1m;
    client_header_timeout 10s;
    client_body_timeout 15s;
    send_timeout 30s;
    keepalive_timeout 15s;

    limit_req_zone $binary_remote_addr
        zone=app_limit:10m rate=10r/s;

    location / {
        limit_req zone=app_limit burst=30 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host bubblegumart.de;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 3s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;

        proxy_hide_header X-Powered-By;

        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
    }
}

Wichtige Hinweise dazu:

    limit_req_zone muss im http-Kontext stehen, nicht innerhalb eines server- oder location-Blocks. Die Definition gehört daher in die zentrale Nginx-Konfiguration.

    client_max_body_size begrenzt eingehende Request-Bodies. Es begrenzt nicht die Größe der von Node.js heruntergeladenen Instagram-Medien.

    Die Beispielkonfiguration enthält absichtlich keine pauschale Content Security Policy (CSP). Eine CSP muss zu den tatsächlich verwendeten Skripten, Styles, Bildern und externen Quellen passen.

    HTTP/2, TLS-Zertifikate, HSTS und die HTTP-Weiterleitung von Port 80 auf HTTPS müssen in der vollständigen Konfiguration sauber berücksichtigt werden.

    X-Forwarded-For $remote_addr verhindert, dass ungeprüfte, vom Client mitgesendete X-Forwarded-For-Werte übernommen werden. Falls weitere vertrauenswürdige Proxys davorstehen, muss die Proxy-Kette entsprechend konfiguriert werden.

Die Header- und Proxy-Direktiven orientieren sich an der offiziellen 
Nginx-Reverse-Proxy-Dokumentation 
. 
NGINX Documentation
+1
5. Node.js-Code: konkrete Härtungsmaßnahmen

Neben Nginx würde ich die Anwendung an folgenden Stellen ändern.
A. Request-Parsing absichern

Die URL sollte nicht vom Host-Header abhängen. Für diesen Server genügt es, den Request-Pfad unabhängig von einem vom Client gelieferten Host zu parsen:
js

let requestUrl;

try {
  requestUrl = new URL(request.url, 'http://localhost');
} catch {
  response.writeHead(400, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Ungültige Anfrage');
  return;
}

Das beseitigt die Abhängigkeit von request.headers.host an dieser Stelle. Die Prüfung des erlaubten Hostnamens sollte zusätzlich am Nginx-Eingang erfolgen.
B. Download-Limits einführen

Bei storeImage() und downloadProfileAvatar() sollte die Antwort vor der Verarbeitung begrenzt werden.

Mindestens erforderlich sind:

    Eine maximale Bildgröße, beispielsweise 10 MiB als anwendungsbezogener Startwert.

    Eine begrenzte Download-Dauer.

    Ein Abbruch bei zu großen Antworten, auch wenn Content-Length fehlt oder falsch ist.

    Eine Prüfung des tatsächlichen Dateiformats, bevor Dateien dauerhaft gespeichert werden.

    Ein kontrollierter Umgang mit temporären Dateien und fehlgeschlagenen Downloads.

Die Grenze muss über den tatsächlichen gelesenen Datenstrom durchgesetzt werden; eine Prüfung ausschließlich des Content-Length-Headers reicht nicht.
C. Fehlerantworten vereinheitlichen

Aktuell werden Fehlerdetails teilweise direkt an den Client weitergegeben. Stattdessen sollten API-Routen beispielsweise Folgendes zurückgeben:
json

{
  "error": "Der Dienst ist vorübergehend nicht verfügbar."
}

Die genaue Ursache gehört in ein internes Log, ohne Tokens oder andere Geheimnisse. Die vorhandenen Statuscodes für externe API-Fehler sollten dabei erhalten bleiben.
D. Prozess und Dateisystem absichern

Das README empfiehlt bereits einen eingeschränkten Anwendungsbenutzer und einen nicht privilegierten Port. Diese Empfehlung sollte in der tatsächlichen Installation überprüft werden. 
meinitnet/bubblegumart-redesign · GitHub
+1

    Node.js nicht als root ausführen.

    Nur das Cache-Verzeichnis für Schreibzugriffe freigeben.

    .env mit restriktiven Dateirechten schützen, etwa chmod 600 .env.

    Das Repository, server.js und subpages.js für den Laufzeitbenutzer möglichst schreibgeschützt halten.

    CPU, RAM und Dateisystemverbrauch durch systemd oder andere Prozesslimits begrenzen.

    DEBUG im Produktivbetrieb deaktiviert lassen.

    Keine geheimen Zugangsdaten in Logs, HTTP-Antworten oder Git-Historie veröffentlichen.

6. Abhängigkeiten und Secrets überprüfen

Das Repository enthält eine package-lock.json. Aus dem bloßen Vorhandensein der Datei lässt sich jedoch nicht ableiten, ob die installierten Pakete aktuell und frei von bekannten Schwachstellen sind. 
meinitnet/bubblegumart-redesign · GitHub
+1

Im Repository-Verzeichnis würde ich folgende Prüfungen durchführen:
bash

# Installierte Abhängigkeiten auf bekannte Advisories prüfen
npm audit

# Direkte und indirekte Abhängigkeiten anzeigen
npm ls --all

# Node.js- und npm-Version feststellen
node --version
npm --version

# Verfolgte Dateien auf mögliche Secrets prüfen
git log --all --oneline
git ls-files

Für die Secret-Prüfung empfehle ich zusätzlich einen Scanner wie Gitleaks, der auch frühere Commits untersucht. npm audit ist keine vollständige Sicherheitsgarantie: Es erfasst bekannte Advisories, aber keine unbekannten Fehler oder alle möglichen Konfigurationsprobleme.
7. Priorisierter Maßnahmenplan

Priorität 1 – vor dem Produktivbetrieb

    Sicherstellen, dass Port 3000 von außen nicht erreichbar ist.
    Node.js lokal oder über einen geschützten Unix-Socket binden.
    Unbekannte Hostnamen in Nginx zurückweisen.
    Request-Parsing und Fehlerbehandlung absichern.
    .env und Instagram-Token auf versehentliche Veröffentlichung prüfen.

Priorität 2 – zeitnah

    Größen- und Zeitlimits für externe Downloads einbauen.
    Rate-Limits für dynamische Routen aktivieren.
    Security-Header und TLS-Konfiguration vervollständigen.
    Fehlerantworten vereinheitlichen.
    npm audit und Secret-Scanning durchführen.

Priorität 3 – Validierung

    Ungültige Host-Header und fehlerhafte URLs testen.
    Verhalten bei großen Bildern und langsamen Instagram-Antworten prüfen.
    Erreichbarkeit von Port 3000 von einem externen System testen.
    Nginx-Konfiguration mit nginx -t validieren.
    Logs und Ressourcenverbrauch unter kontrollierter Last beobachten.

Mein Fazit

Die wichtigsten Punkte sind derzeit die fehlende explizite Fehlerbehandlung beim URL-Parsing, die unbegrenzten Bild-Downloads und die Frage, ob Node.js direkt aus dem Internet erreichbar ist. Der letzte Punkt ist besonders wichtig, weil ein Reverse Proxy keine Schutzwirkung für Verbindungen entfaltet, die ihn umgehen.

Das sind konkrete, aus dem Quellcode ableitbare Prüfpunkte, aber noch kein vollständiger Penetrationstest. Insbesondere habe ich die produktive Nginx-Konfiguration, die tatsächliche Erreichbarkeit des Ports, die installierten Paketversionen und das Live-Verhalten des Servers nicht verifiziert.

Für eine abschließende Bewertung brauche ich vor allem deine aktuelle Nginx-Konfiguration – idealerweise den betreffenden server-Block sowie die upstream-Definition, falls vorhanden. Du kannst Zertifikatspfade, IP-Adressen und andere vertrauliche Angaben anonymisieren. Damit lässt sich gezielt prüfen, ob der Proxy zusätzliche Angriffswege eröffnet oder die identifizierten Risiken bereits wirksam begrenzt.
