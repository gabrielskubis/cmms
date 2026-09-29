# Karta projektu

**Nazwa:** Cyfryzacja Utrzymania Ruchu (CMMS) oraz Koordynacja i Uporządkowanie Gospodarki Magazynowej (WMS)
**Rola uczestnika:** Product Manager / Wdrożeniowiec IT
**Okres:** 12 miesięcy, rozliczanie etapowe
**Status dokumentu:** wersja robocza — szczegóły do doprecyzowania (patrz [06-otwarte-pytania.md](06-otwarte-pytania.md))

## 1. Cel główny

Zbudowanie od zera procesów oraz narzędzi dla obszaru Utrzymania Ruchu (CMMS) oraz
skoordynowanie, uszczelnienie i przygotowanie do pełnego wdrożenia obecnych procesów
magazynowych (WMS).

Zakres odpowiedzialności: od twardej analityki obecnych danych w Arkuszach Google (WMS),
przez projektowanie logiki, po finalne wdrożenie technologii — w tym autorskiego rozwiązania
CMMS opartego na AI.

> **Uwaga do stanu wyjściowego.** Filar I jest opisany jako „budowa od zera”, ale w arkuszu
> Google działa już prototyp CMMS (Apps Script, V4.1): karta 110 urządzeń w 6 obszarach,
> harmonogram przeglądów D/T/M, rozliczenia z telefonu przez kod QR, rejestr usterek z czasem
> przestoju, terminy UDT/kalibracji, dashboard i panel zarządu. Proponuję traktować go jako
> **MVP-0 / proof of concept** — źródło wymagań i danych historycznych, a nie system docelowy.
> Szczegóły: [03-audyt-cmms-v4.1.md](03-audyt-cmms-v4.1.md).

## 2. Filar I — CMMS (priorytet)

Ścieżka zależy od decyzji biznesowej: system komercyjny albo autorska aplikacja WEB z AI
(rekomendowana). Kryteria decyzji: [04-cmms-sciezka-docelowa.md](04-cmms-sciezka-docelowa.md).

| | Treść | Doprecyzowanie / miernik (propozycja) |
|---|---|---|
| **S** | Zaprojektowanie, nadzór nad stworzeniem i pełne wdrożenie systemu zarządzania UR od zera. | Zakres: wszystkie obszary zakładu Kraków (obecnie 110 urządzeń / 6 obszarów), docelowo kolejne lokalizacje — do potwierdzenia. |
| **M** — komercyjny | 100% procesów technicznych zmapowanych, RFP, analiza rynku, wybór dostawcy, pełne wdrożenie. | 100% procesów UR opisanych (BPMN/SIPOC) i zatwierdzonych; RFP wysłane do ≥ 3 dostawców; macierz ocen; system produkcyjny z migracją danych. |
| **M** — autorski | Pełna architektura i logika biznesowa, koordynacja prac programistycznych (WEB), integracja modułów AI (automatyzacja zgłoszeń, predykcja awarii), działający system. | Patrz KPI operacyjne niżej. |
| **A** | Pełny cykl życia produktu IT — od czystej kartki do narzędzia używanego przez zespół. | |
| **R** | Likwiduje chaos w UR, eliminuje ryzyko kosztownych przestojów, buduje unikalną wartość technologiczną. | |
| **T** | Rozliczenie etapowe w 12 mies.: Analiza → Projektowanie/Wybór → MVP → Pełne wdrożenie. | Daty bramek: [02-harmonogram-faz.md](02-harmonogram-faz.md). |

### KPI operacyjne CMMS (propozycja do zatwierdzenia)

„Działający i używany system” warto zmierzyć twardo. Poniższe KPI da się liczyć z danych, które
system V4.1 już zbiera (harmonogram, rejestr, usterki z czasem przestoju):

| KPI | Definicja | Cel (propozycja) | Źródło danych |
|---|---|---|---|
| Realizacja planu przeglądów (PM compliance) | przeglądy wykonane w terminie / zaplanowane do dziś | ≥ 90% | Harmonogram |
| Adopcja | % zleceń/przeglądów rozliczanych w systemie (a nie na papierze / ustnie) | 100% od fazy wdrożenia | Rejestr vs lista obecności UR |
| Kompletność zgłoszeń awarii | % usterek z ID urządzenia, czasem zgłoszenia i zamknięcia | ≥ 95% | Usterki i Awarie |
| MTTR | średni czas od zgłoszenia do usunięcia (awarie z postojem) | trend malejący vs baza z fazy Analizy | Usterki (kol. O „Czas przestoju”) |
| MTBF per maszyna | średni czas między awariami | baza w fazie Analizy, cel po 6 mies. danych | Usterki |
| Udział prac planowych | godziny PM / (PM + awaryjne) | ≥ 70% | Rejestr + Usterki |
| Moduł AI — zgłoszenia | % zgłoszeń poprawnie sklasyfikowanych (urządzenie, priorytet, kategoria) bez korekty człowieka | ≥ 85% na zbiorze testowym | log zgłoszeń |
| Moduł AI — predykcja | trafność ostrzeżeń (precision) na danych historycznych | do ustalenia po zebraniu ≥ 6 mies. historii | Usterki + Rejestr |

## 3. Filar II — WMS (koordynacja i optymalizacja)

Baza istnieje (Arkusze Google), cel końcowy jest znany — zadaniem jest egzekucja i koordynacja.
Plan szczegółowy: [05-wms-plan.md](05-wms-plan.md).

| | Treść | Doprecyzowanie / miernik (propozycja) |
|---|---|---|
| **S** | Bieżące zarządzanie i uszczelnienie gospodarki magazynowej w Arkuszach Google oraz przygotowanie i koordynacja przejścia na docelowy system. | |
| **M** | Dokładność danych magazynowych min. **98%**, weryfikowana regularnymi audytami. | Dokładność = pozycje (indeks × lokalizacja) zgodne ze stanem fizycznym / pozycje policzone. Tolerancja ilościowa i częstotliwość audytu — do ustalenia (propozycja: 0 szt. dla części zamiennych, cycle count ABC co tydzień). |
| **M** | Optymalizacja procesów w arkuszach (automatyzacja, skrypty) → skrócenie czasu operacji o **15%**. | Pomiar czasu wybranych operacji (przyjęcie, wydanie, inwentaryzacja, raport) przed i po — baza mierzona w pierwszych 2–3 tyg. |
| **M** | Kompletna dokumentacja przedwdrożeniowa dla nowego WMS. | Spis produktów w [05-wms-plan.md](05-wms-plan.md#4-dokumentacja-przedwdrożeniowa). |
| **A** | Natychmiastowe wejście w operację, zaawansowane Google Sheets, wyegzekwowanie dyscypliny wprowadzania danych, nowy sposób wprowadzania danych. | |
| **R** | Czyste dane w arkuszach to warunek bezbłędnego uruchomienia docelowego WMS. | |
| **T** | Pełne przejęcie i uszczelnienie procesów w arkuszach w pierwszej fazie — warunek przejścia do tematów strategicznych (CMMS). | Bramka: [02-harmonogram-faz.md](02-harmonogram-faz.md#faza-1--operacyjna-m1m3). |

## 4. Ramy rozliczania

Postępy weryfikowane na koniec każdej z 3 głównych faz:

1. **Faza Operacyjna** — weryfikacja twardych umiejętności: opanowanie Arkuszy Google (WMS).
2. **Faza Koncepcyjna (CMMS)** — kompletny plan działania, makiety, logika AI lub analiza dostawców komercyjnych.
3. **Faza Wdrożeniowa (finał)** — uruchomienie, przetestowanie i oddanie działających systemów do użytku firmy.

Mapowanie na 4 fazy projektowe CMMS (Analiza → Projektowanie/Wybór → MVP → Pełne wdrożenie)
oraz kryteria odbioru: [02-harmonogram-faz.md](02-harmonogram-faz.md).

## 5. Interesariusze (do uzupełnienia)

| Rola | Osoba | Udział |
|---|---|---|
| Zleceniodawca / sponsor | | akceptacja bramek, decyzja komercyjny vs autorski |
| Product Manager / Wdrożeniowiec IT | Gabriel Skubis | prowadzenie projektu |
| Kierownik UR | | właściciel procesów CMMS, odbiór |
| Technicy UR | | użytkownicy, pilotaż |
| Kierownik magazynu | | właściciel procesów WMS, egzekucja dyscypliny danych |
| IT / bezpieczeństwo | | konta Google, hosting, dostęp, RODO |
| Zespół programistyczny (ścieżka autorska) | | wykonanie aplikacji WEB |
