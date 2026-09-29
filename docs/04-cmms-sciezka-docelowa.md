# CMMS — ścieżka docelowa: komercyjny vs autorski

Dokument roboczy do Fazy Koncepcyjnej (bramka B2). Rekomendacja zleceniodawcy: ścieżka autorska
(aplikacja WEB z AI). Poniżej kryteria, które pozwolą tę rekomendację potwierdzić lub odrzucić
na danych, oraz szkic architektury dla ścieżki autorskiej.

## 1. Kryteria decyzji

| Kryterium | Waga (propozycja) | Komercyjny | Autorski |
|---|---|---|---|
| Czas do działającego systemu w całym zakładzie | 20% | zwykle krótszy (konfiguracja) | dłuższy; skraca go istniejący prototyp V4.1 jako specyfikacja |
| TCO 3 lata (licencje / zespół dev + utrzymanie + hosting) | 20% | licencja per użytkownik/zasób | koszt zespołu i utrzymania po stronie firmy |
| Dopasowanie do procesów (QR, DTR, obszary, UDT) | 15% | kompromisy konfiguracyjne | pełne |
| Możliwości AI (zgłoszenia, predykcja) i własność danych/modeli | 15% | zależne od roadmapy dostawcy | pełna kontrola; „unikalna wartość technologiczna” |
| Integracja z WMS (części zamienne) i innymi systemami | 10% | gotowe konektory lub API dostawcy | projektowana od początku |
| Ryzyko utrzymania (odejście kluczowych osób, bezpieczeństwo, aktualizacje) | 10% | po stronie dostawcy | po stronie firmy — wymaga zespołu po projekcie |
| Skalowanie na inne lokalizacje | 10% | zwykle natywne | trzeba zaprojektować (multi-site) |

Warunek konieczny ścieżki autorskiej: potwierdzone zasoby programistyczne i właściciel
utrzymania **po** zakończeniu 12-miesięcznego kontraktu.

## 2. Ścieżka komercyjna — produkty fazy

1. Mapa 100% procesów UR (as-is → to-be).
2. RFP: wymagania funkcjonalne (z rejestru wymagań + inwentarza V4.1), niefunkcjonalne
   (mobile/offline, SSO Google, język PL, hosting/RODO), migracja danych, SLA, model licencji.
3. Long-list → short-list (≥ 3), demo na scenariuszach z zakładu (przegląd z QR, awaria
   „maszyna stoi”, UDT), referencje z branży.
4. Macierz ocen wg kryteriów z sekcji 1, rekomendacja, negocjacje, plan wdrożenia.

## 3. Ścieżka autorska — szkic architektury

```
 Technik (telefon, QR)   Planista / Kierownik UR (WEB)   Zarząd (panel)
            \                       |                        /
             +-------- Frontend WEB (PWA, tryb offline) ----+
                                    |
                            API (REST) + SSO Google Workspace
                                    |
     +----------------+-------------+---------------+------------------+
     | Zasoby i       | Zlecenia    | Części i       | Moduły AI        |
     | harmonogramy   | pracy/awarie| magazyn (WMS)  | (zgłoszenia,     |
     | PM             |             |                | predykcja)       |
     +----------------+-------------+---------------+------------------+
                                    |
                     Relacyjna baza danych + historia zmian
                                    |
               Eksport do BI / arkuszy (raporty, panel zarządu)
```

### Model danych (rdzeń)

- **Lokalizacja → Obszar → Zasób → Podzespół** (hierarchia; ID tekstowe, np. `1.10`).
- **Plan przeglądu** (zasób, częstotliwość D/T/M lub licznik, zakres czynności, checklista).
- **Zlecenie pracy** (typ: przegląd / awaria / naprawa / zewnętrzne; status; przypisanie;
  planowany i rzeczywisty czas; części; przyczyna; kod usterki).
- **Zgłoszenie awarii** (źródło: QR / telefon / AI; „maszyna stoi”; czas przestoju).
- **Część zamienna** (indeks z WMS, stan, lokalizacja, rezerwacja, zużycie na zleceniu).
- **Termin prawny** (UDT, kalibracje) z przypomnieniami.
- **Pracownik / rola** (technik, planista, kierownik, zarząd, magazyn).

### Moduły AI

| Moduł | Wejście | Wyjście | Kiedy |
|---|---|---|---|
| Automatyzacja zgłoszeń | opis tekstowy/głosowy, zdjęcie, zeskanowany QR | rozpoznane urządzenie, kategoria i priorytet, sugerowane części, czy „maszyna stoi” — do zatwierdzenia przez człowieka | MVP |
| Asystent technika | historia maszyny, DTR, poprzednie naprawy | podpowiedź „co sprawdzić” przy awarii, podsumowanie historii | MVP / wdrożenie |
| Wczesne ostrzeganie / predykcja | historia usterek, przeglądy NOK, liczniki, (opcjonalnie) dane z PLC/czujników | ranking maszyn wg ryzyka awarii w horyzoncie N dni | po ≥ 6 mies. danych |
| Raport dla zarządu | KPI, usterki, przestoje | tygodniowe podsumowanie tekstowe z trendami | wdrożenie |

Zasady: AI proponuje, człowiek zatwierdza (każda sugestia logowana z decyzją — to zarazem zbiór
do oceny trafności); metryki sukcesu każdego modułu ustalone w Fazie Koncepcyjnej przed
rozpoczęciem prac; dane wrażliwe (nazwiska) nie trafiają do modeli bez potrzeby.

### Wymagania niefunkcjonalne (do potwierdzenia z IT)

- Logowanie kontem firmowym (SSO), role i uprawnienia, log audytowy zmian.
- Działanie na telefonie w hali, także przy słabym zasięgu (kolejka offline).
- Hosting i przetwarzanie danych zgodne z polityką firmy i RODO.
- Kopie zapasowe, środowisko testowe oddzielone od produkcyjnego.
- Migracja danych z V4.1 (arkusze) skryptem, z raportem zgodności.
