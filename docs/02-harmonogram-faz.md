# Harmonogram faz i kryteria odbioru

Miesiące liczone od startu kontraktu (M1 = pierwszy miesiąc). Daty kalendarzowe do wpisania po
potwierdzeniu daty rozpoczęcia. Harmonogram jest propozycją do zatwierdzenia — zgodnie z opisem
projektu to on staje się podstawą rozliczenia etapowego.

## Przegląd

```
Miesiąc          M1   M2   M3   M4   M5   M6   M7   M8   M9   M10  M11  M12
Faza rozliczenia [--- 1. Operacyjna ---][--- 2. Koncepcyjna ---][------ 3. Wdrożeniowa ------]
WMS              [przejęcie+uszczelnienie][optymalizacja 15%][dokumentacja][koordynacja przejścia →]
CMMS                  [ Analiza ][Projekt./Wybór][     MVP      ][   Pełne wdrożenie    ]
Bramki                         B1             B2                B3                       B4
```

| Bramka | Kiedy | Co zamyka |
|---|---|---|
| **B1** | koniec M3 | Faza Operacyjna (WMS) + Faza Analizy CMMS |
| **B2** | koniec M5 | Faza Koncepcyjna — decyzja komercyjny/autorski, projekt zatwierdzony |
| **B3** | koniec M8 | MVP CMMS w pilotażu; dokumentacja przedwdrożeniowa WMS gotowa |
| **B4** | koniec M12 | Faza Wdrożeniowa — systemy oddane do użytku |

## Faza 1 — Operacyjna (M1–M3)

**Cel:** pełne przejęcie i uszczelnienie procesów magazynowych w Arkuszach Google. Warunek
przejścia do tematów strategicznych CMMS.

| Produkt | Kryterium odbioru |
|---|---|
| Mapa obecnych arkuszy WMS (zakładki, kolumny, formuły, skrypty, kto edytuje) | Dokument zaakceptowany przez kierownika magazynu |
| Pomiar bazowy dokładności danych (audyt #0) | Raport z % dokładności i listą rozbieżności wg przyczyn |
| Pomiar bazowy czasu operacji | Czasy min. 4 operacji, ≥ 10 pomiarów każda |
| Reguły jakości danych w arkuszu (walidacja, listy, blokady, log zmian) | Wdrożone; brak możliwości wpisania indeksu/lokalizacji spoza słownika |
| Instrukcja wprowadzania danych + szkolenie zespołu | Lista obecności; instrukcja 1-stronicowa na stanowisku |
| Cykl audytów (cycle count) uruchomiony | ≥ 2 audyty wykonane wg harmonogramu |

**Równolegle — Analiza CMMS (M2–M3):**

| Produkt | Kryterium odbioru |
|---|---|
| Audyt prototypu CMMS V4.1 | [03-audyt-cmms-v4.1.md](03-audyt-cmms-v4.1.md) zweryfikowany z kierownikiem UR |
| Mapa procesów UR (as-is): przegląd planowy, awaria, naprawa, części zamienne, UDT/kalibracje, zlecenia zewnętrzne | 100% procesów opisanych i zatwierdzonych przez właściciela |
| Rejestr wymagań (must/should/could) | Priorytetyzacja zatwierdzona |
| Dane bazowe KPI (realizacja planu, MTTR, liczba awarii) z danych V4.1 | Raport bazowy |

**Bramka B1 — weryfikacja:** dokładność danych WMS mierzona i raportowana; ścieżka do 98%
widoczna (trend z audytów); zespół magazynowy pracuje według nowych zasad; analiza CMMS
kompletna.

## Faza 2 — Koncepcyjna CMMS (M4–M5)

**Cel:** decyzja i zatwierdzony projekt.

| Produkt | Ścieżka | Kryterium odbioru |
|---|---|---|
| Rekomendacja komercyjny vs autorski (TCO 3 lata, ryzyka, czas) | obie | Decyzja zarządu zapisana |
| RFP + analiza rynku (≥ 3 dostawców), macierz ocen, demo | komercyjna | Wybrany dostawca, oferta |
| Architektura systemu, model danych, API, bezpieczeństwo | autorska | Przegląd techniczny z IT |
| Makiety (klikalne) kluczowych ekranów: technik mobile, planista, kierownik, zarząd | obie | Test z ≥ 3 technikami |
| Logika AI: przypadki użycia, dane wejściowe, metryki, plan walidacji | autorska | Zatwierdzone metryki sukcesu |
| Backlog MVP + plan wydań, budżet, zespół | obie | Zatwierdzony zakres MVP |
| Plan migracji danych z V4.1 | obie | Mapowanie pól 1:1 |

W międzyczasie WMS: optymalizacja w arkuszach (automatyzacje, skrypty) → pomiar „po”.

## Faza 3a — MVP CMMS (M6–M8)

| Produkt | Kryterium odbioru |
|---|---|
| MVP w pilotażu na 1 obszarze (propozycja: obszar z największą liczbą awarii w danych V4.1) | ≥ 4 tyg. pracy produkcyjnej, 100% przeglądów pilotażowych rozliczonych w systemie |
| Moduł AI #1 — automatyzacja zgłoszeń (opis głosowy/tekstowy → urządzenie, kategoria, priorytet) | Metryka z fazy 2 osiągnięta na danych pilotażowych |
| Migracja danych historycznych z V4.1 | Liczby rekordów zgodne, próbka 5% zweryfikowana ręcznie |
| Dokumentacja przedwdrożeniowa WMS | Kompletna wg [05-wms-plan.md](05-wms-plan.md#4-dokumentacja-przedwdrożeniowa) |

**Bramka B3:** decyzja go/no-go na rollout na cały zakład.

## Faza 3b — Pełne wdrożenie (M9–M12)

| Produkt | Kryterium odbioru |
|---|---|
| Rollout na wszystkie obszary, szkolenia | 100% techników przeszkolonych, adopcja 100% |
| Moduł AI #2 — wczesne ostrzeganie / predykcja awarii (na zebranej historii) | Walidacja wsteczna wg metryki z fazy 2 |
| Wyłączenie prototypu V4.1 (tryb tylko-do-odczytu) | Brak zapisów w starym arkuszu przez 2 tyg. |
| Dokumentacja użytkownika i administratora, procedura wsparcia | Przekazane właścicielowi procesu |
| WMS: koordynacja przejścia na docelowy system (w zakresie ustalonym na B3) | wg planu przejścia |
| Raport końcowy KPI vs baza | Przedstawiony zleceniodawcy |

## Ryzyka harmonogramu

| Ryzyko | Wpływ | Mitygacja |
|---|---|---|
| Opóźnienie decyzji komercyjny/autorski | przesuwa MVP | termin decyzji wpisany do B2; przygotowane obie analizy |
| Brak zasobów programistycznych (ścieżka autorska) | MVP nie powstaje | potwierdzić zespół/budżet przed B2 |
| Za mało danych historycznych do predykcji | moduł AI #2 bez walidacji | zbieranie danych od M1 w V4.1; predykcja jako „should”, nie „must” |
| Opór zespołu przed dyscypliną danych (WMS i UR) | KPI 98% / adopcja | wsparcie kierowników, proste narzędzia mobilne, widoczne wyniki audytów |
| Prototyp V4.1 przestaje planować przeglądy po 31.12.2026 | luka w harmonogramie UR | poprawka przed grudniem — patrz audyt, K1 |
