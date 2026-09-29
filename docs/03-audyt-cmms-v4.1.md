# Audyt prototypu CMMS V4.1 (Google Apps Script)

Przedmiot: kod w `src/` (Code.gs — 4228 linii, 3 szablony HTML). Cel audytu: ustalić, co z
obecnego rozwiązania jest wartością dla Filaru I, a co ryzykiem, zanim zapadnie decyzja
komercyjny vs autorski. Numery linii odnoszą się do `src/Code.gs`, o ile nie podano inaczej.

## 1. Podsumowanie

Prototyp jest znacznie dalej niż „czysta kartka”. Działa realny, używany obieg przeglądów
planowych z telefonu i zbiera dane, które są paliwem dla modułów AI (historia usterek per
maszyna, czas przestoju). Jednocześnie ma cechy prototypu: arkusz jako baza danych, logikę
rozrastającą się przez dopisywanie nowych wersji funkcji obok starych, twarde wpisy konfiguracji
w kodzie i kilka realnych błędów.

**Rekomendacja:** utrzymywać V4.1 jako system przejściowy (z pilnymi poprawkami z sekcji 4),
traktować go jako źródło wymagań i danych historycznych, i nie rozwijać go dalej funkcjonalnie —
nowe funkcje budować już w systemie docelowym.

## 2. Co już działa (inwentarz funkcji)

| Obszar | Funkcja | Gdzie |
|---|---|---|
| Kartoteka | Karta 110 urządzeń w 6 obszarach (Suche Mieszanki 48, MIXER HRB 19, Suszarnia Piachu 13, Kompresory 11, Rozdzielnie El. 11, Sprężone Powietrze 8), zakres czynności, częstotliwość | `aktualizujKarteUrzadzenKrakow` (l. 360) |
| Planowanie | Harmonogram D/T/M z pominięciem weekendów i świąt PL, stabilne ID `PRZ-<urządzenie>-<D/T/M>-<RRRRMMDD>`, zachowanie rozliczeń przy regeneracji | `generujHarmonogramV2_`, `swietaPL_`, `uwzglednijSwieta_` |
| Arkusze miesięczne | Rozbicie harmonogramu na miesiące + synchronizacja ręcznych zmian (`onEdit`) | `generujArkuszeMiesieczne`, `onEdit` (l. 2637) |
| Rozliczenia | Rozliczenie z arkusza i z telefonu, potwierdzenie DTR, zapis do Rejestru, blokada współbieżności (LockService) | `zapiszRozliczenie` (l. 1042) |
| Mobile / QR | Web App, kod QR na maszynie → najpilniejszy przegląd, etykiety do druku, rozpoznanie technika po koncie Google | `doGet` (l. 147), `FormularzMobile.html` |
| Awarie | Zgłoszenie awarii z QR (poza przeglądem), „maszyna stoi”, obieg statusów, czas przestoju, historia maszyny | `zglosAwarie` (l. 3330), `zmienStatusUsterki` |
| Powiadomienia | E-mail przy NOK / awarii, przypomnienia o terminach UDT i kalibracji | `MailApp`, `sprawdzTerminy` |
| Raportowanie | Dashboard w arkuszu (realizacja planu, wg obszaru), Panel Zarządu Web (`?panel=zarzad`, tryb demo) | `utworzDashboardCMMS`, `PanelZarzadu.html` |
| Serwis danych | Diagnostyka, migracja starych ID, naprawa formatu ID (1.10 ≠ 1.1), naprawa usterek | menu „Serwis i naprawa danych” |
| Formularz Google | Alternatywny kanał + przetwarzanie odpowiedzi (onFormSubmit) | `onFormSubmitCMMS` (l. 1438) |

Szacunkowa skala harmonogramu 18.09–31.12.2026: ~14 urządzeń dziennie × ~75 dni roboczych +
~52 tygodniowo × ~15 tyg. + ~44 miesięcznie × 4 ≈ **2 000 pozycji** — w granicach możliwości
arkusza, ale każda operacja zapisu przeszukuje cały harmonogram.

## 3. Luki względem celów Filaru I

| Luka | Dlaczego ważne |
|---|---|
| **Brak części zamiennych i powiązania z magazynem** — części występują tylko jako wolny tekst „Zalecenia / części” doklejany do opisu usterki | To naturalny punkt styku CMMS ↔ WMS; bez tego nie ma kosztu naprawy, rezerwacji części ani analizy zużycia |
| Brak zleceń pracy (work orders) jako bytu — jest przegląd albo usterka, nie ma zlecenia z przypisaniem, planowaniem, częściami, godzinami | Standard CMMS; podstawa planowania obciążenia zespołu |
| Brak hierarchii zasobów (zakład → linia → maszyna → podzespół) | Analizy awaryjności na poziomie podzespołu, rozszerzenie na inne lokalizacje |
| Brak kategorii/przyczyn awarii (słownik przyczyn, kod usterki) | Bez tego predykcja i analiza Pareto opierają się na wolnym tekście |
| Brak liczników pracy (motogodziny, cykle) | Przeglądy wg zużycia zamiast kalendarza; wejście dla predykcji |
| Brak ról i uprawnień — każdy z dostępem do arkusza może edytować wszystko | Integralność danych, audyt zmian |
| Brak modułów AI | Cel M ścieżki autorskiej; dane zbierane od teraz budują zbiór treningowy |

## 4. Ustalenia techniczne

Priorytety: **K** — krytyczne (naprawić w V4.1 niezależnie od decyzji o systemie docelowym),
**W** — ważne, **N** — dług techniczny (rozwiązuje się przy przejściu na system docelowy).

| # | Pr. | Ustalenie | Gdzie | Skutek |
|---|---|---|---|---|
| K1 | K | Harmonogram ma twardą datę końca `HARM_KONIEC = 31.12.2026` | l. 30 | Od 1.01.2027 system nie zaplanuje żadnego przeglądu; kontrakt trwa 12 mies. Potrzebny horyzont kroczący (np. +90 dni) generowany wyzwalaczem |
| K2 | ✅ | **Naprawione w V4.8.** Ucieczka `</script>` nie działa w `FormularzPrzegladu.html` i `PanelZarzadu.html`: w scriptlecie serwerowym `'<'` to zwykły znak `<`, więc `.replace(/</g, '<')` nic nie zmienia (w `FormularzMobile.html` jest poprawnie `'\\u003c'`) | `FormularzPrzegladu.html` l. 225–229, `PanelZarzadu.html` l. 80–81 | Opis usterki/rozliczenia zawierający `</script>` psuje stronę panelu zarządu, a w skrajnym przypadku pozwala wstrzyknąć skrypt (stored XSS) |
| K3 | ✅ | **Naprawione w V4.8.** Dane z formularzy wstawiane bez ucieczki HTML do treści e-maili | `zapiszRozliczenie` l. 1204, `zglosAwarie` l. 3364 | Znaczniki w opisie usterki trafiają do maila kierownika (wstrzyknięcie treści/linków) |
| W1 | W | Funkcja `rozpoznajLubDodajPracownika_` zdefiniowana dwukrotnie; obowiązuje druga, która nie ma dopasowania po mailu w kol. A | l. 58 i l. 108 | Pierwsza wersja jest martwym kodem; technicy z mailem wpisanym w kol. A zostaną dodani drugi raz |
| W2 | W | Każde otwarcie aplikacji przez nieznane konto dopisuje nową osobę do „6. Pracownicy” | `doGet` → `rozpoznajLubDodajPracownika_` | Lista pracowników „puchnie” (kierownicy, zarząd, przypadkowe wejścia) i trafia do list wyboru wykonawcy |
| W3 | W | `setXFrameOptionsMode(ALLOWALL)` dla wszystkich stron Web App | l. 190, 3784, 3887 | Aplikację można osadzić w obcej stronie (clickjacking); zostawić tylko, jeśli jest osadzana np. w Google Sites |
| W4 | W | Kody QR generowane przez zewnętrzną usługę `api.qrserver.com`, do której wysyłany jest adres Web App | l. 504, 1707, 2812, 2935 | Zależność od usługi trzeciej i ujawnienie adresu aplikacji; wygenerować QR lokalnie lub przez usługę Google |
| W5 | W | Jeden odbiorca wszystkich powiadomień wpisany w kod (`EMAIL_KIEROWNIKA`) | l. 27 | Brak zastępstw, eskalacji i routingu wg obszaru; zmiana wymaga edycji kodu |
| W6 | W | Zapis rozliczenia przechodzi po wszystkich arkuszach harmonogramu i zapisuje komórka po komórce | `zapiszRozliczenie` l. 1101–1126 | Czas zapisu rośnie z liczbą arkuszy/wierszy; przy 20 s blokady technik może dostać „System zajęty” |
| W7 | W | Stan przechowywany w dwóch miejscach (harmonogram zbiorczy + miesięczne) i synchronizowany przez `onEdit` | l. 2637–2690 | `onEdit` pomija edycje > 50 wierszy i zmiany ze skryptów/formularza → ryzyko rozjazdu danych |
| N1 | N | Martwy kod po `return` w tej samej linii (stara wersja harmonogramu, stara lista urządzeń po wczesnym wyjściu) | l. 523, l. 362 | Utrudnia utrzymanie, myli przy przeglądzie |
| N2 | N | Równoległe wersje funkcji: `doGetPanelZarzadu_`/`2_`, `zbierzDaneZarzadu_`/`2_`, `wygenerujKodyQR`/`wygenerujKodyQRMaszyn`, `generujHarmonogram2026`/`V2_` | różne | Nie wiadomo, która jest używana; do usunięcia po weryfikacji |
| N3 | N | Kartoteka 110 urządzeń zapisana w kodzie | l. 370–500 | Dane podstawowe powinny żyć w bazie/arkuszu, nie w skrypcie |
| N4 | N | Niespójne oznaczenia wersji (nagłówek V4.1, sekcje V4.6) | nagłówek, l. 3303 | Brak kontroli wersji — rozwiązuje to niniejsze repozytorium |
| N5 | N | Arkusz Google jako baza danych: brak więzów integralności, transakcji, historii zmian per rekord | całość | Akceptowalne dla prototypu; nieakceptowalne dla systemu docelowego z AI |

## 5. Co zabrać do systemu docelowego

- **Dane:** karta urządzeń, harmonogram z rozliczeniami, rejestr przeglądów, usterki z czasem
  przestoju, terminy UDT — to zbiór startowy do KPI bazowych i do modułów AI.
- **Rozwiązania, które się sprawdziły:** QR na maszynie → kontekst maszyny w telefonie;
  deterministyczne ID przeglądów; potwierdzenie DTR przed zapisem; logowanie kontem firmowym
  zamiast osobnych haseł; tryb demo panelu zarządu.
- **Lekcje:** ID jako tekst od początku (problem 1.10 vs 1.1); jedno źródło prawdy zamiast kopii
  miesięcznych; konfiguracja (odbiorcy, horyzont planowania) poza kodem.

## 6. Proponowane działania na V4.1 (przed decyzją B2)

1. K1 — horyzont kroczący harmonogramu (wyzwalacz dzienny/tygodniowy) — **przed grudniem 2026**.
2. K2, K3 — poprawki ucieczki danych w szablonach i mailach.
3. W1, W2 — jedna wersja rozpoznawania pracownika; bez automatycznego dopisywania nowych kont
   (lista zatwierdzana przez kierownika UR).
4. Zamrożenie funkcjonalne V4.1 — dalej tylko poprawki i zbieranie danych.

Każda z tych poprawek — osobny commit w `src/`, wdrażany przez `clasp push` po przeglądzie.
