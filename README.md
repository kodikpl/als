# IPTV Player — Metro UI (Smart TV)

Kompletny odtwarzacz IPTV w stylu Windows 8 / Metro UI, zoptymalizowany pod pilota Smart TV.

## Uruchomienie

1. Skopiuj cały folder `iptv-player` na serwer HTTP lub otwórz lokalnie (niektóre funkcje CORS wymagają serwera).
2. Otwórz `index.html` w przeglądarce Smart TV / Chrome / Firefox / Edge.
3. Przy pierwszym uruchomieniu wybierz **Ustaw playlistę M3U** (URL / Wklej / Plik).

## Sterowanie pilotem

| Klawisz | Akcja |
|---------|--------|
| ↑ / ↓ | Następny / poprzedni kanał (na playerze) |
| ← / → | Nawigacja w menu / grupach |
| OK / Enter | Menu / wybór |
| Back / Escape | Zamknij panel |
| 0–9 | Numer kanału (multi-digit, auto-potwierdzenie po 2,5 s) |
| Play/Pause | Odtwarzaj / pauza (jeśli obsługiwane) |

## Struktura

```
iptv-player/
├── index.html
├── css/style.css
├── js/
│   ├── app.js          # główna logika, stany, OSD
│   ├── player.js       # video/audio player, błędy, fullscreen
│   ├── playlist.js     # parser M3U, localStorage, ulubione
│   ├── remote.js       # fokus + obsługa pilota
│   ├── settings.js     # ustawienia
│   ├── epg.js          # podstawowe EPG
│   └── audio.js        # visualizer Canvas
└── assets/load.svg     # loader (SVG zamiast GIF)
```

## Funkcje

- Metro UI (kafelki, płaski design, focus)
- Parser M3U / M3U8 (tvg-*, group-title, numery)
- Lista kanałów + grupy + ulubione
- OSD + pasek informacji + zegar
- Obsługa błędów streamu (ticker + retry)
- Audio visualizer dla stacji radiowych
- Pełny ekran API
- Wszystkie ustawienia w localStorage
- Tryb diagnostyczny

## Uwagi Smart TV

- HLS (.m3u8) działa natywnie w Safari i wielu TV; w Chrome może wymagać serwera z CORS.
- Automatyczny fullscreen jest blokowany bez interakcji użytkownika — opcja „Zawsze wymuszaj” działa po pierwszym naciśnięciu klawisza.
- Animacje można wyłączyć w ustawieniach dla słabszych urządzeń.

## Licencja

Kod przykładowy — do dowolnego użytku.
