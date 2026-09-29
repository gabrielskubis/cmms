# Cyfryzacja Utrzymania Ruchu (CMMS) i uporządkowanie gospodarki magazynowej (WMS)

Repozytorium projektu prowadzonego w roli **Product Manager / Wdrożeniowiec IT** w ramach
12-miesięcznego kontraktu. Zawiera kod obecnego systemu CMMS (Google Apps Script, wersja
„CMMS Kraków V4.1”) oraz dokumentację projektową: cele, harmonogram faz, audyt stanu obecnego
i plany dla obu filarów.

## Struktura

| Ścieżka | Zawartość |
|---|---|
| [`docs/01-karta-projektu.md`](docs/01-karta-projektu.md) | Opis projektu, cele SMART (Filar I CMMS, Filar II WMS) z doprecyzowanymi miernikami |
| [`docs/02-harmonogram-faz.md`](docs/02-harmonogram-faz.md) | Fazy, kamienie milowe, produkty i kryteria odbioru każdej fazy |
| [`docs/03-audyt-cmms-v4.1.md`](docs/03-audyt-cmms-v4.1.md) | Audyt obecnego CMMS (Apps Script): co już działa, luki względem celów, ryzyka techniczne |
| [`docs/04-cmms-sciezka-docelowa.md`](docs/04-cmms-sciezka-docelowa.md) | Decyzja „komercyjny vs autorski”, architektura docelowa, moduły AI |
| [`docs/05-wms-plan.md`](docs/05-wms-plan.md) | Filar II: metoda pomiaru dokładności 98%, pomiar skrócenia czasu o 15%, dokumentacja przedwdrożeniowa |
| [`docs/06-otwarte-pytania.md`](docs/06-otwarte-pytania.md) | Punkty do doprecyzowania ze zleceniodawcą |
| [`docs/07-usprawnienia.md`](docs/07-usprawnienia.md) | Nowy interfejs przeglądu (telefon + laptop), instrukcja wdrożenia, lista kolejnych usprawnień |
| `src/` | Kod CMMS (Apps Script + szablony HTML) — aktualna wersja do wklejenia w Apps Script |

## Kod `src/`

| Plik | Rola |
|---|---|
| `src/Code.gs` | Logika serwerowa: karta 110 urządzeń, harmonogram przeglądów, rozliczenia, usterki/awarie, kody QR, dashboard, panel zarządu, terminy UDT, wyzwalacze |
| `src/FormularzMobile.html` | Aplikacja mobilna (Web App) dla techników — skan QR, rozliczenie przeglądu, zgłoszenie awarii |
| `src/FormularzPrzegladu.html` | Okno rozliczenia otwierane z arkusza Google |
| `src/PanelZarzadu.html` | Panel zarządu (`?panel=zarzad`, tryb demo `&demo=1`) |

Pierwszy commit (`Dodaj kod CMMS Kraków V4.1…`) to wersja produkcyjna 1:1; kolejne zmiany idą
osobnymi commitami, więc różnicę względem produkcji widać w historii.

### Kopiowanie do Apps Script (bez narzędzi)

Otwórz link, zaznacz wszystko (Ctrl+A), skopiuj i wklej w miejsce całej treści pliku o tej samej
nazwie w edytorze Apps Script, zapisz (Ctrl+S). Po zmianach w plikach HTML lub funkcjach Web App:
**Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.

| Plik | Link (Raw) |
|---|---|
| Code.gs | https://github.com/gabrielskubis/cmms/raw/claude/cmms-wms-digitalization-uanvfq/src/Code.gs |
| FormularzMobile.html | https://github.com/gabrielskubis/cmms/raw/claude/cmms-wms-digitalization-uanvfq/src/FormularzMobile.html |
| FormularzPrzegladu.html | https://github.com/gabrielskubis/cmms/raw/claude/cmms-wms-digitalization-uanvfq/src/FormularzPrzegladu.html |
| PanelZarzadu.html | https://github.com/gabrielskubis/cmms/raw/claude/cmms-wms-digitalization-uanvfq/src/PanelZarzadu.html |

### Synchronizacja z projektem Apps Script

Kod działa w projekcie Apps Script powiązanym z arkuszem CMMS. Do pracy z repozytorium zalecany
jest [`clasp`](https://github.com/google/clasp):

```bash
npm i -g @google/clasp
clasp login
clasp clone <SCRIPT_ID> --rootDir src   # pobiera też appsscript.json z produkcji
clasp push                               # dopiero po przeglądzie zmian
```

Manifest `appsscript.json` celowo nie jest wersjonowany, dopóki nie zostanie pobrany z
produkcyjnego projektu — ustawienia `executeAs` / `access` Web App wpływają na bezpieczeństwo
i na działanie `Session.getActiveUser()` (patrz audyt, sekcja 4).
