# 🎾 SlagScan

AI-analyse van je tennisslagen, volledig in de browser. Upload een video of gebruik je camera live, en SlagScan:

- **herkent automatisch** forehands, backhands en opslagen/smashes
- **schat de racketsnelheid** (km/u) op basis van de polsbeweging en je lichaamslengte
- geeft per slag een **techniekscore (0–100)** met onderdelen: snelheid, kniebuiging, rotatie, armpositie, raakpunt en uitzwaai
- geeft **concrete tips** in het Nederlands
- toont een **skelet en polsspoor** over de video, plus markeringen op de tijdlijn
- laat je elke slag **in slow motion terugkijken**
- neemt een **live camerasessie op**, zodat je achteraf je slagen terugziet
- exporteert alles naar **CSV**

Je video verlaat je apparaat niet: de pose-detectie (MediaPipe Pose Landmarker) draait lokaal in de browser.

## Starten

Het is een statische site, zonder build-stap:

```bash
npm start          # of: python3 -m http.server 8000
# open http://localhost:8000
```

Voor de camera is HTTPS (of localhost) nodig. Je kunt de map direct op Vercel, Netlify of GitHub Pages zetten.

## Tips voor de beste resultaten

- Zorg dat je **hele lichaam** in beeld is, van achteren of van voren.
- Film met **60 fps** als het kan: minder bewegingsonscherpte.
- Vul je **lengte** en **slaghand** in bij Instellingen.
- Worden er slagen gemist? Zet de **gevoeligheid** hoger. Te veel valse slagen? Lager.

## Hoe het werkt

1. MediaPipe geeft per frame 33 lichaamspunten.
2. `js/analyzer.js` volgt de pols van je slaghand. De snelheid wordt gemeten in torsolengtes per seconde, zodat het niet uitmaakt hoe ver je van de camera staat.
3. Een piek boven de drempel is een slag. Het type hangt af van de polspositie in de voorbereiding: aan de kant van je slaghand is het een forehand, aan de andere kant een backhand, en boven het hoofd een opslag.
4. Rond het raakmoment worden kniehoek, elleboog, schouderdraai, raakhoogte en uitzwaai gemeten en gescoord.

De snelheden zijn **schattingen** uit 2D-video. Ze zijn goed om je eigen slagen onderling te vergelijken, maar het is geen radar.

## Structuur

```
index.html          interface
styles.css          opmaak (licht/donker)
js/app.js           video, camera, MediaPipe, tekenen, UI
js/analyzer.js      slagherkenning en scoring (los testbaar)
tests/              unit tests met gesimuleerde bewegingen (npm test)
```
