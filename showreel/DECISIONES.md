# DECISIONES — Showreel 2026

Een showreel van 15 seconden: 1920×1080, 60 fps, met eigen muziek.
Alles is code: geen beeld-, video- of audiomodellen, geen samples, geen stockmateriaal.

| Bestand | Wat het is |
|---|---|
| `showreel.mp4` | Het eindresultaat: H.264 High, 1920×1080, 60 fps, 900 frames, AAC 320 kbps, precies 15,000 s |
| `reel.html` | Alle animatie: Canvas 2D. Elk frame is een pure functie van tijd `t` |
| `music.py` | De volledige soundtrack: numpy-synthese, 48 kHz stereo |
| `render.cjs` | Rendert met Playwright/Chromium headless in 4 parallelle workers en stuurt de frames naar ffmpeg |

---

## 1. Kernbeslissingen

### Eén ritmisch raster voor beeld én geluid
Het allereerste besluit, en het belangrijkste: **128 BPM**.
Bij dat tempo duurt een tel 0,46875 s, een maat 1,875 s, en zijn **8 maten precies 15,000 seconden**.
Elke maat is één scène, elke tel is een gebeurtenis. Beeld en muziek gebruiken dezelfde constanten (`B`, `BAR`).
Daardoor hoeft niets achteraf gesynchroniseerd te worden: een lettertje landt op de kick omdat ze allebei op `T(beat)` staan.

### Structuur (8 maten)
| Maat | Tijd | Scène | Wat het laat zien |
|---|---|---|---|
| 1 | 0,00–1,88 | **BOOT** | Een lijn tekent zich, een liniaal knippert op de achtsten, een stip valt op de lijn. De lijn veert als een snaar (gedempte sinus op 28 rad/s). |
| 2 | 1,88–3,75 | **TYPE** | "MOTION / IS / MY / LANGUAGE": één woord per tel, en elk woord met een andere techniek (gemaskeerde letters, schaal-slam met radiale burst, horizontale slices, flip-in en dan squeeze tot een streep) |
| 3 | 3,75–5,63 | **RHYTHM** (drop) | Witte flits, schokgolf, speedlines. Daarna een raster van 375 vormen waar per kick een rimpel doorheen loopt; elke rimpel morpht cirkels naar gedraaide vierkanten. Uitgang: inzoomen in de middelste stip. |
| 4 | 5,63–7,50 | **DIMENSION** | 900 deeltjes in 3D die per tel morphen: bol → torus → kubus → golvend veld. Met een baan en een satelliet, en live readouts. Uitgang: een streepjeswipe. |
| 5 | 7,50–9,38 | **ORGANIC** | Een noise-blob met topografische contourlijnen die naar buiten stromen, een satelliet-blob met doorsnede en roterende cirkeltypografie. Uitgang: een iris. |
| 6 | 9,38–11,25 | **SYSTEMS** | UI/data-motion: odometer-cijfers (60 · 900 · 0 · 128), een staafgrafiek die op elke tel nieuwe data krijgt (veren), een lijngrafiek die zich tekent en een donut. Uitgang: RGB-glitch. |
| 7 | 11,25–13,13 | **MONTAGE** | Recuts van eerdere scènes in andere paletten, op achtsten en daarna zestienden. Met woorden in difference-blend (TIMING, SPACING, RHYTHM, CONTRAST, DETAIL, CRAFT) en een countdown 3-2-1. |
| 8 | 13,13–15,00 | **END** | Cirkel, vierkant en driehoek (de drie primitieven van de reel) landen op de tel. Daarna de naam, een onderstreping, de rol en een tagline. |

### Visuele taal
- **Een beperkt palet**: inkt `#0A0A0C`, papier `#F1EEE7`, signaaloranje `#FF4B1F`, kobalt `#2B4BFF` en spaarzaam lime. Het palet is een object `P` dat ik kan omwisselen. Zo kan de montage dezelfde scènes in nieuwe kleurstellingen hergebruiken: één systeem, veel variatie. Precies wat een motion designer laat zien.
- **Typografie**: Inter Display Black voor impact en JetBrains Mono voor technische labels.
- **Een terugkerend designsysteem**: genummerde label-tags (`01 RHYTHM`, `02 DIMENSION`…) met dezelfde wipe-animatie, plus een HUD met crop marks, timecode, scène-index, een tel-indicator en een voortgangsbalk.
- **De HUD in `difference`-blend**: hij is daardoor op elke achtergrond leesbaar zonder kleurlogica.
- **Easing als vakmanschap**: expo-out voor binnenkomsten, expo-in voor vertrek, veren (gedempte cosinus) voor data, en squash & stretch bij impact (de stip, de logovormen).
- **Motion blur**: echte temporele supersampling. Elk frame is het gemiddelde van 6 subframes binnen een sluiter van 180°, zoals een camera dat zou doen.
- **Camera shake** alleen op de kicks in de drop en de montage, met een grote stoot bij de drop en bij de eindkaart.
- **Film grain** (temporele ruis via ffmpeg) en een subtiel vignet, zodat het niet "te digitaal schoon" oogt.

### Muziek: volledig gesynthetiseerd
F mineur, 128 BPM. Alle klanken zijn wiskundig opgebouwd:
- **Kick**: een sinus met een exponentiële pitch-sweep (176 → 46 Hz), een klik-transient en tanh-saturatie.
- **Clap**: drie ruisbursts met 11 ms ertussen, door een bandpass-filter van 1,25 kHz.
- **Hihats/crash**: een 808-achtig metaalcluster van zes ontstemde blokgolven plus ruis, door een highpass-filter.
- **Supersaw-pads en -stabs**: 7 ontstemde polyBLEP-zaagtanden per noot over het stereobeeld, met een TPT state-variable filter (Zavalishin) waarvan de cutoff mee beweegt.
- **Bas**: een offbeat-housebas (zaagtand plus sub-sinus) met een filterenvelope.
- **Arpeggio**: plucks op zestienden met een ping-pong-delay van 3/16.
- **Sounddesign gekoppeld aan beeld**: een opwaartse sweep terwijl de lijn tekent; ticks op de knipperende liniaal; een fluittoon terwijl de stip valt; een **"boing" die wiebelt op exact dezelfde 28 rad/s als de snaar in beeld**; een zuiggeluid bij de implosie; een riser en snare-roll naar de drop; whooshes op elke scèneovergang; tikbursts terwijl de odometer rolt; bitcrush-blips op de montagecuts; countdown-piepjes bij 3-2-1; FM-bellen wanneer de drie logovormen landen.
- **Sidechain-pumping**: pads en bas ducken op elke kick.
- **Reverb**: convolutie (via FFT) met een synthetische impulsrespons van exponentieel uitstervende, gefilterde ruis, met aparte IR's voor links en rechts.
- **Master**: highpass op 28 Hz, normalisatie, tanh-softclip en een fade-out over de laatste 0,55 s.
- **Arrangement**: een filterende intro → stabs per woord → een snare-roll met een **stilte van een kwart tel vóór de drop** (dat laat de drop harder aankomen) → vier maten groove (Fm–D♭–A♭–E♭) → een build op B♭m–C (dominant) → een oplossing naar Fm(add9) op de eindkaart.

### Techniek
- **Canvas 2D in headless Chromium** (via Playwright): vectorkwaliteit, blend modes, `roundRect`, `letterSpacing`, systeemfonts. Alles in één bestand, zonder build.
- **Deterministisch**: geen `Math.random()`, alleen geseede PRNG (mulberry32). Dezelfde `t` geeft altijd hetzelfde frame. Daardoor kon ik in 4 parallelle workers renderen, elk met een eigen segment, en die aan elkaar plakken.
- **Pijplijn**: frame → PNG → ffmpeg-pijp → bijna-lossless x264-segmenten (CRF 8, 4:4:4) → concat → grain → eindencode CRF 17, yuv420p, faststart.

---

## 2. Wat ik heb verworpen

- **Python + Cairo/Skia** voor de rendering: niet geïnstalleerd, en Canvas in Chromium biedt meer (blend modes, tekstrendering met kerning) zonder dependencies.
- **WebGL/shaders**: krachtiger voor vloeistoffen, maar bij software-rendering in een container minder voorspelbaar. Canvas 2D was snel genoeg (50–160 ms per subframe).
- **Metaballs met threshold op pixelniveau** voor de organische scène: te duur per subframe en minder grafisch. De noise-blob met contourlijnen is beter herkenbaar als "design".
- **Grain in de canvas**: dat maakt PNG's groot en de pijplijn traag. Ik heb het naar ffmpeg verplaatst.
- **Een `difference`-blend voor de overlappende blobs**: dat gaf kleuren buiten het palet (cyaan, mosterd). Ik heb een clip-masker gebruikt, zodat de doorsnede papier-wit wordt en binnen het palet blijft.
- **Een aanhoudende pad in maat 2**: losse stabs per woord maken elke tel voelbaar en geven de typografie gewicht.
- **Een fade naar zwart halverwege de eindkaart**: de kaart blijft staan en vervaagt pas in de laatste 0,35 s.
- **`-tune grain` in x264**: bestandsgrootte ×20 (37 MB voor 4 seconden).

---

## 3. Iteraties

1. **De raster-beslissing**: 128 BPM → 8 maten = 15 s. Scènelijst en sync-momenten eerst op papier (in code-commentaar).
2. **Muziek v1**: gesynthetiseerd in 2 s. Omdat ik niet kan luisteren, heb ik de mix **visueel gecontroleerd** met een spectrogram en een golfvormbeeld (ffmpeg `showspectrumpic`/`showwavespic`): sweep, ticks, boing, riser, het gat vóór de drop, de whooshes per maat en de eindimpact stonden allemaal op de juiste plek.
3. **Beeld v1**: 16 testframes als contactsheet.
   - De donut botste met de hoogste staaf in de grafiek → staven lager, donut hoger.
   - Het vignet maakte oranje vlakken modderig → van 38 % naar 22 %.
4. **Overgangen v2**: een tweede contactsheet van 28 frames, precies rond elke cut.
   - De zoom in de middelste stip eindigde op **papier** in plaats van **inkt** (de stip kleurde mee met de rimpel) → bij het inzoomen geforceerd op inkt, zodat hij naadloos overgaat in de zwarte 3D-scène.
   - De laatste odometer stond nog te rollen bij de cut → de rol versneld (0,42 → 0,34 s).
5. **Volledige render**: 6 subframes motion blur, 4 workers, 85 s.
6. **Encode-iteratie**:
   - De eerste versie met grain 6 en CRF 16 werd **200 MB** → test met grain 2–4 en CRF 17–18 op een fragment van 4 s.
   - `-tune grain` bleek desastreus.
   - Eindkeuze: grain 3, CRF 17, preset slow → **21 MB**.
7. **Controle van het eindbestand**: met ffprobe (1920×1080, 60/1, 900 frames, 15,000 s, AAC) en een contactsheet uit de echte MP4 om motion blur en grain te beoordelen.

---

## 4. Totale tijd

**Ongeveer 20 minuten**, van de eerste opdracht tot de eindencode en dit document (gemeten met tijdstempels in de sessie: 20:47 → ±21:07 UTC).
Daarvan was de computer ongeveer 7 minuten aan het rekenen (renders en encodes). De rest ging naar ontwerpen, schrijven en controleren.

## Opnieuw bouwen

```bash
python3 music.py music.wav
node render.cjs video raw.mp4 6 4          # 6 motion-blur samples, 4 workers
ffmpeg -f concat -safe 0 -i raw.mp4.txt -i music.wav \
  -vf "noise=alls=3:allf=t,format=yuv420p" -c:v libx264 -preset slow -crf 17 \
  -c:a aac -b:a 320k -shortest -movflags +faststart showreel.mp4
```
