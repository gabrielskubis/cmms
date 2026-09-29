# Filar II — WMS: plan uszczelnienia i przygotowania do wdrożenia

Stan: arkusze WMS nie są jeszcze w repozytorium — plan zakłada ich przejęcie w pierwszych
tygodniach Fazy Operacyjnej. Wszystkie progi liczbowe poniżej to propozycje do zatwierdzenia.

## 1. Przejęcie (tydzień 1–2)

- Inwentarz arkuszy: pliki, zakładki, kolumny, formuły, skrypty, formularze, uprawnienia
  (kto edytuje, kto tylko czyta).
- Mapa procesów magazynowych: przyjęcie, wydanie (w tym na zlecenie UR), przesunięcie,
  zwrot, inwentaryzacja, zamówienie/uzupełnienie.
- Słowniki: indeksy materiałowe, lokalizacje, jednostki, kontrahenci — duplikaty, puste pola,
  niespójne nazewnictwo.
- Pomiary bazowe (sekcje 2 i 3).

## 2. Dokładność danych ≥ 98%

**Definicja (propozycja):**

```
dokładność = liczba pozycji zgodnych / liczba pozycji policzonych × 100%
pozycja    = para (indeks, lokalizacja)
zgodna     = |stan w arkuszu − stan fizyczny| ≤ tolerancja
```

- Tolerancja: 0 szt. dla części zamiennych i pozycji liczonych w sztukach; dla materiałów
  sypkich/wagowych — do ustalenia (np. ±1%).
- Metoda: **cycle count ABC** — A (wysoka wartość/rotacja, części krytyczne dla UR) co tydzień,
  B co miesiąc, C co kwartał; próbka losowa + pozycje z ostatnimi ruchami.
- Każda rozbieżność: przyczyna (brak zapisu wydania, zła lokalizacja, pomyłka jednostki,
  duplikat indeksu, kradzież/uszkodzenie) → działanie korygujące → trend przyczyn w raporcie.
- Raport: dokładność tydzień do tygodnia, osobno dla klas A/B/C; próg 98% utrzymany przez
  min. 3 kolejne audyty = cel osiągnięty.

## 3. Skrócenie czasu operacji o 15%

- Wybór 4–6 operacji mierzonych (np. przyjęcie dostawy, wydanie części na zlecenie UR,
  inwentaryzacja lokalizacji, raport stanów / zapotrzebowania).
- Pomiar bazowy: ≥ 10 pomiarów każdej operacji (stoper / znaczniki czasu w arkuszu).
- Usprawnienia: walidacja danych i listy rozwijane, formularz/aplikacja do wprowadzania
  (np. skan kodu kreskowego/QR lokalizacji), automatyczne raporty i alerty minimów (Apps Script),
  usunięcie ręcznego przepisywania między arkuszami.
- Pomiar „po” tą samą metodą; wynik = średnia ważona częstością operacji; cel ≥ 15%.

## 4. Dokumentacja przedwdrożeniowa

Kompletny pakiet dla docelowego WMS (niezależnie od wybranego dostawcy):

1. Mapy procesów as-is i to-be.
2. Słowniki danych podstawowych po oczyszczeniu (indeksy, lokalizacje, jednostki) + reguły
   nadawania kodów.
3. Specyfikacja wymagań funkcjonalnych i niefunkcjonalnych.
4. Specyfikacja migracji: mapowanie kolumn arkuszy → pola systemu, reguły czyszczenia,
   kryteria akceptacji (np. 100% indeksów zmigrowanych, stany zgodne z ostatnim audytem).
5. Integracje: **CMMS (części zamienne na zleceniach pracy)**, zakupy, księgowość/ERP.
6. Role i uprawnienia, plan szkoleń, plan przełączenia (cut-over) i powrotu (rollback).
7. Raport jakości danych z historii audytów (dowód spełnienia progu 98%).

## 5. Punkt styku z CMMS

Obecny CMMS V4.1 zapisuje potrzebne części tylko jako wolny tekst w opisie usterki. Wspólny
słownik indeksów części zamiennych i ich powiązanie z maszynami (BOM) to wspólny produkt obu
filarów — warto go zbudować już w arkuszach WMS w Fazie Operacyjnej, żeby był gotowy dla CMMS.
