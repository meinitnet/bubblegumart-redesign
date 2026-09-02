# Bubblegum Art

Statische Website mit serverseitiger Instagram-Graph-API-Anbindung. Der Server
speichert Bilder lokal, damit wiederholte Seitenaufrufe nicht von Instagram
abhaengen.

## Lokal starten

Voraussetzung: Node.js 18 oder neuer.

1. Eine Datei `.env` mit den Werten aus `.env.example` anlegen.
2. Den Server starten:

```sh
npm start
```

Die Website ist dann unter `http://localhost:3000` erreichbar. Der Prozess
laeuft unter dem angemeldeten Benutzer und benoetigt keine Root-Rechte.

Fuer lokale Fehlersuche koennen zusaetzliche Server-Logs aktiviert werden:

```sh
DEBUG=1 npm start
```

Dabei werden Requests, Cache-Treffer, Instagram-Statuscodes und Laufzeiten
ausgegeben. Zugangstokens werden nicht protokolliert.

## Instagram einrichten

Der Instagram-Account muss ein Professional Account (Business oder Creator)
sein und fuer eine Meta-App autorisiert werden. In `.env` werden diese Werte
gesetzt:

```dotenv
INSTAGRAM_USER_ID=...
INSTAGRAM_ACCESS_TOKEN=...
PORT=3000
SITE_URL=https://bubblegumart.de
MEDIA_CACHE_DIR=/home/bubblegumart/app-data/instagram
```

`INSTAGRAM_USER_ID` muss die numerische Instagram-User-ID des Professional
Accounts sein, nicht der Benutzername wie `tschiggys`.

Der Access Token ist geheim und darf weder im Browser noch im Git-Repository
landen. Er benoetigt mindestens die Berechtigung `instagram_business_basic`.

## Eigene lokale Bilder

Bilder koennen direkt in `storage/instagram/` abgelegt und in
`storage/instagram/media.json` definiert werden. `imageUrl` ist die grosse
lokale Version fuer die Lightbox; `thumbnailUrl` ist optional und kann auf
eine kleinere lokale Vorschau zeigen:

```json
[
	{
		"id": "tattoo-01",
		"caption": "Custom Tattoo",
		"imageUrl": "/instagram-media/tattoo-01-large.jpg",
		"thumbnailUrl": "/instagram-media/tattoo-01-thumb.jpg",
		"permalink": ""
	}
]
```

Die Dateien `tattoo-01-large.jpg` und `tattoo-01-thumb.jpg` muessen im selben
Ordner liegen. Ohne `thumbnailUrl` wird `imageUrl` auch fuer die Vorschau
verwendet. Alle Galerie-Klicks oeffnen die lokale grosse Datei in der
Lightbox. Mit `LOCAL_MEDIA_ONLY=1` in `.env` wird ausschliesslich diese lokale
Auswahl verwendet, auch wenn Instagram-Zugangsdaten gesetzt sind.

Die Weboberflaeche paginiert die geladenen Bilder automatisch: Das Instagram-
 Raster zeigt 12 Bilder pro Seite, das Portfolio 9 Bilder pro Seite.
Das Portfolio mischt den gesamten lokalen Bestand beim Laden zufaellig durch
und paginiert anschliessend diese Reihenfolge.

`/sitemap.xml` wird vom Server dynamisch aus dem lokalen `media.json` erzeugt
und enthaelt neben der Startseite auch alle lokal verfuegbaren Bilder.

### Langlebigen Token erstellen

1. Den Instagram-Account auf Business oder Creator umstellen und im
	[Meta for Developers Dashboard](https://developers.facebook.com/apps/) eine
	App erstellen.
2. In der App das Produkt **Instagram API with Instagram Login** hinzufuegen,
	eine OAuth-Redirect-URL konfigurieren und das Instagram-Konto als Tester
	oder Nutzer autorisieren. Der offizielle Ablauf steht in der
	[Meta-Startanleitung](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started).
3. Im dort beschriebenen OAuth-Ablauf einen User Access Token mit
	`instagram_business_basic` anfordern und ihn gemaess der
	[Token-Dokumentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login#refresh-a-long-lived-token)
	in einen langlebigen Token umwandeln.
4. Die zur Autorisierung ausgegebene Instagram User ID als
	`INSTAGRAM_USER_ID` und den langlebigen Token als
	`INSTAGRAM_ACCESS_TOKEN` in `.env` eintragen.

Langlebige Instagram-Tokens laufen ab. Meta empfiehlt, sie rechtzeitig ueber
den dokumentierten `refresh_access_token`-Endpunkt zu erneuern. Diese
Erneuerung sollte als geplanter Server-Task laufen; sie gehoert nicht in den
Browser und der Token darf nicht in Logs erscheinen.

## Betrieb ohne Root

Verwende einen eigenen, eingeschraenkten Benutzer, zum Beispiel
`bubblegumart`. Die Anwendung verwendet standardmaessig Port `3000`, also
einen nicht privilegierten Port. Fuer HTTPS und Port 443 wird ein Reverse Proxy
wie Nginx oder Caddy davor geschaltet; nur dieser Proxy muss Port 443 binden.

Die Anwendung kann direkt als dieser Benutzer gestartet werden:

```sh
cd /pfad/zu/bubblegumart-redesign
npm start
```

Der in `MEDIA_CACHE_DIR` angegebene Ordner muss dauerhaft gespeichert werden
und dem Anwendungsbenutzer gehoeren. Dort liegen die Bilddateien und die
gespeicherte Feed-Antwort. Ein Neustart des Dienstes leert diesen Cache daher
nicht.

### systemd-User-Dienst

Datei `~/.config/systemd/user/bubblegumart.service` des Anwendungsbenutzers:

```ini
[Unit]
Description=Bubblegum Art website
After=network-online.target

[Service]
WorkingDirectory=/pfad/zu/bubblegumart-redesign
EnvironmentFile=/pfad/zu/bubblegumart-redesign/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Danach im Benutzerkonto ausfuehren:

```sh
[Uniconst galleryPageSize = 12;
```

Damit der User-Dienst auch ohne angemeldete Sitzung weiterlaeuft, ist auf dem
Server einmalig `loginctl enable-linger bubblegumart` durch einen Administrator
erforderlich.

## Caching

Neue Beitraege werden alle 15 Minuten bei Instagram abgefragt. Bilddateien
werden beim ersten Abruf im `MEDIA_CACHE_DIR` gespeichert und danach lokal mit
einem Browser-Cache von einem Jahr ausgeliefert. Falls Instagram nicht
erreichbar ist, liefert der Server den zuletzt gespeicherten Feed aus. Der
Server folgt bei der Instagram-Abfrage automatisch allen `paging.next`-Seiten
und speichert jedes gefundene Bild lokal. Bei vielen Beiträgen kann der erste
Abruf deshalb länger dauern und viel Speicherplatz benötigen.