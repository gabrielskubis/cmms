/**
 * CMMS HOLCIM - Główny skrypt systemu (Wersja CMMS Kraków V4.1)
 * System zarządzania utrzymaniem ruchu, rozliczanie przeglądów, kody QR, powiadomienia email.
 *
 * ZMIANY WZGLĘDEM V3.2 (żadna funkcja nie została usunięta):
 *  1. ID przeglądu jest deterministyczne: PRZ-<ID urządzenia>-<RRRRMMDD>.
 *     Ponowne generowanie harmonogramu NIE przenumerowuje przeglądów i NIE kasuje rozliczeń.
 *  2. Kolumny z ID są wymuszane jako TEKST ("@") - naprawia sklejanie 1.10 -> 1.1 (8 maszyn).
 *  3. Rozliczenie zapisuje poprawne ID urządzenia w "4. Usterki i Awarie" (12 kolumn).
 *  4. Dashboard liczy realną "realizację planu" (wykonane / zaplanowane do dziś), a nie udział OK.
 *  5. Odpowiedzi z Formularza Google są wreszcie przetwarzane do Rejestru (wyzwalacz onFormSubmit).
 *  6. Skan kodu QR (parametr ?id=) podpowiada najpilniejszy przegląd danego urządzenia.
 *  7. Nowe narzędzia serwisowe: diagnostyka danych, migracja starych ID, naprawa formatu ID,
 *     naprawa ID w usterkach, generowanie arkuszy miesięcznych.
 *
 * V4.1 - CZYTELNOŚĆ I POPRAWKI PO PIERWSZYM URUCHOMIENIU:
 *  - Menu pogrupowane w podmenu; na górze tylko to, czego używa się codziennie.
 *  - Harmonogram: pasy tła per dzień, żółte = dziś, czerwone = po terminie (na żywo), szare = wykonane, filtry.
 *  - Dashboard liczony na żywo formułami, tabela realizacji wg obszaru, poprawione kolory i osie wykresów.
 *  - Usterki: pełne formatowanie, listy statusu/priorytetu, automatyczna data usunięcia, naprawa starego układu kolumn.
 *  - Rejestr: wpisy archiwalne wyszarzone zamiast "- | [⚠️ ID historyczne...]" w Uwagach.
 *  - Formularz: brak dublowania kolumn przy przebudowie, ochrona przed podwójnym zapisem odpowiedzi.
 *  - Ręczne zmiany w harmonogramie synchronizują się między arkuszem zbiorczym i miesięcznym.
 *
 * V4.11 - PAMIĘĆ PODRĘCZNA:
 *  - Lista przeglądów, karta urządzeń, pracownicy i statystyki w CacheService - otwarcie z linku/QR
 *    nie czyta arkusza, dopóki nic się nie zmieniło. Czyszczone po każdym zapisie i edycji arkusza.
 *  - Rozpoznanie pracownika bez czekania na blokadę (pamięć per mail).
 *
 * V4.10 - SZYBSZE ŁADOWANIE:
 *  - Start aplikacji w jednej odpowiedzi (lista + pracownicy; po skanie QR tylko dane tej maszyny).
 *  - Lista przeglądów spakowana (spakujPrzeglady_) - kilka razy mniej danych na telefon.
 *
 * V4.9 - WYKONAWCA Z KONTA GOOGLE:
 *  - Kolumna "Email" w "6. Pracownicy" (maile przeniesione z kolumny "Rola"), dopasowanie bez polskich znaków.
 *  - Nowe konta dopisują się jako "DO ZATWIERDZENIA" i nie trafiają na listy wyboru innych osób.
 *  - Zalogowany pracownik ma pierwszeństwo przed wyborem zapamiętanym na telefonie.
 *
 * V4.8 - INTERFEJS PRZEGLĄDU NA TELEFON I LAPTOP:
 *  - FormularzMobile.html: układ 1/2/3 kolumny wg szerokości ekranu, checklista, historia maszyny obok przeglądu.
 *  - pobierzStatystykiPrzegladow(), limit w pobierzUsterkiIHistorieMaszyny(), menu: otwórz aplikację w nowej karcie.
 *  - Ucieczka danych w szablonach HTML i treści e-maili.
 */

// KONFIGURACJA GLOBALNA
var EMAIL_KIEROWNIKA = "gabriel.skubis@holcim.com";

var HARM_START = new Date(2026, 8, 18);  // 18 września 2026
var HARM_KONIEC = new Date(2026, 11, 31); // 31 grudnia 2026

var NAGLOWKI_HARM = ["ID Przeglądu", "ID Urządzenia", "Obszar", "Nazwa Urządzenia", "Częstotliwość", "Zakres Czynności", "Data Planowana", "Wykonawca", "Status", "Wynik", "Rozliczenie / Uwagi"];
var NAGLOWKI_REJESTR = ["ID Wpisu", "ID Przeglądu", "ID Urządzenia", "Obszar", "Nazwa Urządzenia", "Data Wykonania", "Wykonawca", "Czas (h)", "Wynik", "Opis prac", "Uwagi"];
var KOLOR_NAGLOWKA = "#1e40af";
var KOLORY_OBSZAROW = {
  "Suche Mieszanki": "#dbeafe",
  "Suszarnia Piachu": "#fef3c7",
  "MIXER HRB": "#ede9fe",
  "Kompresory": "#dcfce7",
  "Sprężone Powietrze": "#cffafe",
  "Rozdzielnie El.": "#fee2e2"
};

var NAGLOWKI_USTERKI = ["ID Zgłoszenia", "Data Zgłoszenia", "ID Urządzenia", "Obszar", "Nazwa Urządzenia", "Opis Usterki", "Priorytet", "Zgłaszający", "Status", "Usuwający", "Data Usunięcia", "Opis Naprawy"];

/* ==========================================================================
 *  ROZPOZNAWANIE TECHNIKA PO KONCIE GOOGLE (V4.9)
 *  Arkusz "6. Pracownicy": A Imię i nazwisko | B Aktywny | C Rola | D Uwagi | E Email
 * ========================================================================== */

var STATUS_DO_ZATWIERDZENIA = "DO ZATWIERDZENIA";

/** Porównywanie nazwisk bez polskich znaków, wielkości liter i kolejności (Jan Kowalski = kowalski jan). */
function kluczOsoby_(tekst) {
  var t = String(tekst || "").toLowerCase().replace(/ł/g, "l");
  if (t.normalize) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t.replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(String).sort().join(" ");
}

/**
 * Numer kolumny "Email" w arkuszu pracowników. Gdy jej nie ma - dodaje ją (za kolumną D)
 * i przenosi tam adresy, które wcześniejsza wersja wpisywała do kolumny C "Rola".
 */
function kolumnaEmailPracownikow_(sh) {
  var ostatnia = Math.max(4, sh.getLastColumn());
  var naglowki = sh.getRange(1, 1, 1, ostatnia).getDisplayValues()[0];
  for (var i = 0; i < naglowki.length; i++) {
    if (/^e-?mail$/i.test(String(naglowki[i]).trim())) return i + 1;
  }
  var kol = Math.max(5, sh.getLastColumn() + 1);
  sh.getRange(1, kol).setValue("Email");
  var n = sh.getLastRow() - 1;
  if (n > 0) {
    var rola = sh.getRange(2, 3, n, 1).getDisplayValues();
    var email = [], czyscRola = false;
    for (var r = 0; r < n; r++) {
      var v = String(rola[r][0]).trim();
      var toMail = v.indexOf("@") > 0 && v.indexOf(" ") < 0;
      email.push([toMail ? v.toLowerCase() : ""]);
      if (toMail) { rola[r][0] = ""; czyscRola = true; }
    }
    sh.getRange(2, kol, n, 1).setValues(email);
    if (czyscRola) sh.getRange(2, 3, n, 1).setValues(rola);
  }
  return kol;
}

/**
 * Rozpoznaje technika po mailu konta Google, na które zalogowany jest telefon/laptop.
 *  1. mail w kolumnie "Email"                          -> ta osoba
 *  2. nazwisko z maila (jan.kowalski@ -> Jan Kowalski) -> dopasowanie do kol. A bez polskich znaków
 *     i kolejności; mail zostaje dopisany do kolumny "Email"
 *  3. brak dopasowania -> nowy wiersz ze statusem "DO ZATWIERDZENIA" (nie pojawia się na listach
 *     wyboru innych osób, dopóki kierownik nie zmieni statusu na TAK)
 * Zwraca { nazwisko, status: "ok" | "oczekuje" | "nieaktywny" | "" }.
 */
function rozpoznajLubDodajPracownika_(email) {
  var wynik = { nazwisko: "", status: "" };
  var emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm) return wynik;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARKUSZ_PRACOWNICY);
  if (!sh) return wynik;
  if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 5).setValues([["Imię i nazwisko", "Aktywny", "Rola", "Uwagi", "Email"]]);

  // szybka ścieżka: ten sam mail rozpoznany niedawno (bez czytania arkusza i bez czekania na blokadę)
  var kluczCache = "cmms_os_" + wersjaPracownikow_() + "_" + emailNorm;
  try { var zc = cacheSkryptu_().get(kluczCache); if (zc) return JSON.parse(zc); } catch (eC) {}
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return wynik; }
  try {
    var r = rozpoznajPracownikaWArkuszu_(sh, emailNorm);
    try { cacheSkryptu_().put(kluczCache, JSON.stringify(r), 1800); } catch (eC2) {}
    return r;
  } finally {
    lock.releaseLock();
  }
}

function rozpoznajPracownikaWArkuszu_(sh, emailNorm) {
  {
    var kolEmail = kolumnaEmailPracownikow_(sh);
    var n = sh.getLastRow() - 1;
    var dane = n > 0 ? sh.getRange(2, 1, n, Math.max(kolEmail, 4)).getDisplayValues() : [];
    var statusWiersza = function (w) {
      var a = String(w[1]).trim().toUpperCase();
      return a === "NIE" ? "nieaktywny" : (a === STATUS_DO_ZATWIERDZENIA ? "oczekuje" : "ok");
    };

    for (var i = 0; i < dane.length; i++) {
      if (String(dane[i][kolEmail - 1]).trim().toLowerCase() === emailNorm && String(dane[i][0]).trim()) {
        return { nazwisko: String(dane[i][0]).replace(/\s+/g, " ").trim(), status: statusWiersza(dane[i]) };
      }
    }

    var lokalny = emailNorm.split("@")[0].replace(/[0-9_]+/g, " ");
    var nazwiskoZMaila = lokalny.split(/[.\-\s]+/).filter(String).map(function (cz) {
      return cz.charAt(0).toUpperCase() + cz.slice(1);
    }).join(" ");
    var klucz = kluczOsoby_(nazwiskoZMaila);

    for (var j = 0; klucz && j < dane.length; j++) {
      if (kluczOsoby_(dane[j][0]) !== klucz) continue;
      if (!String(dane[j][kolEmail - 1]).trim()) sh.getRange(j + 2, kolEmail).setValue(emailNorm);
      return { nazwisko: String(dane[j][0]).replace(/\s+/g, " ").trim(), status: statusWiersza(dane[j]) };
    }

    var wiersz = [nazwiskoZMaila || emailNorm, STATUS_DO_ZATWIERDZENIA, "",
      "Dodano automatycznie " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") +
      " po zalogowaniu – popraw imię i nazwisko, ustaw Aktywny = TAK albo NIE"];
    while (wiersz.length < kolEmail - 1) wiersz.push("");
    wiersz.push(emailNorm);
    sh.getRange(sh.getLastRow() + 1, 1, 1, wiersz.length).setValues([wiersz]);
    wyczyscCache_(["cmms_prac"]);
    return { nazwisko: wiersz[0], status: "oczekuje" };
  }
}

/**
 * Jeden interfejs rozliczania dla strony (Web App / kod QR) i dla okna w arkuszu.
 *  param  - ID urządzenia (tryb maszyny, jak po skanie QR) albo ID przeglądu "PRZ-…" (od razu otwarty)
 *  zrodlo - "telefon" (strona) albo "arkusz" (okno w arkuszu) - trafia do rozliczenia i usterki
 */
function szablonAplikacji_(param, _nieuzywany, zrodlo) {
  var template = HtmlService.createTemplateFromFile('FormularzMobile');
  template.zrodlo = zrodlo || "telefon";
  template.trybDialog = zrodlo === "arkusz";
  try {
    // Wszystko, czego strona potrzebuje na start, idzie w JEDNEJ odpowiedzi (bez dodatkowych zapytań),
    // z pamięci podręcznej (CacheService) - arkusz czytany tylko po zmianach.
    var pakiet = { v: 2, z: [], m: {}, w: [] }, wybrane = "", startMaszyny = null;
    if (param && param.indexOf("PRZ-") !== 0) {
      startMaszyny = pobierzPrzegladyMaszyny(param);
    } else {
      pakiet = daneStartowe_().lista;
      wybrane = param;
      if (wybrane && !pakiet.w.some(function (w) { return normalizujId_(w[0]) === normalizujId_(wybrane); })) {
        pakiet = spakujPrzeglady_(czytajPrzegladyDoFormularza_(wybrane));
      }
    }
    template.pobranePrzeglady = pakiet;
    template.startMaszyny = startMaszyny;
    template.pracownicy = pobierzPracownikow();
    template.wybraneId = wybrane;
    template.parametrQR = param;
    template.bladLadowania = "";

    var emailZalogowanego = "";
    var osoba = { nazwisko: "", status: "" };
    try {
      emailZalogowanego = Session.getActiveUser().getEmail() || "";
      if (emailZalogowanego) osoba = rozpoznajLubDodajPracownika_(emailZalogowanego);
    } catch (eUser) {
      Logger.log("Nie udało się rozpoznać zalogowanego pracownika: " + eUser.message);
    }
    template.zalogowanyEmail = emailZalogowanego;
    template.zalogowanyNazwisko = osoba.nazwisko;
    template.zalogowanyStatus = osoba.status;
  } catch (err) {
    Logger.log("Błąd przygotowania aplikacji: " + err.message);
    template.pobranePrzeglady = [];
    template.wybraneId = "";
    template.parametrQR = param;
    template.bladLadowania = err.message;
    template.zalogowanyEmail = "";
    template.zalogowanyNazwisko = "";
    template.zalogowanyStatus = "";
    template.startMaszyny = null;
    template.pracownicy = null;
  }
  return template;
}

function doGet(e) {
  if (e && e.parameter && e.parameter.panel === "zarzad") return doGetPanelZarzadu2_(e);
  var param = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : "";
  var template = szablonAplikacji_(param, "", "telefon");
  return template.evaluate()
      .setTitle('CMMS Holcim – Przeglądy')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Menu górne w arkuszu Google Sheets
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ CMMS System')
    .addItem('🏠 Start', 'przejdzDoStartu')
    .addItem('📅 Dziś i zaległe', 'przejdzDoWidokuDzis')
    .addItem('🖥️ Otwórz aplikację przeglądów', 'otworzAplikacjePrzegladow')
    .addItem('📝 Rozlicz przegląd w arkuszu', 'pokazFormularzPrzegladu')
    .addSeparator()
    .addItem('🎨 Odśwież wygląd arkusza', 'nowyWygladArkusza')
    .addItem('📊 Odśwież Dashboard (wykresy)', 'utworzDashboardCMMS')
    .addSeparator()
    .addSubMenu(ui.createMenu('🏭 Urządzenia i kody QR')
      .addItem('📷 Wygeneruj kody QR w karcie urządzeń', 'wygenerujKodyQRMaszyn')
      .addItem('🔍 Pokaż duży kod QR zaznaczonej maszyny', 'pokazKodQRMaszyny')
      .addItem('🖨️ Utwórz etykiety QR do druku', 'utworzEtykietyQR')
      .addSeparator()
      .addItem('🏗️ Zaktualizuj kartę urządzeń (Kraków 110 maszyn)', 'aktualizujKarteUrzadzenKrakow'))
    .addSubMenu(ui.createMenu('🗓️ Harmonogram')
      .addItem('📍 Przejdź do dzisiejszych przeglądów', 'przejdzDoDzisiaj')
      .addItem('📅 Wygeneruj harmonogram 2026 (18.09 – 31.12.2026)', 'generujHarmonogram2026')
      .addItem('🗓️ Rozbij harmonogram na arkusze miesięczne', 'generujArkuszeMiesieczne')
      .addItem('🔄 Pełna aktualizacja (urządzenia + harmonogram)', 'aktualizujCMMSKrakowFull'))
    .addSubMenu(ui.createMenu('👷 Ludzie, terminy, zarząd')
      .addItem('👷 Lista pracowników (utwórz / uporządkuj)', 'utworzArkuszPracownikow')
      .addItem('📅 Terminy UDT i kalibracji', 'utworzArkuszTerminow')
      .addItem('⏰ Włącz przypomnienia o terminach', 'instalujPrzypomnieniaTerminow')
      .addItem('📈 Link do Panelu Zarządu', 'pokazLinkPaneluZarzadu'))
    .addSubMenu(ui.createMenu('📋 Formularz Google')
      .addItem('🔄 Zaktualizuj opcje w formularzu', 'aktualizujFormularzGoogle')
      .addItem('📥 Przetwórz zaległe odpowiedzi', 'przetworzZalegleOdpowiedziFormularza')
      .addItem('⏰ Zainstaluj automatyczne wyzwalacze', 'instalujWyzwalacze')
      .addSeparator()
      .addItem('➕ Wygeneruj nowy formularz', 'stworzFormularzGoogle'))
    .addSubMenu(ui.createMenu('🛠️ Serwis i naprawa danych')
      .addItem('🧪 Diagnostyka danych (raport)', 'diagnostykaDanychCMMS')
      .addItem('⚡ Wyczyść pamięć podręczną aplikacji', 'wyczyscPamiecAplikacji')
      .addSeparator()
      .addItem('🔧 Napraw format ID urządzeń (1.10 ≠ 1.1)', 'naprawFormatIdUrzadzen')
      .addItem('🔁 Migruj stare ID przeglądów', 'migrujStareIdPrzegladow')
      .addItem('🔗 Napraw ID urządzeń w Usterkach', 'naprawUsterkiIdUrzadzen')
      .addItem('🛠️ Napraw i wyrównaj Rejestr Przeglądów', 'naprawStruktureRejestruPrzegladow')
      .addItem('🛠️ Ujednolić harmonogramy (rozdziel kolumny)', 'naprawStruktureWszystkichHarmonogramow')
      .addItem('🎨 Pełne uporządkowanie (stara wersja)', 'przygotujSrodowiskoCMMS')
      .addSeparator()
      .addItem('🧪 Przygotuj plik pilotażowy (tylko w kopii!)', 'przygotujPilotaz'))
    .addToUi();
  // plik otwiera się na zakładce Start (jeśli istnieje)
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), start = ss.getSheetByName(ARKUSZ_START);
    if (start) ss.setActiveSheet(start);
  } catch (e) {}
}

/**
 * Pomocnicza funkcja zwracająca kod miesiąca (np. "09.2026")
 */
function pobierzKodAktualnegoMiesiaca() {
  var dzisiaj = new Date();
  var mm = String(dzisiaj.getMonth() + 1).padStart(2, '0');
  var yyyy = dzisiaj.getFullYear();
  return mm + "." + yyyy;
}

/* ==========================================================================
 *  FUNKCJE POMOCNICZE (NOWE) - spójność kluczy i formatów
 * ========================================================================== */

/**
 * Zwraca true dla arkuszy będących harmonogramem ("2. Harmonogram", "Harmonogram - 09.2026").
 */
function czyArkuszHarmonogramu_(nazwa) {
  return nazwa.indexOf("Harmonogram") !== -1 || nazwa.indexOf("2.") === 0;
}

/**
 * Normalizacja ID do porównań (usuwa spacje, ujednolica wielkość liter).
 */
function normalizujId_(wartosc) {
  return String(wartosc == null ? "" : wartosc).replace(/\s+/g, "").toUpperCase();
}

/**
 * Bezpieczna zamiana ID urządzenia na tekst.
 * KLUCZOWE: Google Sheets zapisuje "1.10" jako liczbę 1,1 - dlatego ID trzymamy jako tekst,
 * a przy odczycie liczby odtwarzamy postać tekstową bez obcinania zer końcowych tam, gdzie się da.
 */
function idUrzadzeniaNaTekst_(wartosc) {
  if (wartosc === null || wartosc === undefined) return "";
  if (typeof wartosc === "number") {
    // liczba 1.1 może pochodzić z "1.1" albo ze zniekształconego "1.10" - zwracamy surową postać
    return String(wartosc);
  }
  return String(wartosc).trim();
}

/**
 * Deterministyczne, stabilne ID przeglądu: PRZ-<ID urządzenia>-<RRRRMMDD>.
 * Dzięki temu ponowne wygenerowanie harmonogramu daje DOKŁADNIE te same ID,
 * a rozliczenia i historia nie tracą powiązania.
 */
function budujIdPrzegladu_(idUrzadzenia, strDate) {
  return "PRZ-" + String(idUrzadzenia).trim() + "-" + String(strDate).replace(/-/g, "");
}

/**
 * Wymusza format tekstowy na kolumnie (chroni ID przed konwersją na liczbę).
 */
function ustawKolumneJakoTekst_(sheet, kolumna, liczbaWierszy) {
  if (liczbaWierszy < 1) return;
  sheet.getRange(2, kolumna, liczbaWierszy, 1).setNumberFormat("@");
}

/**
 * Mapa ID urządzenia -> {obszar, nazwa, czestotliwosc, zakres} z arkusza "1. Urządzenia".
 */
function pobierzMapeUrzadzen_(ss) {
  return zCache_("cmms_mapa", 1800, function () { return czytajMapeUrzadzen_(ss); });
}
function czytajMapeUrzadzen_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("1. Urządzenia");
  var mapa = {};
  if (!sheet || sheet.getLastRow() < 2) return mapa;

  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues();
  for (var i = 0; i < dane.length; i++) {
    var id = String(dane[i][0]).trim();
    if (!id) continue;
    mapa[normalizujId_(id)] = {
      id: id,
      obszar: String(dane[i][1]).trim(),
      nazwa: String(dane[i][2]).trim(),
      zakres: String(dane[i][3]).trim(),
      czestotliwosc: String(dane[i][4]).trim()
    };
  }
  return mapa;
}

/**
 * Unikalny identyfikator wpisu (zamiast losowego 5-cyfrowego, który potrafił się powtórzyć).
 */
function generujUnikalneId_(prefix) {
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMddHHmmss");
  var rnd = Math.floor(100 + Math.random() * 900);
  return prefix + "-" + ts + rnd;
}

/**
 * Tłumaczy parametr z kodu QR (ID urządzenia) na ID najpilniejszego przeglądu.
 */
function rozwinParametrQR_(param, lista) {
  if (!param) return "";
  if (param.indexOf("PRZ-") === 0) return param; // to już jest ID przeglądu

  var szukane = normalizujId_(param);
  var kandydaci = [];
  for (var i = 0; i < (lista || []).length; i++) {
    var p = lista[i];
    if (!p.czyWykonany && normalizujId_(p.idUrzadzenia) === szukane) kandydaci.push(p);
  }
  if (kandydaci.length === 0) return "";

  kandydaci.sort(function (a, b) {
    return String(a.dataPlanowana).localeCompare(String(b.dataPlanowana));
  });
  return kandydaci[0].idPrzegladu;
}

/* ==========================================================================
 *  GENEROWANIE BAZY I HARMONOGRAMU
 * ========================================================================== */

/**
 * PEŁNA AKTUALIZACJA SYSTEMU CMMS KRAKÓW
 */
function aktualizujCMMSKrakowFull() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  aktualizujKarteUrzadzenKrakow(ss);
  generujHarmonogram2026(ss);
  generujArkuszeMiesieczne(ss);
  oznaczZalegleePrzeglady();
  uporzadkujZakladki_();
  SpreadsheetApp.getUi().alert("✅ Zaktualizowano harmonogram do 31.12.2026 (weekendy i święta uwzględnione).\n\nRozliczone przeglądy zostały ZACHOWANE - ID są stabilne (PRZ-<urządzenie>-<data>).");
}
/**
 * AKTUALIZACJA KARTY URZĄDZEŃ (110 maszyn Krakowa)
 */
function aktualizujKarteUrzadzenKrakow__zapis(spreadsheetObj) {
  var ss = spreadsheetObj || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("1. Urządzenia") || ss.insertSheet("1. Urządzenia", 1); if (kartaUrzadzenMaDane_(sheet)) { formatujArkuszUrzadzen_(sheet); ss.toast("Karta urządzeń nie została nadpisana – zmiany wprowadzaj bezpośrednio w arkuszu „1. Urządzenia”.", "🏗️ CMMS", 8); return; }
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();

  var naglowki = [["ID Urządzenia", "Sekcja / Obszar", "Nazwa Urządzenia", "Zakres Czynności Przeglądowych", "Częstotliwość", "Kod QR (Skanuj)"]];

  var urzadzenia = [
    // SUCHE MIESZANKI
    ["1.1", "Suche Mieszanki", "Przenośniki ślimakowe silosa 1-9", "Kontrola wizualna (*), sprawdzenie poziomów oleju w reduktorach, stan łożysk, szczelność korpusu.", "Tydzień"],
    ["1.2", "Suche Mieszanki", "Zasuwy pneumatyczne przenośników ślimakowych 1-9", "Sprawdzenie szczelności pneumatyki, sprawności siłowników i zaworów rozdzielających.", "Tydzień"],
    ["1.3", "Suche Mieszanki", "Waga popiołu", "Kontrola wizualna (*), sztywność śrub, stan połączeń elastycznych, czyszczenie wnętrza, kalibracja wag.", "Miesiąc"],
    ["1.4", "Suche Mieszanki", "Zasuwy wagi popiołu", "Kontrola szczelności połączeń elastycznych i działania siłowników otwarcia/zamknięcia.", "Tydzień"],
    ["1.5", "Suche Mieszanki", "Waga cementu", "Kontrola wizualna (*), sztywność śrub mocujących, stan połączeń elastycznych, czyszczenie wnętrza, kalibracja.", "Miesiąc"],
    ["1.6", "Suche Mieszanki", "Zasuwy wagi cementu", "Sprawdzenie stanu uszczelnień i działania napędu pneumatycznego.", "Tydzień"],
    ["1.7", "Suche Mieszanki", "Waga włókien", "Kontrola wizualna (*), sztywność śrub, czyszczenie wnętrza i weryfikacja czujników tensometrycznych.", "Miesiąc"],
    ["1.8", "Suche Mieszanki", "Zasuwa pod wagą włókien", "Sprawdzenie płynności ruchu, braku zacięć oraz szczelności w pozycji zamkniętej.", "Tydzień"],
    ["1.9", "Suche Mieszanki", "Mieszalnik", "Kontrola śrub, stan sprzęgła i osłon, temp. łożysk, brak wycieków, kontrola krańcówki.", "Tydzień"],
    ["1.10", "Suche Mieszanki", "Klapa zrzutowa mieszalnika", "Kontrola krańcówki pozycji, szczelności dolegania uszczelek oraz ciśnienia siłownika.", "Tydzień"],
    ["1.11", "Suche Mieszanki", "Zasuwa dozująca nad pakowaczką A", "Kontrola szczelności dolotów, sprawności siłowników pneumatycznych i zużycia płyt.", "Tydzień"],
    ["1.12", "Suche Mieszanki", "Pakowaczka A", "Kontrola wizualna (*), spuszczenie kondensatu z osuszaczy (4 szt.), sprawdzanie wyłączników awaryjnych.", "Codzienny"],
    ["1.13", "Suche Mieszanki", "Zasuwa dozująca nad pakowaczką B", "Kontrola szczelności dolotów, sprawności siłowników pneumatycznych i zużycia płyt.", "Tydzień"],
    ["1.14", "Suche Mieszanki", "Pakowaczka B", "Kontrola wizualna (*), spuszczenie kondensatu z osuszaczy (4 szt.), sprawdzanie wyłączników awaryjnych.", "Codzienny"],
    ["1.15", "Suche Mieszanki", "Zasuwa dozująca nad pakowaczką C", "Kontrola szczelności dolotów, sprawności siłowników pneumatycznych i zużycia płyt.", "Tydzień"],
    ["1.16", "Suche Mieszanki", "Pakowaczka C", "Kontrola wizualna (*), spuszczenie kondensatu z osuszaczy (4 szt.), sprawdzanie wyłączników awaryjnych.", "Codzienny"],
    ["1.17", "Suche Mieszanki", "Taśmociąg łańcuchowy pod pakowaczką", "Oczyszczenie terenu z materiału sypkiego, stan ogniw łańcucha, napięcie i smarowanie napędu.", "Tydzień"],
    ["1.18", "Suche Mieszanki", "Przenośniki ślimakowe zbierające pod taśmociągiem", "Kontrola poziomu oleju w przekładniach, czyszczenie koryt oraz kontrola piór ślimaka.", "Tydzień"],
    ["1.19", "Suche Mieszanki", "Elewator powrotny materiału", "Przesmarowanie punktów smarnych, sprawdzanie napięcia pasa/łańcucha, stan kubełków i przekładni.", "Tydzień"],
    ["1.20", "Suche Mieszanki", "Przenośnik ślimakowy elewatora powrotnego", "Smarowanie łożysk podporowych, kontrola obudowy pod kątem przetarć i głośności pracy.", "Tydzień"],
    ["1.21", "Suche Mieszanki", "Przenośnik taśmowy za pakowaczką", "Oczyszczenie terenu z materiału, bieg taśmy (luz/obciążenie), stan rolek, bębnów i osłon.", "Tydzień"],
    ["1.22", "Suche Mieszanki", "Dociskacz worków na przenośniku taśmowym", "Sprawdzenie zużycia rolki dociskowej, regulacja siły docisku oraz stanu osłon.", "Tydzień"],
    ["1.23", "Suche Mieszanki", "Przenośniki taśmowe paletyzera 1,2,3", "Kompletnie smarowanie łożysk i przegubów, kontrola naciągu pasów i przekładni.", "Miesiąc"],
    ["1.24", "Suche Mieszanki", "Separator worków", "Sprawdzenie stanu elementów rozdzielających, smarowanie prowadnic i kontrola napędu.", "Miesiąc"],
    ["1.25", "Suche Mieszanki", "Rozdzielacz worków", "Weryfikacja geometrii i ruchu ramienia rozdzielającego oraz sprawności siłowników.", "Miesiąc"],
    ["1.26", "Suche Mieszanki", "Łopata rozdzielacza", "Kontrola stanu powierzchni roboczej łopaty, dokręcenie mocowań i sprawdzenie amortyzacji.", "Miesiąc"],
    ["1.27", "Suche Mieszanki", "Stół odbiorczy", "Czyszczenie rolkowej powierzchni stołu, sprawdzanie stanu łożysk i napędów rolkowych.", "Miesiąc"],
    ["1.28", "Suche Mieszanki", "Przesuwacz worków otwierany", "Smarowanie mechanizmu przesuwu, kontrola czujników krańcowych oraz elementów gumowych.", "Miesiąc"],
    ["1.29", "Suche Mieszanki", "Poprzeczny dociskacz worków", "Weryfikacja siły docisku, stanu powierzchni dociskowych oraz geometrii ustawienia.", "Miesiąc"],
    ["1.30", "Suche Mieszanki", "Stół obrotowy", "Smarowanie wieńca obrotu, kontrola poziomu oleju w przekładni oraz wyłączników krańcowych.", "Miesiąc"],
    ["1.31", "Suche Mieszanki", "Stół palet", "Kontrola podnośnika stołu, szczelności układu hydraulicznego/pneumatycznego i czujników.", "Miesiąc"],
    ["1.32", "Suche Mieszanki", "Separator folii", "Weryfikacja noży i chwytaków folii, czyszczenie oraz smarowanie mechanizmów pomocniczych.", "Miesiąc"],
    ["1.33", "Suche Mieszanki", "Aplikator", "Kontrola czujników optycznych, napędu podawania folii oraz prawidłowości nakładania.", "Miesiąc"],
    ["1.34", "Suche Mieszanki", "Koziołek przesuwający puste palety", "Smarowanie łożysk i łańcuchów, sprawność podajnika pustych palet i czujników obecności.", "Miesiąc"],
    ["1.35", "Suche Mieszanki", "Przenośnik rolkowy za paletyzerem", "Kontrola rolek, łańcuchów napędowych, smarowanie i sprawdzenie osłon osi.", "Miesiąc"],
    ["1.36", "Suche Mieszanki", "Przenośnik rolkowy pod centrownikiem palet", "Czyszczenie ramy, kontrola łożysk rolek oraz napędu sekcji centrowania.", "Miesiąc"],
    ["1.37", "Suche Mieszanki", "Centrownik palet", "Smarowanie ramion centrujących, kontrola siłowników i symetrii zacisku palety.", "Miesiąc"],
    ["1.38", "Suche Mieszanki", "Przenośnik rolkowy pod foliomatem", "Kontrola czystości rolkowiska, naciągu łańcuchów napędowych oraz przekładni.", "Miesiąc"],
    ["1.39", "Suche Mieszanki", "Rama foliomatu", "Kontrola połączeń śrubowych konstrukcji, prowadnic pionowych oraz stanu kabli w prowadnikach.", "Miesiąc"],
    ["1.40", "Suche Mieszanki", "Stół podnośny foliomatu", "Sprawdzenie czujników wysokości, naciągu pasów/łańcuchów podnoszenia i hamulca.", "Miesiąc"],
    ["1.41", "Suche Mieszanki", "Napęd rolki folii", "Smarowanie łożysk wałów odwijacza, kontrola naciągu folii i silnika napędowego.", "Miesiąc"],
    ["1.42", "Suche Mieszanki", "System zgrzewania i cięcia folii", "Czyszczenie i kontrola stanu grzałek, noża tnącego, taśm teflonowych i docisków.", "Miesiąc"],
    ["1.43", "Suche Mieszanki", "Przenośnik rolkowy za foliomatem", "Kontrola stanu rolek odbiorczych, czujników opuszczenia strefy i napędu rolkowego.", "Miesiąc"],
    ["1.44", "Suche Mieszanki", "Poprzeczny wózek palet", "Przegląd kół jezdnych, torowiska, smarowanie łożysk i weryfikacja zasilania wózka.", "Miesiąc"],
    ["1.45", "Suche Mieszanki", "Wózek parujący palety", "Sprawdzenie mechanizmu parowania palet, czujników pozycjonowania i osłon ochronnych.", "Miesiąc"],
    ["1.46", "Suche Mieszanki", "Przenośniki rolkowe odbioru palet", "Smarowanie łożysk, sprawdzanie połączeń śrubowych, osłon i poprawności zatrzymania.", "Miesiąc"],
    ["1.47", "Suche Mieszanki", "Odpylacz pakowaczki", "Oczyszczenie filtrów, kontrola zaworów elektropneumatycznych strzepujących, spuszczenie skroplin.", "Miesiąc"],
    ["1.48", "Suche Mieszanki", "Odpylacze na silosach 1-9", "Sprawdzenie stanu filtrów, czyszczenia automatycznego, zaworów bezpieczeństwa i czujników.", "Miesiąc"],

    // SUSZARNIA PIACHU
    ["2.1", "Suszarnia Piachu", "Zbiornik zasypowy suszarni", "Sprawdzenie stanu kraty zasypowej, zużycia wykładzin trudnościeralnych i drożności.", "Tydzień"],
    ["2.2", "Suszarnia Piachu", "Przenośniki taśmowe piachu", "Oczyszczenie terenu, sprawdzenie biegu taśmy, stanu rolek, bębnów, osłon i skrobaków.", "Tydzień"],
    ["2.3", "Suszarnia Piachu", "Palnik", "Monitoring parametrów spalania, ciśnienia paliwa/powietrza, czujnika płomienia i automatyki.", "Codzienny"],
    ["2.4", "Suszarnia Piachu", "Bęben suszarni", "Smarowanie kredek/rolców podtrzymujących, kontrola zużycia wieńca, przekładni i uszczelnień.", "Tydzień"],
    ["2.5", "Suszarnia Piachu", "Wibrator rynny zsypowej piachu", "Sprawdzenie dokręcenia śrub mocujących elektroprzekładnika i stanu amortyzatorów.", "Tydzień"],
    ["2.6", "Suszarnia Piachu", "Elewator BE-1", "Przesmarowanie punktów smarnych, kontrola naciągu pasa, stanu kubełków, pokryw i motoreduktora.", "Tydzień"],
    ["2.7", "Suszarnia Piachu", "Przesiewacz wstępny", "Kontrola stanu sit (brak pęknięć/zapchania), mocowań zawieszenia sprężystego i amortyzatorów.", "Tydzień"],
    ["2.8", "Suszarnia Piachu", "Wentylator odpylacza suszarni", "Kontrola drgań, temperatury łożysk, stanu pasków klinowych i czystości łopatek wirnika.", "Tydzień"],
    ["2.9", "Suszarnia Piachu", "Odpylacz Suszarni", "Sprawdzenie i czyszczenie filtrów, kontrola układu impulsowego otrzepywania i śluzy.", "Miesiąc"],
    ["2.10", "Suszarnia Piachu", "Przenośnik ślimakowy piachu", "Kontrola poziomu oleju w reduktorze, stan łożysk podporowych i zużycia piór ślimaka.", "Tydzień"],
    ["2.11", "Suszarnia Piachu", "Elewator BE-2", "Smarowanie łożysk głowicy i stopy, kontrola naciągu pasa, połączeń kubełków i obudowy.", "Tydzień"],
    ["2.12", "Suszarnia Piachu", "Przesiewacz rozdrabniający", "Kontrola połączeń śrubowych, stanu elementów rozdrabniających, sit oraz amortyzatorów.", "Tydzień"],
    ["2.13", "Suszarnia Piachu", "Przesiewacz separujący frakcje", "Kontrola czystości i naciągu sit dla poszczególnych frakcji, uszczelnień pokryw i napędu.", "Tydzień"],

    // MIXER HRB
    ["3.1", "MIXER HRB", "Zasuwy i rynny aeracyjne pod silosem popiołu V", "Sprawdzenie szczelności tkaniny aeracyjnej, ciśnienia dmuchu, siłowników i zasuw.", "Tydzień"],
    ["3.2", "MIXER HRB", "Zasuwy i rynny aeracyjne pod silosem Cementu", "Sprawdzenie szczelności tkaniny aeracyjnej, ciśnienia dmuchu, siłowników i zasuw.", "Tydzień"],
    ["3.3", "MIXER HRB", "Zasuwy i rynny aeracyjne pod silosem popiołu W", "Sprawdzenie szczelności tkaniny aeracyjnej, ciśnienia dmuchu, siłowników i zasuw.", "Tydzień"],
    ["3.4", "MIXER HRB", "Elewator popiołu V", "Przesmarowanie punktów smarnych, sprawdzenie naciągu pasa, stanu kubełków i przekładni.", "Tydzień"],
    ["3.5", "MIXER HRB", "Zbiornik buforowy wagi popiołu V", "Kontrola szczelności połączeń elastycznych, czyszczenie ścianek wewnętrznych i odpowietrzników.", "Miesiąc"],
    ["3.6", "MIXER HRB", "Waga popiołu V", "Kontrola wizualna (*), sztywność zawieszenia, czyszczenie, weryfikacja i kalibracja tensometrów.", "Miesiąc"],
    ["3.7", "MIXER HRB", "Elewator popiołu W", "Przesmarowanie punktów smarnych, sprawdzenie naciągu pasa, stanu kubełków i przekładni.", "Tydzień"],
    ["3.8", "MIXER HRB", "Zbiornik buforowy wagi popiołu W", "Kontrola szczelności połączeń elastycznych, czyszczenie ścianek wewnętrznych i odpowietrzników.", "Miesiąc"],
    ["3.9", "MIXER HRB", "Waga popiołu W", "Kontrola wizualna (*), sztywność zawieszenia, czyszczenie, weryfikacja i kalibracja tensometrów.", "Miesiąc"],
    ["3.10", "MIXER HRB", "Elewator cementu", "Przesmarowanie punktów smarnych, sprawdzenie naciągu pasa, stanu kubełków i przekładni.", "Tydzień"],
    ["3.11", "MIXER HRB", "Zbiornik buforowy cementu", "Kontrola szczelności połączeń elastycznych, czyszczenie ścianek wewnętrznych i odpowietrzników.", "Miesiąc"],
    ["3.12", "MIXER HRB", "Waga cementu", "Kontrola wizualna (*), sztywność zawieszenia, czyszczenie, weryfikacja i kalibracja tensometrów.", "Miesiąc"],
    ["3.13", "MIXER HRB", "Rynny aeracyjne mieszalnika", "Kontrola szczelności rurociągów zasilających i tkaniny aeracyjnej wewnątrz rynien.", "Tydzień"],
    ["3.14", "MIXER HRB", "Elewator główny mieszalnika", "Smarowanie łożysk głowicy, naciąg pasa nośnego, połączeń kubełków i sprzęgła napędu.", "Tydzień"],
    ["3.15", "MIXER HRB", "Rynna rozdzielająca materiał", "Sprawdzenie zużycia pancerzy wewnętrznych, przestawiania klap kierunkowych i szczelności.", "Tydzień"],
    ["3.16", "MIXER HRB", "Zasuwy odcinające do silosa: 1,2,4,6,8", "Sprawdzenie płynności pracy napędów pneumatycznych, czujników położenia i uszczelek.", "Tydzień"],
    ["3.17", "MIXER HRB", "Rynny aeracyjne do silosów: 1,2,4,6,8", "Kontrola ciśnienia powietrza wspomagającego, drożności i szczelności połączeń.", "Tydzień"],
    ["3.18", "MIXER HRB", "Odpylacz DC-10", "Sprawdzenie i oczyszczenie wkładów filtracyjnych, kontrola zaworów strzepujących i wentylatora.", "Miesiąc"],
    ["3.19", "MIXER HRB", "Odpylacz DC-20", "Sprawdzenie i oczyszczenie wkładów filtracyjnych, kontrola zaworów strzepujących i wentylatora.", "Miesiąc"],

    // KOMPRESORY
    ["4.1", "Kompresory", "Kompresor HERMA", "Monitoring temperatury i ciśnienia, kontrola poziomu oleju, czyszczenie filtrów ssących.", "Codzienny"],
    ["4.2", "Kompresory", "Kompresor BOGE S150 x2", "Monitoring temperatury i ciśnienia, kontrola poziomu oleju, czyszczenie filtrów ssących.", "Codzienny"],
    ["4.3", "Kompresory", "Osuszacz ciśnienia wysokiego", "Sprawdzenie punktu rosy, automatycznego odprowadzania kondensatu, czystości skraplacza.", "Codzienny"],
    ["4.4", "Kompresory", "Kompresor BOGE S101 x2", "Monitoring temperatury i ciśnienia, kontrola poziomu oleju, czyszczenie filtrów ssących.", "Codzienny"],
    ["4.5", "Kompresory", "Osuszacz ciśnienia niskiego", "Sprawdzenie punktu rosy, automatycznego odprowadzania kondensatu, czystości skraplacza.", "Codzienny"],
    ["4.6", "Kompresory", "Kompresor BOGE S-60", "Monitoring temperatury i ciśnienia, kontrola poziomu oleju, czyszczenie filtrów ssących.", "Codzienny"],
    ["4.7", "Kompresory", "Kompresor KEASER", "Monitoring temperatury i ciśnienia, kontrola poziomu oleju, czyszczenie filtrów ssących.", "Codzienny"],
    ["4.8", "Kompresory", "Dmuchawa ROBUSHI (tunel)", "Kontrola poziomu oleju w przekładniach, naciągu pasków klinowych, filtrów i zaworów.", "Tydzień"],
    ["4.9", "Kompresory", "Dmuchawa ROBUSHI (zapasowa)", "Kontrola poziomu oleju w przekładniach, naciągu pasków klinowych, filtrów i zaworów.", "Tydzień"],
    ["4.10", "Kompresory", "Dmuchawa ARZEN", "Kontrola poziomu oleju w przekładniach, naciągu pasków klinowych, filtrów i zaworów.", "Tydzień"],
    ["4.11", "Kompresory", "Kompresory pakowaczek: A,B,C", "Kontrola ciśnienia roboczego, stanu osuszaczy lokalnych, spuszczanie kondensatu i oleju.", "Codzienny"],

    // SPRĘŻONE POWIETRZE
    ["5.1", "Sprężone Powietrze", "Zbiorniki ciśnieniowe kompresorownia", "Spuszczanie kondensatu ze zbiorników, kontrola manometrów, zaworów bezpieczeństwa i UDT.", "Codzienny"],
    ["5.2", "Sprężone Powietrze", "Zbiorniki ciśnieniowe magazyn worków", "Spuszczanie kondensatu ze zbiorników, kontrola manometrów, zaworów bezpieczeństwa i UDT.", "Codzienny"],
    ["5.3", "Sprężone Powietrze", "Rurociąg zasilający sterowanie MIXER HRB", "Sprawdzenie szczelności połączeń, stanu filtrów-odwadniaczy i reduktorów ciśnienia.", "Miesiąc"],
    ["5.4", "Sprężone Powietrze", "Rurociąg zasilający podmuch rynien aeracyjnych HRB", "Kontrola szczelności instalacji rurowej, zaworów odcinających i parametrów ciśnienia.", "Miesiąc"],
    ["5.5", "Sprężone Powietrze", "Rurociąg rozładunku", "Kontrola stanu złączy przeładunkowych, zaworów klapowych oraz szczelności pod ciśnieniem.", "Miesiąc"],
    ["5.6", "Sprężone Powietrze", "Rurociąg załadunku zasypy", "Kontrola stanu złączy przeładunkowych, zaworów klapowych oraz szczelności pod ciśnieniem.", "Miesiąc"],
    ["5.7", "Sprężone Powietrze", "Rurociąg zasilający suche mieszanki", "Sprawdzenie szczelności głównej magistrali zasilającej, punktów odwadniania i zaworów.", "Miesiąc"],
    ["5.8", "Sprężone Powietrze", "Rurociąg zasilający aerację silosów 1-8 HRB", "Kontrola rozdzielaczy powietrza, zaworów elektromagnetycznych i szczelności przewodów.", "Miesiąc"],

    // ROZDZIELNIE ELEKTRYCZNE
    ["6.1", "Rozdzielnie El.", "Podstacja ST-1", "Kontrola wizualna szaf, pirometr/termowizja połączeń, czyszczenie filtrów wentylacji.", "Tydzień"],
    ["6.2", "Rozdzielnie El.", "Podstacja ST-2", "Kontrola wizualna szaf, pirometr/termowizja połączeń, czyszczenie filtrów wentylacji.", "Tydzień"],
    ["6.3", "Rozdzielnie El.", "Rozdzielnia główna biurowiec", "Kontrola stanu obudów, zamknięć, kontrolek sygnalizacyjnych oraz czystości wnętrza.", "Tydzień"],
    ["6.4", "Rozdzielnie El.", "Rozdzielnia główna warsztat", "Kontrola stanu obudów, zamknięć, kontrolek sygnalizacyjnych oraz czystości wnętrza.", "Tydzień"],
    ["6.5", "Rozdzielnie El.", "Rozdzielnia paletyzera", "Oczyszczenie filtrów wentylatorów szaf, połączeń śrubowych i wyłączników głównych.", "Tydzień"],
    ["6.6", "Rozdzielnie El.", "Rozdzielnia foliomatu", "Oczyszczenie filtrów wentylatorów szaf, połączeń śrubowych i wyłączników głównych.", "Tydzień"],
    ["6.7", "Rozdzielnie El.", "Rozdzielnia główna pakowaczek", "Oczyszczenie filtrów wentylatorów szaf, połączeń śrubowych i wyłączników głównych.", "Tydzień"],
    ["6.8", "Rozdzielnie El.", "Rozdzielnia główna suchych mieszanek", "Sprawdzenie stanu styczników, przekaźników, aparatury oraz dokręcenia zacisków.", "Tydzień"],
    ["6.9", "Rozdzielnie El.", "Rozdzielnia główna MIXER HRB", "Sprawdzenie stanu styczników, przekaźników, aparatury oraz dokręcenia zacisków.", "Tydzień"],
    ["6.10", "Rozdzielnie El.", "Rozdzielnia zasypu: 1,2,4,6,8", "Sprawdzenie stanu styczników, przekaźników, aparatury oraz dokręcenia zacisków.", "Tydzień"],
    ["6.11", "Rozdzielnie El.", "Rozdzielnia kasetowa paletyzernia", "Kontrola zamocowania kaset zasilających, styków pomocniczych i drożności wentylacji.", "Tydzień"]
  ];

  sheet.getRange(1, 1, 1, 6).setValues(naglowki);

  // KRYTYCZNE: kolumna A musi być TEKSTEM, inaczej "1.10" zamienia się w liczbę 1,1
  // i skleja się z "1.1" (tak powstało 8 zduplikowanych ID w obecnym arkuszu).
  sheet.getRange(2, 1, urzadzenia.length, 1).setNumberFormat("@");

  var tableData = [];
  var targetUrl = ScriptApp.getService().getUrl() || ss.getFormUrl() || "https://script.google.com";

  for (var i = 0; i < urzadzenia.length; i++) {
    var u = urzadzenia[i];
    var link = targetUrl + (targetUrl.indexOf('?') > -1 ? '&' : '?') + "id=" + encodeURIComponent(u[0]);
    var qrFormula = '=IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(link) + '", 4, 70, 70)';
    tableData.push([u[0], u[1], u[2], u[3], u[4], qrFormula]);
  }

  sheet.getRange(2, 1, tableData.length, 6).setValues(tableData);

  formatujArkuszUrzadzen_(sheet);
}/**
 * GENEROWANIE HARMONOGRAMU 2026 - WERSJA NIENISZCZĄCA
 *
 * Największa zmiana w całym systemie: ID przeglądu nie jest już licznikiem od 1,
 * tylko kluczem PRZ-<ID urządzenia>-<RRRRMMDD>. Dzięki temu:
 *  - ponowne uruchomienie nie przenumerowuje przeglądów,
 *  - rozliczone wpisy (Wykonawca/Status/Wynik/Uwagi) są odczytywane przed czyszczeniem
 *    arkusza i przywracane na te same przeglądy,
 *  - Rejestr Przeglądów nie traci powiązania z harmonogramem.
 */
function generujHarmonogram2026(spreadsheetObj) {
  var ss = spreadsheetObj || SpreadsheetApp.getActiveSpreadsheet();
  return generujHarmonogramV2_(spreadsheetObj); var dataStart = new Date(HARM_START.getTime());
  var dataKoniec = new Date(HARM_KONIEC.getTime());

  var sheetUrz = ss.getSheetByName("1. Urządzenia");
  if (!sheetUrz || sheetUrz.getLastRow() < 2) return;

  // getDisplayValues - czytamy ID dokładnie tak, jak widzi je użytkownik (bez konwersji na liczbę)
  var urzData = sheetUrz.getRange(2, 1, sheetUrz.getLastRow() - 1, 5).getDisplayValues();

  var sheetHarm = ss.getSheetByName("2. Harmonogram") || ss.insertSheet("2. Harmonogram", 2);

  // 1) ZAPAMIĘTAJ ISTNIEJĄCE ROZLICZENIA (kolumny H, I, J, K) - ze WSZYSTKICH harmonogramów
  var zapamietane = pobierzRozliczeniaZHarmonogramow_(ss);

  // 2) ZBUDUJ NOWY HARMONOGRAM
  var harmonogramRows = [];
  var uzyteId = {};

  for (var d = new Date(dataStart); d <= dataKoniec; d.setDate(d.getDate() + 1)) {
    var strDate = Utilities.formatDate(d, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
    var dayOfWeek = d.getDay();
    var dayOfMonth = d.getDate();

    for (var u = 0; u < urzData.length; u++) {
      var idUrz = String(urzData[u][0]).trim();
      if (!idUrz) continue;

      var obszar = String(urzData[u][1]).trim();
      var nazwa = String(urzData[u][2]).trim();
      var zakres = String(urzData[u][3]).trim();
      var czestotliwosc = String(urzData[u][4]).trim();

      var czyPlanowac = false;

      if (czestotliwosc === "Codzienny" || czestotliwosc === "Codzienna") {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) czyPlanowac = true;
      } else if (czestotliwosc === "Tydzień" || czestotliwosc === "Tygodniowa") {
        if (dayOfWeek === 2) czyPlanowac = true;
      } else if (czestotliwosc.indexOf("Miesiąc") === 0 || czestotliwosc.indexOf("Miesięczna") === 0) {
        if (strDate === Utilities.formatDate(dataStart, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd") || dayOfMonth === 1) czyPlanowac = true;
      }

      if (!czyPlanowac) continue;

      var idPrzegladu = budujIdPrzegladu_(idUrz, strDate);
      if (uzyteId[idPrzegladu]) continue; // zabezpieczenie przed duplikatem klucza
      uzyteId[idPrzegladu] = true;

      var zapis = zapamietane[normalizujId_(idPrzegladu)] || null;

      harmonogramRows.push([
        idPrzegladu,
        idUrz,
        obszar,
        nazwa,
        czestotliwosc,
        zakres,
        strDate,
        zapis ? zapis.wykonawca : "",
        zapis ? zapis.status : "Zaplanowany",
        zapis ? zapis.wynik : "-",
        zapis ? zapis.rozliczenie : ""
      ]);
    }
  }

  // 3) ZAPIS
  sheetHarm.clear();

  sheetHarm.getRange(1, 1, 1, 11).setValues([NAGLOWKI_HARM]);
  if (harmonogramRows.length > 0) {
    // ID jako tekst - tak samo jak w karcie urządzeń
    sheetHarm.getRange(2, 1, harmonogramRows.length, 2).setNumberFormat("@");
    sheetHarm.getRange(2, 1, harmonogramRows.length, 11).setValues(harmonogramRows);
  }

  uwzglednijSwieta_(sheetHarm); formatujArkuszHarmonogramu(sheetHarm);
  Logger.log("Harmonogram: " + harmonogramRows.length + " pozycji, przywrócono rozliczeń: " + Object.keys(zapamietane).length);
}

/**
 * Odczytuje wszystkie już rozliczone pozycje ze wszystkich arkuszy harmonogramu.
 * Klucz: znormalizowane ID przeglądu.
 */
function pobierzRozliczeniaZHarmonogramow_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var mapa = {};
  var sheets = ss.getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (!czyArkuszHarmonogramu_(sheet.getName())) continue;
    if (sheet.getLastRow() < 2) continue;

    var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getDisplayValues();
    for (var i = 0; i < dane.length; i++) {
      var id = String(dane[i][0]).trim();
      if (!id) continue;

      var status = String(dane[i][8] || "").trim();
      var wykonawca = String(dane[i][7] || "").trim();
      var rozliczenie = String(dane[i][10] || "").trim();

      // interesują nas tylko wiersze, w których ktoś coś wprowadził
      if (!wykonawca && !rozliczenie && status.toLowerCase() !== "wykonany") continue;

      mapa[normalizujId_(id)] = {
        wykonawca: wykonawca,
        status: status || "Zaplanowany",
        wynik: String(dane[i][9] || "-").trim(),
        rozliczenie: rozliczenie
      };
    }
  }
  return mapa;
}

/**
 * ROZBICIE HARMONOGRAMU NA ARKUSZE MIESIĘCZNE ("Harmonogram - 09.2026")
 *
 * Funkcja mobilna getListaPrzegladow() szuka arkusza o takiej nazwie, ale nic go nie tworzyło.
 * Arkusze są odtwarzane z "2. Harmonogram", więc rozliczenia pozostają spójne.
 */
function generujArkuszeMiesieczne__zapis(spreadsheetObj) {
  var ss = spreadsheetObj || SpreadsheetApp.getActiveSpreadsheet();
  var zrodlo = ss.getSheetByName("2. Harmonogram");
  if (!zrodlo || zrodlo.getLastRow() < 2) return;

  var dane = zrodlo.getRange(2, 1, zrodlo.getLastRow() - 1, 11).getDisplayValues();
  var wgMiesiaca = {};

  for (var i = 0; i < dane.length; i++) {
    var dataStr = String(dane[i][6] || "").trim();
    if (dataStr.length < 7) continue;
    var kod = dataStr.substring(5, 7) + "." + dataStr.substring(0, 4); // MM.RRRR
    if (!wgMiesiaca[kod]) wgMiesiaca[kod] = [];
    wgMiesiaca[kod].push(dane[i]);
  }

  Object.keys(wgMiesiaca).forEach(function (kod) {
    var nazwa = "Harmonogram - " + kod;
    var sheet = ss.getSheetByName(nazwa) || ss.insertSheet(nazwa);
    sheet.clear();
    sheet.getRange(1, 1, 1, 11).setValues([NAGLOWKI_HARM]);

    var rows = wgMiesiaca[kod];
    sheet.getRange(2, 1, rows.length, 2).setNumberFormat("@");
    sheet.getRange(2, 1, rows.length, 11).setValues(rows);
    formatujArkuszHarmonogramu(sheet);
  });
}

/**
 * ELEGANCKIE I INTUICYJNE FORMATOWANIE ARKUSZY HARMONOGRAMÓW
 */
function formatujArkuszHarmonogramuV4_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(1, 1, Math.max(lastRow, 2), 11).clearDataValidations();

  sheet.getRange(1, 1, 1, 11).setValues([NAGLOWKI_HARM])
       .setFontWeight("bold").setFontSize(10)
       .setBackground(KOLOR_NAGLOWKA).setFontColor("#ffffff")
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  if (lastRow >= 2) {
    var n = lastRow - 1;
    var range = sheet.getRange(2, 1, n, 11);

    range.setVerticalAlignment("middle").setFontSize(10).setFontColor("#0f172a").setFontWeight("normal").setFontStyle("normal");

    // ID jako tekst; ID przeglądu mniejszą, szarą czcionką - to klucz techniczny, nie informacja dla technika
    sheet.getRange(2, 1, n, 2).setNumberFormat("@").setHorizontalAlignment("center");
    sheet.getRange(2, 1, n, 1).setFontSize(8).setFontColor("#64748b");
    sheet.getRange(2, 2, n, 1).setFontWeight("bold");
    sheet.getRange(2, 3, n, 1).setHorizontalAlignment("left");
    sheet.getRange(2, 4, n, 1).setHorizontalAlignment("left").setFontWeight("bold").setWrap(true);
    sheet.getRange(2, 5, n, 1).setHorizontalAlignment("center");
    sheet.getRange(2, 6, n, 1).setHorizontalAlignment("left").setWrap(true).setFontSize(9).setFontColor("#334155");
    sheet.getRange(2, 7, n, 1).setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center").setFontWeight("bold");
    sheet.getRange(2, 8, n, 1).setHorizontalAlignment("left");
    sheet.getRange(2, 9, n, 2).setHorizontalAlignment("center").setFontWeight("bold");
    sheet.getRange(2, 11, n, 1).setHorizontalAlignment("left").setWrap(true).setFontSize(9);

    // Walidacje (listy rozwijane)
    var ruleStatus = SpreadsheetApp.newDataValidation()
      .requireValueInList(["Zaplanowany", "Wykonany", "Zaległy"], true)
      .setAllowInvalid(true).build();
    sheet.getRange(2, 9, n, 1).setDataValidation(ruleStatus);

    var ruleWynik = SpreadsheetApp.newDataValidation()
      .requireValueInList(["OK", "NOK", "-"], true)
      .setAllowInvalid(true).build();
    sheet.getRange(2, 10, n, 1).setDataValidation(ruleWynik);

    // PASY DZIENNE zamiast pasków zebry: wszystkie przeglądy z jednego dnia mają to samo tło,
    // więc od razu widać, gdzie kończy się jeden dzień, a zaczyna kolejny.
    var daty = sheet.getRange(2, 7, n, 1).getDisplayValues();
    var tla = [];
    var poprzednia = null;
    var jasny = true;
    for (var r = 0; r < n; r++) {
      if (daty[r][0] !== poprzednia) { jasny = !jasny; poprzednia = daty[r][0]; }
      var k = jasny ? "#eef2f7" : "#ffffff";
      tla.push([k, k, k, k, k, k, k, k, k, k, k]);
    }
    range.setBackgrounds(tla);
    range.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);

    // FORMATOWANIE WARUNKOWE - działa na bieżąco, bez uruchamiania skryptu
    sheet.clearConditionalFormatRules();

    var rI = sheet.getRange(2, 9, n, 1);
    var rJ = sheet.getRange(2, 10, n, 1);
    var rG = sheet.getRange(2, 7, n, 1);
    var rAH = sheet.getRange(2, 1, n, 8);
    var dataG = 'IFERROR(DATEVALUE($G2),$G2)';

    var reguly = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$I2="Wykonany"')
        .setBackground("#d1fae5").setFontColor("#065f46").setBold(true)
        .setRanges([rI]).build(),
      // Po terminie i niewykonany -> czerwony status i czerwona data (niezależnie od nocnego wyzwalacza)
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + dataG + '<TODAY(),$I2<>"Wykonany")')
        .setBackground("#fee2e2").setFontColor("#991b1b").setBold(true)
        .setRanges([rI, rG]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("Zaplanowany")
        .setBackground("#dbeafe").setFontColor("#1e40af")
        .setRanges([rI]).build(),
      // Wykonane - wiersz wyszarzony, żeby nie odciągał uwagi
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$I2="Wykonany"')
        .setFontColor("#94a3b8")
        .setRanges([rAH]).build(),
      // Dzisiejsze przeglądy - żółte podświetlenie
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=' + dataG + '=TODAY()')
        .setBackground("#fef9c3")
        .setRanges([rAH]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("OK")
        .setBackground("#d1fae5").setFontColor("#065f46").setBold(true)
        .setRanges([rJ]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo("NOK")
        .setBackground("#fee2e2").setFontColor("#991b1b").setBold(true)
        .setRanges([rJ]).build()
    ];
    sheet.setConditionalFormatRules(reguly);
  }

  sheet.setFrozenColumns(4);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 190);
  sheet.setColumnWidth(5, 85);
  sheet.setColumnWidth(6, 250);
  sheet.setColumnWidth(7, 95);
  sheet.setColumnWidth(8, 110);
  sheet.setColumnWidth(9, 100);
  sheet.setColumnWidth(10, 60);
  sheet.setColumnWidth(11, 220);

  sheet.getRange(1, 1, Math.max(lastRow, 2), 11).createFilter();

  sheet.getRange(1, 1).setNote(
    "LEGENDA:\n" +
    "• Żółte tło = przeglądy na dziś\n" +
    "• Czerwony status/data = po terminie, niewykonany\n" +
    "• Szary wiersz = wykonany\n" +
    "• Pasy tła = kolejne dni\n\n" +
    "Szybki skok do dzisiaj: ⚙️ CMMS System → 📍 Przejdź do dzisiejszych przeglądów"
  );
}

/**
 * UJEDNOLICENIE I FORMATOWANIE WSZYSTKICH HARMONOGRAMÓW W PLIKU
 */
function naprawStruktureWszystkichHarmonogramow__zapis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (czyArkuszHarmonogramu_(sheet.getName())) {
      formatujArkuszHarmonogramu(sheet);
    }
  }
}

/* ==========================================================================
 *  FORMULARZE I ROZLICZANIE
 * ========================================================================== */

/**
 * Wyświetlanie formularza wewnątrz arkusza Google Sheets (modal dialog)
 */
function pokazFormularzPrzegladu() {
  // To samo rozliczanie co w aplikacji na telefonie (checklista, części, awarie, wykonawca z konta…),
  // otwarte w oknie arkusza. Kursor w harmonogramie -> ten przegląd; w innej zakładce na wierszu maszyny -> ta maszyna.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  var nazwa = sh.getName();
  var wiersz = sh.getActiveCell().getRow();
  var param = "";
  if (wiersz >= 2) {
    if (czyArkuszHarmonogramu_(nazwa)) param = String(sh.getRange(wiersz, 1).getDisplayValue()).trim();
    if (!param || param.indexOf("PRZ-") !== 0) param = wykryjMaszyneZArkusza_(sh, nazwa, wiersz) || "";
  }
  var html = szablonAplikacji_(param, "", "arkusz").evaluate()
    .setWidth(1280).setHeight(780).setTitle("📝 Rozliczenie przeglądu");
  SpreadsheetApp.getUi().showModalDialog(html, "📝 Rozliczenie przeglądu – CMMS");
}

/**
 * Pobiera urządzenia do wyboru na stronie mobilnej Web App
 */
function getListaPrzegladow(miesiacKod) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kod = miesiacKod || pobierzKodAktualnegoMiesiaca();
  var szukanaNazwa = "Harmonogram - " + kod;
  var sheet = ss.getSheetByName(szukanaNazwa);

  if (!sheet) {
    sheet = ss.getSheetByName("2. Harmonogram");
  }
  if (!sheet) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (czyArkuszHarmonogramu_(sheets[i].getName())) {
        sheet = sheets[i];
        break;
      }
    }
  }

  if (!sheet || sheet.getLastRow() < 2) return [];

  var data = sheet.getRange(1, 1, sheet.getLastRow(), 11).getDisplayValues();
  var lista = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var idPrzegladu = String(row[0] || "").trim();
    var idUrzadzenia = String(row[1] || "").trim();
    var obszar = String(row[2] || "").trim();
    var nazwaUrzadzenia = String(row[3] || "").trim();
    var dataPlanowana = String(row[6] || "").trim();
    var status = String(row[8] || "").trim();

    if (!nazwaUrzadzenia || !idPrzegladu) continue;

    lista.push({
      idPrzegladu: idPrzegladu,
      idUrzadzenia: idUrzadzenia,
      obszar: obszar,
      nazwaUrzadzenia: nazwaUrzadzenia,
      dataPlanowana: dataPlanowana,
      czyWykonany: (status.toLowerCase() === "wykonany")
    });
  }

  return lista;
}

/**
 * Pobiera komplet informacji o pojedynczym przeglądzie
 */
function pobierzDanePrzegladu(idPrzegladu) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var szukane = normalizujId_(idPrzegladu);

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (!czyArkuszHarmonogramu_(sheet.getName())) continue;
    if (sheet.getLastRow() < 2) continue;

    var data = sheet.getRange(1, 1, sheet.getLastRow(), 11).getDisplayValues();
    for (var i = 1; i < data.length; i++) {
      if (normalizujId_(data[i][0]) === szukane || normalizujId_(data[i][1]) === szukane) {
        return {
          idPrzegladu: String(data[i][0]).trim(),
          idUrzadzenia: String(data[i][1] || "").trim(),
          obszar: String(data[i][2] || "").trim(),
          nazwaUrzadzenia: String(data[i][3] || "").trim(),
          czestotliwosc: String(data[i][4] || "").trim(),
          zakres: String(data[i][5] || "").trim(),
          dataPlanowana: String(data[i][6] || "").trim(),
          wykonawca: String(data[i][7] || "").trim(),
          status: String(data[i][8] || "").trim(),
          wynik: String(data[i][9] || "").trim(),
          rozliczenie: String(data[i][10] || "").trim(),
          nazwaArkusz: sheet.getName()
        };
      }
    }
  }
  return null;
}

/**
 * Pomocnicza funkcja pobierająca przeglądy do formularza modalnego
 */
function pobierzWszystkiePrzegladyDoFormularza(idWymagane) {
  if (!idWymagane) return rozpakujPrzeglady_(daneStartowe_().lista);
  return czytajPrzegladyDoFormularza_(idWymagane);
}
function czytajPrzegladyDoFormularza_(idWymagane) {
  // POPRAWKA: wcześniej lista brała tylko bieżący miesiąc (1 października zaległości z września
  // znikały) i zawierała także wykonane przeglądy - kilkaset pozycji naraz.
  // Teraz: wszystkie niewykonane z terminem do 14 dni w przód + zaległe z każdego miesiąca.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("2. Harmonogram");
  if (!sheet) return getListaPrzegladow(pobierzKodAktualnegoMiesiaca());
  if (sheet.getLastRow() < 2) return [];

  var HORYZONT_DNI = 14;
  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var dzis = new Date(dzisStr + "T00:00:00");
  var wymagane = normalizujId_(idWymagane || "");

  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getDisplayValues();
  var wynik = [];

  for (var i = 0; i < dane.length; i++) {
    var r = dane[i];
    var id = String(r[0] || "").trim();
    if (!id) continue;

    var dataStr = String(r[6] || "").trim();
    var status = String(r[8] || "").trim();
    var wykonany = status.toLowerCase() === "wykonany";
    var d = new Date(dataStr + "T00:00:00");
    var dni = isNaN(d.getTime()) ? 9999 : Math.round((d.getTime() - dzis.getTime()) / 86400000);
    var jestWymagany = wymagane && normalizujId_(id) === wymagane;

    if (!jestWymagany && (wykonany || dni > HORYZONT_DNI)) continue;

    wynik.push({
      idPrzegladu: id,
      idUrzadzenia: String(r[1] || "").trim(),
      obszar: String(r[2] || "").trim(),
      nazwaUrzadzenia: String(r[3] || "").trim(),
      czestotliwosc: String(r[4] || "").trim(),
      zakres: String(r[5] || "").trim(),
      dataPlanowana: dataStr,
      status: status,
      czyWykonany: wykonany,
      dni: dni,
      kategoria: wykonany ? "wykonany" : (dni < 0 ? "zalegly" : (dni === 0 ? "dzis" : "nadchodzacy"))
    });
  }

  wynik.sort(function (a, b) {
    if (a.dni !== b.dni) return a.dni - b.dni;
    if (a.obszar !== b.obszar) return a.obszar.localeCompare(b.obszar);
    return a.nazwaUrzadzenia.localeCompare(b.nazwaUrzadzenia);
  });
  return wynik;
}

/**
 * Pobieranie danych dla dynamicznego Formularza Mobile
 */
function pobierzDaneDoFormularzaMobile(odNowa) {
  // zaległe + dziś + 14 dni, spakowane, z pamięci podręcznej; przycisk „Odśwież” wymusza odczyt arkusza
  if (odNowa) wyczyscCache_(["cmms_start", "cmms_stat"]);
  return daneStartowe_().lista;
}

/**
 * Lista przeglądów w zwartej postaci dla aplikacji (ok. 6x mniej danych do przesłania):
 * nazwa/obszar maszyny i opis czynności są wysyłane raz, a każdy termin to krótki wiersz.
 * Rozpakowuje ją funkcja rozpakuj() w FormularzMobile.html.
 */
function spakujPrzeglady_(lista) {
  var zakresy = [], indeks = {}, maszyny = {}, wiersze = [];
  (lista || []).forEach(function (p) {
    var z = String(p.zakres || "");
    if (!Object.prototype.hasOwnProperty.call(indeks, z)) { indeks[z] = zakresy.length; zakresy.push(z); }
    maszyny[p.idUrzadzenia] = [p.nazwaUrzadzenia, p.obszar];
    wiersze.push([p.idPrzegladu, p.idUrzadzenia, p.czestotliwosc, p.dataPlanowana, p.dni, indeks[z], p.czyWykonany ? 1 : 0]);
  });
  return { v: 2, z: zakresy, m: maszyny, w: wiersze };
}

/**
 * Zapis rozliczenia z wersji Formularza Mobile
 */
function zapiszRozliczenieMobile(payload) {
  var okStatus = payload.hasUsterka ? "Wymaga naprawy" : "OK";
  return zapiszRozliczenie({
    idPrzegladu: payload.przegladId,
    wykonawca: payload.wykonawca,
    czasPracy: payload.czas,
    opisPrac: payload.opis,
    wynik: okStatus,
    priorytet: payload.priorytet || "Średni",
    opisUsterki: payload.opisUsterki || "",
    zalecenia: payload.zalecenia || "", potwierdzenieDTR: payload.potwierdzenieDTR === true,
    zrodlo: payload.zrodlo === "arkusz" ? "arkusz" : "telefon", maszynaStoi: payload.maszynaStoi === true
  });
}
/**
 * Główna logika zapisu rozliczenia (kolumny H, I, J, K harmonogramu)
 *
 * Poprawki:
 *  - porównanie ID przez normalizujId_() zamiast surowego === (odporne na spacje i wielkość liter),
 *  - uzupełnianie ID/obszaru/nazwy urządzenia z karty urządzeń, jeśli formularz ich nie przysłał,
 *  - usterki zapisywane w pełnej, 12-kolumnowej strukturze arkusza "4. Usterki i Awarie",
 *  - brak automatycznego wywołania naprawStruktureRejestruPrzegladow() (przepisywało cały arkusz
 *    przy każdym zapisie, co przy kilkuset wpisach jest kosztowne i ryzykowne),
 *  - LockService, żeby dwóch techników nie nadpisało sobie wiersza.
 */
function zapiszRozliczenie__zapis(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { success: false, message: "System jest zajęty zapisem innego rozliczenia. Spróbuj ponownie za chwilę." };
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dzisiaj = new Date();
    var sformatowanaData = Utilities.formatDate(dzisiaj, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");

    var idSzukane = String(payload.idPrzegladu || "").trim();
    if (!idSzukane) {
      return { success: false, message: "Brak ID przeglądu - nie zapisano." };
    }
    var idSzukaneNorm = normalizujId_(idSzukane); if ((payload.zrodlo === "arkusz" || payload.zrodlo === "telefon") && payload.potwierdzenieDTR !== true) { return { success: false, message: "Brak potwierdzenia komunikatu DTR – przegląd nie został zapisany." }; }

    // POPRAWKA: pole "Zalecane działania / Potrzebne części" z formularza mobilnego
    // było wysyłane, ale nigdzie nie zapisywane - teraz trafia do opisu usterki.
    if (payload.zalecenia && String(payload.zalecenia).trim()) {
      payload.opisUsterki = (payload.opisUsterki || "") + " | Zalecenia / części: " + String(payload.zalecenia).trim();
    }

    // Uzupełnienie brakujących danych o urządzeniu
    if (!payload.nazwaUrzadzenia || !payload.obszar || !payload.idUrzadzenia) {
      var daneZArkusza = pobierzDanePrzegladu(idSzukane);
      if (daneZArkusza) {
        payload.idUrzadzenia = payload.idUrzadzenia || daneZArkusza.idUrzadzenia;
        payload.obszar = payload.obszar || daneZArkusza.obszar;
        payload.nazwaUrzadzenia = payload.nazwaUrzadzenia || daneZArkusza.nazwaUrzadzenia;
      }
    }
    // Ostatnia deska ratunku: karta urządzeń
    if (payload.idUrzadzenia && (!payload.obszar || !payload.nazwaUrzadzenia)) {
      var mapaUrz = pobierzMapeUrzadzen_(ss);
      var urz = mapaUrz[normalizujId_(payload.idUrzadzenia)];
      if (urz) {
        payload.obszar = payload.obszar || urz.obszar;
        payload.nazwaUrzadzenia = payload.nazwaUrzadzenia || urz.nazwa;
      }
    }

    // Ostatnia próba: dopasowanie po nazwie urządzenia (np. z etykiety formularza "PRZ-... | Nazwa")
    if (!payload.idUrzadzenia && payload.nazwaUrzadzenia) {
      var urzPoNazwie = znajdzUrzadzeniePoNazwie_(payload.nazwaUrzadzenia, pobierzMapeUrzadzen_(ss), payload.obszar);
      if (urzPoNazwie) {
        payload.idUrzadzenia = urzPoNazwie.id;
        payload.obszar = payload.obszar || urzPoNazwie.obszar;
      }
    }

    var statusKod = (payload.wynik === "Wymaga naprawy" || payload.wynik === "NOK") ? "NOK" : "OK";

    // 1. Aktualizacja we WSZYSTKICH arkuszach harmonogramu (zbiorczy + miesięczny)
    var listSheets = ss.getSheets();
    var znalezione = 0;

    for (var s = 0; s < listSheets.length; s++) {
      var sheet = listSheets[s];
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;
      if (!czyArkuszHarmonogramu_(sheet.getName())) continue;

      var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) {
        if (normalizujId_(ids[i][0]) !== idSzukaneNorm) continue;

        var wiersz = i + 2;
        znalezione++;

        sheet.getRange(wiersz, 8).setValue(payload.wykonawca); // H: Wykonawca
        sheet.getRange(wiersz, 9).setValue("Wykonany");        // I: Status
        sheet.getRange(wiersz, 10).setValue(statusKod);        // J: Wynik (OK / NOK)

        var wpisRozliczenia = "[Rozliczenie " + sformatowanaData + "]: " + (payload.opisPrac || "");
        if (statusKod === "NOK") {
          wpisRozliczenia += " | ❌ USTERKA (" + (payload.priorytet || payload.priorytetUsterki || "Średni") + "): " + (payload.opisUsterki || "");
        }

        var dotychczasoweRozliczenie = sheet.getRange(wiersz, 11).getValue();
        var lacznyTekst = dotychczasoweRozliczenie ? dotychczasoweRozliczenie + " | " + wpisRozliczenia : wpisRozliczenia;
        sheet.getRange(wiersz, 11).setValue(lacznyTekst);      // K: Rozliczenie / Uwagi
      }
    }

    if (znalezione === 0) {
      Logger.log("UWAGA: nie znaleziono przeglądu " + idSzukane + " w żadnym harmonogramie - wpis trafi tylko do Rejestru.");
    }

    // 2. Zapis w "3. Rejestr Przeglądów"
    var sheetRejestr = ss.getSheetByName("3. Rejestr Przeglądów");
    if (!sheetRejestr) {
      sheetRejestr = ss.insertSheet("3. Rejestr Przeglądów");
      sheetRejestr.appendRow(NAGLOWKI_REJESTR);
    }

    var idWpisu = generujUnikalneId_("WPS");
    var usterkaInfo = (statusKod === "NOK")
      ? "[" + (payload.priorytet || payload.priorytetUsterki || "Średni") + "] " + (payload.opisUsterki || "")
      : "-";

    sheetRejestr.appendRow([
      idWpisu,
      idSzukane,
      payload.idUrzadzenia || "",
      payload.obszar || "",
      payload.nazwaUrzadzenia || "",
      sformatowanaData,
      payload.wykonawca,
      parseFloat(String(payload.czasPracy || "").replace(",", ".")) || 1,
      statusKod,
      payload.opisPrac || "",
      usterkaInfo
    ]);

    // ID w Rejestrze też jako tekst
    var ostatniWiersz = sheetRejestr.getLastRow();
    sheetRejestr.getRange(ostatniWiersz, 1, 1, 3).setNumberFormat("@");

    // 3. Rejestracja w module "4. Usterki i Awarie" oraz wysyłka maila
    if (statusKod === "NOK") {
      var sheetUsterki = arkuszUsterek_(ss);   // tworzy arkusz i kolumny M–O (Źródło, Maszyna stoi, Czas przestoju), jeśli trzeba

      var idUsterki = generujUnikalneId_("UST");
      var priorytetTxt = payload.priorytet || payload.priorytetUsterki || "Średni";

      // POPRAWKA: kolumna C to ID URZĄDZENIA, a nie nazwa obszaru.
      // Wcześniej trafiało tu "Kompresory" / "Sprężone Powietrze", przez co nie dało się
      // zbudować historii awaryjności per maszyna (podstawa pod predykcję awarii).
      sheetUsterki.appendRow([
        idUsterki,
        sformatowanaData,
        payload.idUrzadzenia || "",
        payload.obszar || "",
        payload.nazwaUrzadzenia || "",
        payload.opisUsterki || "",
        priorytetTxt,
        payload.wykonawca,
        "Zgłoszona",
        "",
        "",
        "",
        "Przegląd (" + (payload.zrodlo === "arkusz" ? "arkusz" : "telefon") + ")",
        payload.maszynaStoi === true ? "TAK" : "NIE",
        ""
      ]);
      sheetUsterki.getRange(sheetUsterki.getLastRow(), 3).setNumberFormat("@");

      try {
        var tematyka = (payload.maszynaStoi === true ? "⛔ MASZYNA STOI – " : "⚠️ ") + "[CMMS AWARIA] Zgłoszono usterkę NOK: " + (payload.nazwaUrzadzenia || idSzukane);
        var trescHTML =
          "<div style='font-family: Arial, sans-serif; padding: 20px; border: 2px solid #ef4444; border-radius: 8px; background-color: #fef2f2;'>" +
            "<h2 style='color: #991b1b; margin-top: 0;'>⚠️ Wykryto usterkę / awarię podczas przeglądu (NOK)</h2>" +
            "<hr style='border: 0; border-top: 1px solid #fca5a5;' />" +
            "<p><b>ID Usterki:</b> " + idUsterki + "</p>" +
            "<p><b>ID Przeglądu:</b> " + escHtml_(idSzukane) + "</p>" +
            "<p><b>Urządzenie:</b> " + escHtml_(payload.nazwaUrzadzenia || "-") + " [" + escHtml_(payload.idUrzadzenia || "-") + "] (" + escHtml_(payload.obszar || "-") + ")</p>" +
            "<p><b>Zgłaszający / Wykonawca:</b> " + escHtml_(payload.wykonawca) + "</p>" +
            "<p><b>Priorytet:</b> <span style='color: #dc2626; font-weight: bold;'>" + escHtml_(priorytetTxt) + "</span></p>" +
            "<p><b>Opis usterki:</b> <span style='color: #b91c1c; font-weight: bold;'>" + escHtml_(payload.opisUsterki || "Brak opisu") + "</span></p>" +
            "<p style='font-size: 11px; color: #6b7280; margin-top: 20px;'>Wiadomość wygenerowana automatycznie przez system CMMS Holcim.</p>" +
          "</div>";

        MailApp.sendEmail({
          to: EMAIL_KIEROWNIKA,
          subject: tematyka,
          htmlBody: trescHTML
        });
      } catch (errMail) {
        Logger.log("⚠️ Błąd podczas wysyłania maila: " + errMail.message);
      }
    }

    // zapamiętanie wykonawcy - następnym razem formularz wypełni to pole sam
    // (tylko z okna w arkuszu - aplikacja mobilna pamięta wykonawcę na telefonie)
    try {
      if (payload.zrodlo === "arkusz" && payload.wykonawca) {
        PropertiesService.getUserProperties().setProperty("CMMS_WYKONAWCA", String(payload.wykonawca).trim());
      }
    } catch (e) {}

    return {
      success: true,
      idPrzegladu: idSzukane,
      message: "Pomyślnie rozliczono przegląd: " + (payload.nazwaUrzadzenia || idSzukane)
    };

  } finally {
    lock.releaseLock();
  }
}

/* ==========================================================================
 *  FORMULARZ GOOGLE
 * ========================================================================== */

/**
 * Podmienia opcje w pytaniu 'Wybierz Przegląd' w Formularzu Google
 */
function aktualizujOpcjeWFormularzu(form) {
  var items = form.getItems();
  var pytaniePrzeglad = null;

  for (var i = 0; i < items.length; i++) {
    if (items[i].getTitle().indexOf('Wybierz Przegląd') !== -1) {
      pytaniePrzeglad = items[i].asListItem();
      break;
    }
  }

  if (!pytaniePrzeglad) {
    budujStruktureFormularza(form);
    return;
  }

  var dzisiaj = new Date();
  dzisiaj.setHours(0, 0, 0, 0);

  var kodMiesiaca = pobierzKodAktualnegoMiesiaca();
  var listaPrzegladow = getListaPrzegladow(kodMiesiaca) || [];

  var zalegle = [], naDzis = [], kiedys = [];

  for (var j = 0; j < listaPrzegladow.length; j++) {
    var p = listaPrzegladow[j];
    if (!p || p.czyWykonany) continue;

    var dataP = p.dataPlanowana ? new Date(p.dataPlanowana) : null;
    var nazwaCzysta = String(p.nazwaUrzadzenia || "Sprzęt").replace(/[\r\n\t]+/g, " ").trim();
    var idCzyste = String(p.idPrzegladu || "").trim();
    if (!idCzyste) continue;
    var podstawaEtykiety = idCzyste + " | " + nazwaCzysta;

    if (!dataP || isNaN(dataP.getTime())) {
      kiedys.push({ etykieta: "📆 [BEZ DATY] " + podstawaEtykiety, data: new Date(2099, 0, 1) });
    } else {
      dataP.setHours(0, 0, 0, 0);
      var roznicaDni = Math.round((dzisiaj - dataP) / (1000 * 60 * 60 * 24));

      if (dataP < dzisiaj) {
        zalegle.push({ etykieta: "🚨 [ZALEGŁY " + roznicaDni + "d] " + podstawaEtykiety, data: dataP });
      } else if (dataP.getTime() === dzisiaj.getTime()) {
        naDzis.push({ etykieta: "📅 [DZISIAJ] " + podstawaEtykiety, data: dataP });
      } else {
        kiedys.push({ etykieta: "📆 [PLAN " + Utilities.formatDate(dataP, "GMT+1", "yyyy-MM-dd") + "] " + podstawaEtykiety, data: dataP });
      }
    }
  }

  var sortFn = function (a, b) { return a.data - b.data; };
  zalegle.sort(sortFn);
  naDzis.sort(sortFn);
  kiedys.sort(sortFn);

  var rawOpcje = [];
  var dodajOpcje = function (item) {
    if (!item || !item.etykieta) return;
    var txt = String(item.etykieta).trim();
    // UWAGA: nie skracamy etykiety w miejscu, gdzie mogłoby zniknąć ID - ID jest na początku.
    if (txt.length > 190) txt = txt.substring(0, 187) + "...";
    if (txt.length > 0) rawOpcje.push(txt);
  };

  zalegle.forEach(dodajOpcje);
  naDzis.forEach(dodajOpcje);
  kiedys.forEach(dodajOpcje);

  var opcjeListy = rawOpcje.filter(function (value, index, self) {
    return value && value.trim() !== "" && self.indexOf(value) === index;
  });

  // Formularz Google ma limit praktyczny - nie ładujemy 2000 pozycji
  if (opcjeListy.length > 500) opcjeListy = opcjeListy.slice(0, 500);

  if (!opcjeListy || opcjeListy.length === 0) {
    opcjeListy = ["Brak niewykonanych przeglądów do rozliczenia"];
  }

  pytaniePrzeglad.setChoiceValues(opcjeListy);
}

function aktualizujFormularzGoogle() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formUrl = ss.getFormUrl();
  if (!formUrl) {
    SpreadsheetApp.getUi().alert("Brak podłączonego Formularza Google. Użyj najpierw opcji stworzenia formularza.");
    return;
  }
  var form = FormApp.openByUrl(formUrl);
  aktualizujOpcjeWFormularzu(form);
  SpreadsheetApp.getUi().alert("✅ Zaktualizowano opcje w Formularzu Google!");
}

/**
 * Budowanie struktury formularza Google
 */
function budujStruktureFormularza(form) {
  var items = form.getItems();
  for (var i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }

  form.addListItem()
      .setTitle('Wybierz Przegląd')
      .setHelpText('Lista posortowana wg pilności: Zaległe, Na Dziś oraz Nadchodzące.')
      .setChoiceValues(["Wczytywanie..."])
      .setRequired(true);

  form.addTextItem()
      .setTitle('Wykonawca')
      .setHelpText('Imię i Nazwisko technika')
      .setRequired(true);

  form.addTextItem()
      .setTitle('Czas pracy (h)')
      .setHelpText('np. 1 lub 1.5')
      .setRequired(true);

  form.addParagraphTextItem()
      .setTitle('Opis prac')
      .setRequired(false);

  var pytWynik = form.addMultipleChoiceItem()
      .setTitle('Wynik przeglądu')
      .setRequired(true);

  var sekcjaUsterki = form.addPageBreakItem()
      .setTitle('🚨 Szczegóły Usterki / Awarii');

  pytWynik.setChoices([
    pytWynik.createChoice('OK', FormApp.PageNavigationType.SUBMIT),
    pytWynik.createChoice('Wymaga naprawy', sekcjaUsterki)
  ]);

  form.addMultipleChoiceItem()
      .setTitle('Priorytet usterki')
      .setChoiceValues(['Niski', 'Średni', 'Wysoki'])
      .setRequired(true);

  form.addParagraphTextItem()
      .setTitle('Opis usterki')
      .setHelpText('Opisz wykrytą usterkę lub zapotrzebowanie na części')
      .setRequired(true);

  aktualizujOpcjeWFormularzu(form);
}

function stworzFormularzGoogle() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var form = null;

  var formUrl = ss.getFormUrl();
  if (formUrl) {
    try { form = FormApp.openByUrl(formUrl); } catch (e) { form = null; }
  }

  if (form) {
    // POPRAWKA: każda przebudowa kasowała pytania i tworzyła je od nowa, przez co w arkuszu
    // odpowiedzi powstawał DRUGI zestaw kolumn (dwie kolumny "Wybierz Przegląd", dwie "Wykonawca"...).
    var maStrukture = form.getItems().some(function (it) {
      return it.getTitle().indexOf('Wybierz Przegląd') !== -1;
    });

    if (maStrukture) {
      var odp = ui.alert(
        'Formularz już istnieje',
        'Formularz ma już właściwą strukturę.\n\n' +
        'TAK = tylko odśwież listę przeglądów (zalecane)\n' +
        'NIE = przebuduj od zera (UWAGA: w arkuszu odpowiedzi powstanie kolejny zestaw kolumn)',
        ui.ButtonSet.YES_NO_CANCEL);

      if (odp === ui.Button.YES) {
        aktualizujOpcjeWFormularzu(form);
        ui.alert("✅ Odświeżono listę przeglądów w formularzu.\n\nURL: " + form.getPublishedUrl());
        return;
      }
      if (odp !== ui.Button.NO) return; // Anuluj / zamknięcie okna
    }
  } else {
    form = FormApp.create("CMMS Holcim - Rozliczenie Przeglądu");
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  }

  budujStruktureFormularza(form);
  Logger.log("Formularz przebudowany pomyślnie! URL: " + form.getPublishedUrl());
  ui.alert("✅ Formularz Google został przygotowany! URL: " + form.getPublishedUrl());
}

/**
 * Obsługa wysyłki Formularza Google: zapis odpowiedzi do Rejestru i harmonogramu.
 * Z ochroną przed podwójnym zapisem tej samej odpowiedzi.
 */
function onFormSubmitCMMS(e) {
  try {
    if (!e || !e.namedValues) return;
    var nv = e.namedValues;

    // Arkusz odpowiedzi może mieć zdublowane kolumny o tej samej nazwie -
    // bierzemy pierwszą niepustą wartość.
    var pobierz = function (nazwa) {
      var v = nv[nazwa];
      if (!v) return "";
      for (var i = 0; i < v.length; i++) {
        if (String(v[i]).trim()) return String(v[i]).trim();
      }
      return "";
    };

    var etykieta = pobierz('Wybierz Przegląd');
    var idPrzegladu = wyodrebnijIdZEtykiety_(etykieta);
    if (!idPrzegladu) {
      Logger.log("onFormSubmitCMMS: nie udało się odczytać ID z etykiety: " + etykieta);
      return;
    }

    var wykonawca = pobierz('Wykonawca');
    if (czyJuzWRejestrze_(idPrzegladu, wykonawca, new Date())) {
      Logger.log("onFormSubmitCMMS: pominięto duplikat " + idPrzegladu);
      return;
    }

    zapiszRozliczenie({
      idPrzegladu: idPrzegladu,
      nazwaUrzadzenia: wyodrebnijNazweZEtykiety_(etykieta),
      wykonawca: wykonawca,
      czasPracy: pobierz('Czas pracy (h)'),
      opisPrac: pobierz('Opis prac'),
      wynik: pobierz('Wynik przeglądu'),
      priorytet: pobierz('Priorytet usterki'),
      opisUsterki: pobierz('Opis usterki')
    });

    // Oznaczenie wiersza odpowiedzi jako przetworzonego
    try {
      if (e.range) {
        var sh = e.range.getSheet();
        var nag = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
        var k = nag.indexOf("CMMS Status");
        if (k > -1) {
          sh.getRange(e.range.getRow(), k + 1).setValue("✅ " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"));
        }
      }
    } catch (x) { /* oznaczenie jest opcjonalne */ }

  } catch (err) {
    Logger.log("Błąd onFormSubmitCMMS: " + err.message);
  }
}

/**
 * Wyciąga ID przeglądu z etykiety formularza, np.
 * "🚨 [ZALEGŁY 3d] PRZ-1.10-20260918 | Klapa zrzutowa" -> "PRZ-1.10-20260918"
 */
function wyodrebnijIdZEtykiety_(etykieta) {
  if (!etykieta) return "";
  var m = String(etykieta).match(/PRZ-[^\s|]+/);
  return m ? m[0] : "";
}
/**
 * NOWE: ręczne przetworzenie odpowiedzi, które wpłynęły zanim wyzwalacz istniał.
 * Przetwarza tylko wiersze jeszcze nieoznaczone (dopisuje znacznik w ostatniej kolumnie).
 */
function przetworzZalegleOdpowiedziFormularza() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sheets = ss.getSheets();
  var arkusz = null;

  for (var i = 0; i < sheets.length; i++) {
    var nazwa = sheets[i].getName();
    if (nazwa.indexOf("Form Responses") !== -1 || nazwa.indexOf("Odpowiedzi") !== -1) {
      arkusz = sheets[i];
      break;
    }
  }
  if (!arkusz || arkusz.getLastRow() < 2) {
    ui.alert("Nie znaleziono arkusza z odpowiedziami formularza.");
    return;
  }

  var lastCol = arkusz.getLastColumn();
  var naglowki = arkusz.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var kolStatus = naglowki.indexOf("CMMS Status");
  if (kolStatus === -1) {
    kolStatus = lastCol;
    arkusz.getRange(1, kolStatus + 1).setValue("CMMS Status").setFontWeight("bold");
  }

  var n = arkusz.getLastRow() - 1;
  var szer = Math.max(lastCol, kolStatus + 1);
  var dane = arkusz.getRange(2, 1, n, szer).getDisplayValues();
  var znaczniki = arkusz.getRange(2, 1, n, 1).getValues();

  // POPRAWKA: po przebudowie formularza kolumny się dublują ("Wybierz Przegląd" w B i w I).
  // Szukamy pierwszej niepustej wartości we WSZYSTKICH kolumnach o danej nazwie.
  var pole = function (wiersz, tytul) {
    for (var c = 0; c < naglowki.length; c++) {
      if (naglowki[c] === tytul && String(wiersz[c] || "").trim()) return String(wiersz[c]).trim();
    }
    return "";
  };

  var nowe = 0, duplikaty = 0, bezId = 0;
  var teraz = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm");

  for (var r = 0; r < n; r++) {
    var status = String(dane[r][kolStatus] || "").trim();
    // przetwarzamy nowe wiersze oraz te oznaczone wcześniej ostrzeżeniem
    if (status && status.indexOf("⚠️") !== 0) continue;

    var etykieta = pole(dane[r], 'Wybierz Przegląd');
    var idPrzegladu = wyodrebnijIdZEtykiety_(etykieta);
    var wykonawca = pole(dane[r], 'Wykonawca');

    if (!idPrzegladu) {
      arkusz.getRange(r + 2, kolStatus + 1).setValue("⚠️ Brak ID – sprawdź ręcznie");
      bezId++;
      continue;
    }

    // POPRAWKA: ochrona przed podwójnym zapisem tej samej odpowiedzi
    if (czyJuzWRejestrze_(idPrzegladu, wykonawca, znaczniki[r][0])) {
      arkusz.getRange(r + 2, kolStatus + 1).setValue("✅ był już w rejestrze");
      duplikaty++;
      continue;
    }

    zapiszRozliczenie({
      idPrzegladu: idPrzegladu,
      nazwaUrzadzenia: wyodrebnijNazweZEtykiety_(etykieta),
      wykonawca: wykonawca,
      czasPracy: pole(dane[r], 'Czas pracy (h)'),
      opisPrac: pole(dane[r], 'Opis prac'),
      wynik: pole(dane[r], 'Wynik przeglądu'),
      priorytet: pole(dane[r], 'Priorytet usterki') || "Średni",
      opisUsterki: pole(dane[r], 'Opis usterki')
    });

    arkusz.getRange(r + 2, kolStatus + 1).setValue("✅ " + teraz);
    nowe++;
  }

  ui.alert("📥 ODPOWIEDZI Z FORMULARZA\n\n" +
    "Zapisane do rejestru: " + nowe + "\n" +
    "Pominięte – były już w rejestrze: " + duplikaty + "\n" +
    "Bez ID przeglądu (do ręcznej weryfikacji): " + bezId);
}

/**
 * NOWE: instalacja wyzwalaczy (onFormSubmit + nocne oznaczanie zaległości).
 * Bezpieczna do wielokrotnego uruchomienia - najpierw usuwa swoje stare wyzwalacze.
 */
function instalujWyzwalacze() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var istniejace = ScriptApp.getProjectTriggers();
  var usuniete = 0;

  for (var i = 0; i < istniejace.length; i++) {
    var t = istniejace[i];
    var fn = t.getHandlerFunction();
    // Usuwamy WSZYSTKIE wyzwalacze wysyłki formularza (także ze starszych wersji),
    // żeby jedna odpowiedź nie była zapisywana dwa razy.
    if (fn === 'onFormSubmitCMMS' || fn === 'oznaczZalegleePrzeglady' ||
        t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT) {
      ScriptApp.deleteTrigger(t);
      usuniete++;
    }
  }

  ScriptApp.newTrigger('onFormSubmitCMMS').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('oznaczZalegleePrzeglady').timeBased().atHour(4).everyDays(1).create();

  SpreadsheetApp.getUi().alert("✅ Wyzwalacze zainstalowane:\n" +
    "• onFormSubmitCMMS – zapis odpowiedzi z Formularza\n" +
    "• oznaczZalegleePrzeglady – codziennie o 4:00 oznacza zaległości\n\n" +
    "Usunięto poprzednich wyzwalaczy: " + usuniete);
}

/**
 * NOWE: oznaczanie przeglądów po terminie jako "Zaległy".
 * Bez tego status "Zaplanowany" nigdy się nie zmieniał i wskaźniki nie pokazywały problemu.
 */
function oznaczZalegleePrzeglady__zapis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dzis = new Date();
  dzis.setHours(0, 0, 0, 0);
  var sheets = ss.getSheets();
  var zmienione = 0;

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (!czyArkuszHarmonogramu_(sheet.getName())) continue;
    if (sheet.getLastRow() < 2) continue;

    var n = sheet.getLastRow() - 1;
    var daty = sheet.getRange(2, 7, n, 1).getDisplayValues();
    var statusy = sheet.getRange(2, 9, n, 1).getValues();
    var zmiana = false;

    for (var i = 0; i < n; i++) {
      var st = String(statusy[i][0] || "").trim();
      if (st === "Wykonany" || st === "Zaległy") continue;

      var dP = new Date(daty[i][0]);
      if (isNaN(dP.getTime())) continue;
      dP.setHours(0, 0, 0, 0);

      if (dP.getTime() < dzis.getTime()) {
        statusy[i][0] = "Zaległy";
        zmiana = true;
        zmienione++;
      }
    }
    if (zmiana) sheet.getRange(2, 9, n, 1).setValues(statusy);
  }

  Logger.log("Oznaczono zaległych przeglądów: " + zmienione);
  return zmienione;
}

/**
 * Generowanie kodów QR dla urządzeń
 */
function wygenerujKodyQR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("1. Urządzenia");
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Nie znaleziono arkusza '1. Urządzenia'!");
    return;
  }

  var targetUrl = ScriptApp.getService().getUrl() || ss.getFormUrl();

  if (!targetUrl) {
    SpreadsheetApp.getUi().alert("Zapewnij Formularz Google lub opublikuj Aplikację Webową!");
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Blokada generowania kodów na zduplikowanych ID - kod QR musi wskazywać jedną maszynę
  var duplikaty = znajdzDuplikatyIdUrzadzen_(sheet);
  if (duplikaty.length > 0) {
    SpreadsheetApp.getUi().alert(
      "⛔ Nie wygenerowano kodów QR.\n\n" +
      "Zduplikowane ID urządzeń (" + duplikaty.length + "): " + duplikaty.join(", ") + "\n\n" +
      "Kod QR wskazywałby dwie różne maszyny. Uruchom najpierw:\n" +
      "⚙️ CMMS System → 🔧 Napraw format ID urządzeń."
    );
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  sheet.getRange(1, 6).setValue("Kod QR (Skanuj)").setFontWeight("bold").setBackground("#1e40af").setFontColor("#ffffff");

  for (var i = 0; i < data.length; i++) {
    var idUrzadzenia = String(data[i][0]).trim();
    if (!idUrzadzenia) continue;

    var linkZParametrem = targetUrl + (targetUrl.indexOf('?') > -1 ? '&' : '?') + "id=" + encodeURIComponent(idUrzadzenia);
    var urlQR = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" + encodeURIComponent(linkZParametrem);
    var formula = '=IMAGE("' + urlQR + '", 4, 70, 70)';

    sheet.getRange(i + 2, 6).setFormula(formula).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.setRowHeight(i + 2, 80);
  }
  sheet.setColumnWidth(6, 90);
  SpreadsheetApp.getUi().alert("✅ Kody QR zostały pomyślnie wygenerowane!");
}

/**
 * Formatowanie i ujednolicenie Rejestru Przeglądów
 */
function naprawStruktureRejestruPrzegladow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("3. Rejestr Przeglądów");
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var numRows = lastRow - 1;
  var values = sheet.getRange(2, 1, numRows, 11).getDisplayValues();
  var newRows = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var idWpisu = String(row[0] || "").trim();
    if (!idWpisu || idWpisu.indexOf("WPS-") === -1) idWpisu = generujUnikalneId_("WPS");

    var idPrzegladu = String(row[1] || "").trim();
    var idUrzadzenia = String(row[2] || "").trim();
    var obszar = String(row[3] || "").trim();
    var nazwaUrzadzenia = String(row[4] || "").trim();
    var dataWykonania = row[5];
    var wykonawca = String(row[6] || "").trim();

    var valH = String(row[7] || "").trim();
    var valI = String(row[8] || "").trim();
    var valJ = String(row[9] || "").trim();
    var valK = String(row[10] || "").trim();

    var czasPracy = 1, wynik = "OK", opisPrac = "", uwagi = "";

    // Heurystyka dla starych wierszy z przesuniętymi kolumnami
    if (isNaN(parseFloat(valH)) || valH.toLowerCase().indexOf("przegląd") !== -1 || valH.toLowerCase() === "ok") {
      czasPracy = 1;
      wynik = (valI.toUpperCase() === "NOK" || valJ.toUpperCase() === "NOK") ? "NOK" : "OK";
      opisPrac = valH;
      if (valJ && valJ !== "-") opisPrac += " " + valJ;
      uwagi = (valK && valK !== "-") ? valK : "-";
      if (wynik === "NOK" && uwagi === "-") uwagi = valJ || "Wymaga naprawy";
    } else {
      czasPracy = parseFloat(valH) || 1;
      wynik = (valI.toUpperCase() === "NOK") ? "NOK" : "OK";
      opisPrac = valJ;
      uwagi = valK;
    }

    // Czyszczenie szumu po migracji ("- | [⚠️ ID historyczne ...]")
    uwagi = oczyscUwagi_(uwagi);

    newRows.push([idWpisu, idPrzegladu, idUrzadzenia, obszar, nazwaUrzadzenia,
                  dataWykonania, wykonawca, czasPracy, wynik, opisPrac, uwagi]);
  }

  // --- ZAPIS ---
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });

  sheet.getRange(2, 1, numRows, 11).clearContent();
  sheet.getRange("A2:C").setNumberFormat("@");
  sheet.getRange(2, 1, newRows.length, 11).setValues(newRows);

  // --- FORMATOWANIE (zakresy otwarte "A2:A" obejmują też przyszłe wiersze) ---
  sheet.getRange(1, 1, 1, 11).setValues([NAGLOWKI_REJESTR])
       .setFontWeight("bold").setFontSize(10)
       .setBackground(KOLOR_NAGLOWKA).setFontColor("#ffffff")
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  sheet.getRange("A2:K").setBackground(null).setVerticalAlignment("middle").setFontSize(10)
       .setFontColor("#0f172a").setFontStyle("normal").setBorder(false, false, false, false, false, false);
  sheet.getRange("A2:A").setHorizontalAlignment("center").setFontSize(9).setFontColor("#64748b");
  sheet.getRange("B2:C").setHorizontalAlignment("center");
  sheet.getRange("D2:D").setHorizontalAlignment("left");
  sheet.getRange("E2:E").setHorizontalAlignment("left").setFontWeight("bold").setWrap(true);
  sheet.getRange("F2:F").setHorizontalAlignment("center").setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange("G2:G").setHorizontalAlignment("left");
  sheet.getRange("H2:H").setHorizontalAlignment("center").setNumberFormat("0.0");
  sheet.getRange("I2:I").setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange("J2:K").setHorizontalAlignment("left").setWrap(true).setFontSize(9);

  sheet.getRange(2, 1, newRows.length, 11)
       .setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("A2:K").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  var ruleWynik = SpreadsheetApp.newDataValidation()
    .requireValueInList(["OK", "NOK"], true).setAllowInvalid(true).build();
  sheet.getRange("I2:I").setDataValidation(ruleWynik);

  sheet.clearConditionalFormatRules();
  var rI = sheet.getRange("I2:I");
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK")
      .setBackground("#d1fae5").setFontColor("#065f46").setBold(true).setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("NOK")
      .setBackground("#fee2e2").setFontColor("#991b1b").setBold(true).setRanges([rI]).build(),
    // Wpisy ze starego systemu (ID w formacie PRZ-2026-002) - wyszarzone, żeby nie myliły
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($B2,"^PRZ-\\d{4}-\\d+$")')
      .setFontColor("#94a3b8").setItalic(true).setRanges([sheet.getRange("A2:K")]).build()
  ]);

  sheet.setFrozenColumns(5); sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 230);
  sheet.setColumnWidth(6, 135);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 65);
  sheet.setColumnWidth(9, 70);
  sheet.setColumnWidth(10, 240);
  sheet.setColumnWidth(11, 220);

  sheet.getRange(1, 1, sheet.getLastRow(), 11).createFilter();
  sheet.getRange("B1").setNote("Szare, pochyłe wiersze = wpisy ze starego systemu (ID w formacie PRZ-2026-002).\n" +
    "Dotyczyły grup urządzeń (np. 1.1-1.9), więc nie mają odpowiednika w nowym harmonogramie. Zostają jako archiwum.");
}

/* ==========================================================================
 *  DASHBOARD
 * ========================================================================== */
 /**
 * Dashboard CMMS
 *
 * POPRAWKA WSKAŹNIKA: "Realizacja planu" liczy teraz przeglądy wykonane w stosunku do
 * przeglądów, których termin już minął (a nie udział wyników OK w Rejestrze).
 * Poprzednia formuła COUNTIF(OK)/COUNTA(Rejestr) dawała ~63% niezależnie od tego,
 * ile z 2000 zaplanowanych pozycji faktycznie zrobiono.
 */
function utworzDashboardCMMS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try { oznaczZalegleePrzeglady(); } catch (e) { Logger.log("oznaczZalegle: " + e.message); }

  var dash = ss.getSheetByName("0. Dashboard CMMS");
  if (!dash) {
    dash = ss.insertSheet("0. Dashboard CMMS", 0);
  } else {
    dash.getCharts().forEach(function (c) { dash.removeChart(c); });
    dash.showColumns(1, dash.getMaxColumns());
    dash.getRange(1, 1, dash.getMaxRows(), dash.getMaxColumns()).breakApart();
    dash.clear();
    dash.clearConditionalFormatRules();
  }
  dash.setHiddenGridlines(true);

  var arkUst = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  var nazwaUst = arkUst ? arkUst.getName() : "4. Usterki i Awarie";
  var H = "'2. Harmonogram'!";
  var R = "'3. Rejestr Przeglądów'!";
  var U = "'" + nazwaUst + "'!";
  var tz = ss.getSpreadsheetTimeZone();

  for (var c = 1; c <= 8; c++) dash.setColumnWidth(c, 125);

  // --- NAGŁÓWEK ---
  dash.getRange("A1:H1").merge().setValue("📊 DASHBOARD UTRZYMANIA RUCHU — CMMS HOLCIM KRAKÓW")
      .setFontWeight("bold").setFontSize(15).setBackground(KOLOR_NAGLOWKA).setFontColor("#ffffff")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.setRowHeight(1, 46);
  dash.getRange("A2:H2").merge()
      .setValue("Stan na " + Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm") +
                "   •   Plan 18.09 – 31.12.2026   •   Liczby liczą się na bieżąco, wykresy po odświeżeniu")
      .setFontSize(9).setFontStyle("italic").setFontColor("#64748b").setHorizontalAlignment("center");

  // --- KAFELKI (formuły liczone na żywo z harmonogramu) ---
  var doDzis = 'COUNTIFS(' + H + 'G2:G,"<="&TODAY())';
  var wykDoDzis = 'COUNTIFS(' + H + 'G2:G,"<="&TODAY(),' + H + 'I2:I,"Wykonany")';

  kafelekDashboard_(dash, 4, 1, "REALIZACJA PLANU (do dziś)", "=IFERROR(" + wykDoDzis + "/" + doDzis + ",0)", "0.0%", "#1e40af");
  kafelekDashboard_(dash, 4, 3, "NA DZIŚ (wykonane / plan)",
    '=COUNTIFS(' + H + 'G2:G,TODAY(),' + H + 'I2:I,"Wykonany")&" / "&COUNTIFS(' + H + 'G2:G,TODAY())', null, "#0f172a");
  kafelekDashboard_(dash, 4, 5, "PRZEGLĄDY ZALEGŁE",
    '=COUNTIFS(' + H + 'G2:G,"<"&TODAY(),' + H + 'I2:I,"<>Wykonany")', "#,##0", "#b45309");
  kafelekDashboard_(dash, 4, 7, "OTWARTE USTERKI",
    '=COUNTIFS(' + U + 'A2:A,"<>",' + U + 'I2:I,"<>Usunięta")', "#,##0", "#dc2626");

  kafelekDashboard_(dash, 7, 1, "ROZLICZONE PRZEGLĄDY (Rejestr)", '=COUNTA(' + R + 'A2:A)', "#,##0", "#0f172a");
  kafelekDashboard_(dash, 7, 3, "PLAN ŁĄCZNIE", '=COUNTA(' + H + 'A2:A)', "#,##0", "#0f172a");
  kafelekDashboard_(dash, 7, 5, "SUMA PRACY TECHNIKÓW", '=SUM(' + R + 'H2:H)', '0.0 "h"', "#059669");
  kafelekDashboard_(dash, 7, 7, "ŚREDNI CZAS PRZEGLĄDU", '=IFERROR(AVERAGE(' + R + 'H2:H),0)', '0.00 "h"', "#059669");

  dash.setRowHeight(4, 26); dash.setRowHeight(5, 52);
  dash.setRowHeight(7, 26); dash.setRowHeight(8, 52);

  // --- TABELA: REALIZACJA WG OBSZARU ---
  dash.getRange("A10:H10").merge().setValue("REALIZACJA WG OBSZARU")
      .setFontWeight("bold").setFontSize(11).setFontColor("#ffffff").setBackground("#334155")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
  dash.setRowHeight(10, 30);

  dash.getRange("A11:B11").merge().setValue("Obszar");
  dash.getRange("C11").setValue("Do dziś");
  dash.getRange("D11").setValue("Wykonane");
  dash.getRange("E11").setValue("Zaległe");
  dash.getRange("F11").setValue("Realizacja");
  dash.getRange("G11:H11").merge().setValue("Otwarte usterki");
  dash.getRange("A11:H11").setFontWeight("bold").setFontSize(9).setFontColor("#475569")
      .setBackground("#f1f5f9").setHorizontalAlignment("center");

  var obszary = Object.keys(KOLORY_OBSZAROW);
  for (var i = 0; i < obszary.length; i++) {
    var r = 12 + i;
    var o = '$A' + r;
    dash.getRange(r, 1, 1, 2).merge().setValue(obszary[i])
        .setBackground(kolorObszaru_(obszary[i])).setFontWeight("bold").setHorizontalAlignment("left");
    dash.getRange(r, 3).setFormula('=COUNTIFS(' + H + 'C2:C,' + o + ',' + H + 'G2:G,"<="&TODAY())');
    dash.getRange(r, 4).setFormula('=COUNTIFS(' + H + 'C2:C,' + o + ',' + H + 'G2:G,"<="&TODAY(),' + H + 'I2:I,"Wykonany")');
    dash.getRange(r, 5).setFormula('=COUNTIFS(' + H + 'C2:C,' + o + ',' + H + 'G2:G,"<"&TODAY(),' + H + 'I2:I,"<>Wykonany")');
    dash.getRange(r, 6).setFormula('=IFERROR(D' + r + '/C' + r + ',0)');
    dash.getRange(r, 7, 1, 2).merge()
        .setFormula('=COUNTIFS(' + U + 'D2:D,"*"&' + o + '&"*",' + U + 'I2:I,"<>Usunięta",' + U + 'A2:A,"<>")');
  }
  var rs = 12 + obszary.length;
  dash.getRange(rs, 1, 1, 2).merge().setValue("RAZEM").setFontWeight("bold");
  dash.getRange(rs, 3).setFormula('=SUM(C12:C' + (rs - 1) + ')');
  dash.getRange(rs, 4).setFormula('=SUM(D12:D' + (rs - 1) + ')');
  dash.getRange(rs, 5).setFormula('=SUM(E12:E' + (rs - 1) + ')');
  dash.getRange(rs, 6).setFormula('=IFERROR(D' + rs + '/C' + rs + ',0)');
  dash.getRange(rs, 7, 1, 2).merge().setFormula('=SUM(G12:G' + (rs - 1) + ')');
  dash.getRange(rs, 1, 1, 8).setBackground("#f1f5f9").setFontWeight("bold");

  dash.getRange(12, 3, obszary.length + 1, 3).setNumberFormat("#,##0").setHorizontalAlignment("center");
  dash.getRange(12, 6, obszary.length + 1, 1).setNumberFormat("0%").setHorizontalAlignment("center").setFontWeight("bold");
  dash.getRange(12, 7, obszary.length + 1, 2).setNumberFormat("#,##0").setHorizontalAlignment("center");
  dash.getRange(11, 1, obszary.length + 2, 8)
      .setBorder(true, true, true, true, true, true, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID)
      .setVerticalAlignment("middle");

  // Kolory realizacji: <50% czerwony, 50–80% bursztynowy, ≥80% zielony (tylko gdy jest co liczyć)
  var rF = dash.getRange(12, 6, obszary.length + 1, 1);
  var rA5 = dash.getRange("A5");
  dash.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($C12>0,$F12<0.5)')
      .setBackground("#fee2e2").setFontColor("#991b1b").setRanges([rF]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($C12>0,$F12<0.8)')
      .setBackground("#fef3c7").setFontColor("#92400e").setRanges([rF]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C12>0')
      .setBackground("#d1fae5").setFontColor("#065f46").setRanges([rF]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.5)
      .setFontColor("#dc2626").setRanges([rA5]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.8)
      .setFontColor("#b45309").setRanges([rA5]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0.8)
      .setFontColor("#059669").setRanges([rA5]).build()
  ]);

  // --- DANE DO WYKRESÓW (ukryte kolumny J:K) ---
  dash.getRange("J1:K1").setValues([["Wynik", "Liczba"]]);
  dash.getRange("J2").setValue("OK");
  dash.getRange("K2").setFormula('=COUNTIF(' + R + 'I2:I,"OK")');
  dash.getRange("J3").setValue("NOK");
  dash.getRange("K3").setFormula('=COUNTIF(' + R + 'I2:I,"NOK")');

  dash.getRange("J5:K5").setValues([["Obszar", "Zgłoszone usterki"]]);
  for (var j = 0; j < obszary.length; j++) {
    dash.getRange(6 + j, 10).setValue(obszary[j]);
    dash.getRange(6 + j, 11).setFormula('=COUNTIFS(' + U + 'D2:D,"*"&J' + (6 + j) + '&"*",' + U + 'A2:A,"<>")');
  }
  var ostatniWierszWykresu = 5 + obszary.length;

  try {
    var pieChart = dash.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(dash.getRange("J1:K3"))
      .setNumHeaders(1)
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setPosition(rs + 2, 1, 0, 0)
      .setOption('title', 'Wyniki przeglądów: OK vs NOK')
      .setOption('pieHole', 0.45)
      .setOption('slices', { 0: { color: '#10b981' }, 1: { color: '#ef4444' } })
      .setOption('legend', { position: 'right' })
      .setOption('width', 480)
      .setOption('height', 300)
      .build();

    var barChart = dash.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(dash.getRange("J5:K" + ostatniWierszWykresu))
      .setNumHeaders(1)
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setPosition(rs + 2, 5, 20, 0)
      .setOption('title', 'Zgłoszone usterki wg obszaru')
      .setOption('colors', ['#dc2626'])
      .setOption('legend', { position: 'none' })
      .setOption('width', 480)
      .setOption('height', 300)
      .build();

    dash.insertChart(pieChart);
    dash.insertChart(barChart);
  } catch (errChart) {
    Logger.log("Błąd generowania wykresów: " + errChart.message);
  }

  dash.hideColumns(10, 2);
  dash.setFrozenRows(2);
}

/**
 * Liczy rzeczywiste wskaźniki realizacji na podstawie "2. Harmonogram".
 */
function policzStatystykiHarmonogramu_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var wynik = { wszystkie: 0, doDzis: 0, wykonane: 0, zalegle: 0 };

  var sheet = ss.getSheetByName("2. Harmonogram");
  if (!sheet || sheet.getLastRow() < 2) return wynik;

  var dzis = new Date();
  dzis.setHours(0, 0, 0, 0);

  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getDisplayValues();
  for (var i = 0; i < dane.length; i++) {
    if (!String(dane[i][0] || "").trim()) continue;
    wynik.wszystkie++;

    var d = new Date(String(dane[i][6] || "").trim());
    if (isNaN(d.getTime())) continue;
    d.setHours(0, 0, 0, 0);

    var status = String(dane[i][8] || "").trim().toLowerCase();

    if (d.getTime() <= dzis.getTime()) {
      wynik.doDzis++;
      if (status === "wykonany") wynik.wykonane++;
      else if (d.getTime() < dzis.getTime()) wynik.zalegle++;
    } else if (status === "wykonany") {
      wynik.wykonane++; // wykonany przed terminem - też się liczy
    }
  }
  return wynik;
}

function przygotujSrodowiskoCMMS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Porządkuję arkusze… to może potrwać do 2 minut.", "🎨 CMMS", 10);

  var urz = ss.getSheetByName("1. Urządzenia");
  if (urz) formatujArkuszUrzadzen_(urz);

  naprawStruktureWszystkichHarmonogramow();
  naprawStruktureRejestruPrzegladow();
  formatujArkuszUsterek();
  oznaczZalegleePrzeglady();
  utworzDashboardCMMS();
  uporzadkujZakladki_();

  ss.toast("Gotowe – wszystkie arkusze uporządkowane.", "🎨 CMMS", 5);
}

/* ==========================================================================
 *  NARZĘDZIA SERWISOWE (NOWE) - diagnostyka i naprawa danych
 * ========================================================================== */

/**
 * Wyszukuje zduplikowane ID urządzeń w karcie urządzeń.
 */
function znajdzDuplikatyIdUrzadzen_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getDisplayValues();
  var licznik = {};
  var duplikaty = [];

  for (var i = 0; i < dane.length; i++) {
    var id = normalizujId_(dane[i][0]);
    if (!id) continue;
    licznik[id] = (licznik[id] || 0) + 1;
    if (licznik[id] === 2) duplikaty.push(String(dane[i][0]).trim());
  }
  return duplikaty;
}

/**
 * RAPORT DIAGNOSTYCZNY - pokazuje stan spójności danych bez wprowadzania zmian.
 * Dobre do pokazania "przed / po" przy rozliczaniu Fazy Operacyjnej.
 */
function diagnostykaDanychCMMS() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raport = [];

  // 1. Urządzenia
  var sheetUrz = ss.getSheetByName("1. Urządzenia");
  var liczbaUrz = sheetUrz && sheetUrz.getLastRow() > 1 ? sheetUrz.getLastRow() - 1 : 0;
  var duplikaty = znajdzDuplikatyIdUrzadzen_(sheetUrz);
  raport.push("🏗️ URZĄDZENIA: " + liczbaUrz + " wierszy");
  raport.push(duplikaty.length === 0
    ? "   ✅ ID unikalne"
    : "   ⛔ Zduplikowane ID (" + duplikaty.length + "): " + duplikaty.join(", "));

  // format kolumny A
  if (sheetUrz && liczbaUrz > 0) {
    var formaty = sheetUrz.getRange(2, 1, liczbaUrz, 1).getNumberFormats();
    var nieTekst = 0;
    for (var f = 0; f < formaty.length; f++) if (formaty[f][0] !== "@") nieTekst++;
    raport.push(nieTekst === 0 ? "   ✅ Kolumna ID w formacie tekstowym" : "   ⚠️ " + nieTekst + " komórek ID NIE jest tekstem (ryzyko 1.10 → 1,1)");
  }

  // 2. Harmonogram
  var stat = policzStatystykiHarmonogramu_(ss);
  raport.push("");
  raport.push("📅 HARMONOGRAM: " + stat.wszystkie + " pozycji");
  raport.push("   • Termin już minął: " + stat.doDzis);
  raport.push("   • Wykonane: " + stat.wykonane);
  raport.push("   • Zaległe: " + stat.zalegle);
  raport.push("   • Realizacja planu: " + (stat.doDzis > 0 ? Math.round(stat.wykonane / stat.doDzis * 1000) / 10 : 0) + "%");

  // 3. Rejestr - spójność ID
  var sheetRej = ss.getSheetByName("3. Rejestr Przeglądów");
  raport.push("");
  if (sheetRej && sheetRej.getLastRow() > 1) {
    var idHarm = {};
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      if (!czyArkuszHarmonogramu_(sheets[s].getName())) continue;
      if (sheets[s].getLastRow() < 2) continue;
      var kol = sheets[s].getRange(2, 1, sheets[s].getLastRow() - 1, 1).getDisplayValues();
      for (var k = 0; k < kol.length; k++) idHarm[normalizujId_(kol[k][0])] = true;
    }

    var rej = sheetRej.getRange(2, 2, sheetRej.getLastRow() - 1, 1).getDisplayValues();
    var pasuje = 0, sieroty = 0;
    for (var r = 0; r < rej.length; r++) {
      var id = normalizujId_(rej[r][0]);
      if (!id) continue;
      if (idHarm[id]) pasuje++; else sieroty++;
    }
    raport.push("📋 REJESTR PRZEGLĄDÓW: " + (pasuje + sieroty) + " wpisów");
    raport.push("   ✅ Powiązane z harmonogramem: " + pasuje);
    raport.push(sieroty === 0 ? "   ✅ Brak wpisów osieroconych" : "   🗄️ Archiwum starego systemu (grupy maszyn): " + sieroty + "");
  } else {
    raport.push("📋 REJESTR PRZEGLĄDÓW: brak danych");
  }

  // 4. Usterki - poprawność ID urządzenia
  var sheetUst = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  raport.push("");
  if (sheetUst && sheetUst.getLastRow() > 1) {
    var mapaUrz = pobierzMapeUrzadzen_(ss);
    var ust = sheetUst.getRange(2, 1, sheetUst.getLastRow() - 1, 12).getDisplayValues();
    var ok = 0, zle = 0, przes = 0;
    for (var u = 0; u < ust.length; u++) {
      if (!String(ust[u][0]).trim()) continue;
      if (czyWierszUsterkiPrzesuniety_(ust[u])) { przes++; continue; }
      if (mapaUrz[normalizujId_(ust[u][2])]) ok++; else zle++;
    }
    raport.push("🚨 USTERKI: " + (ok + zle + przes) + " zgłoszeń");
    raport.push("   ✅ Poprawne ID urządzenia: " + ok);
    raport.push(przes === 0 ? "   ✅ Układ kolumn poprawny" : "   ⛔ Wiersze w starym układzie kolumn: " + przes + " → 'Napraw ID urządzeń w Usterkach'");
    raport.push(zle === 0 ? "   ✅ Brak błędnych powiązań" : "   ⚠️ Puste / grupowe ID urządzenia: " + zle + " (pomarańczowe pola do uzupełnienia)");
  } else {
    raport.push("🚨 USTERKI: brak danych");
  }

  SpreadsheetApp.getUi().alert("🧪 DIAGNOSTYKA DANYCH CMMS\n\n" + raport.join("\n"));
  Logger.log(raport.join("\n"));
}

/**
 * NAPRAWA FORMATU ID URZĄDZEŃ
 *
 * Przyczyna problemu: ID wpisywane jako "1.10" bez formatu tekstowego są przez Sheets
 * zamieniane na liczbę 1,1 - przez co "1.10" i "1.1" stają się jednym ID (8 kolizji w Krakowie).
 * Naprawa polega na odtworzeniu karty urządzeń z kolumną w formacie tekstowym.
 */
function naprawFormatIdUrzadzen__zapis() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetUrz = ss.getSheetByName("1. Urządzenia");
  var duplikaty = znajdzDuplikatyIdUrzadzen_(sheetUrz);

  var odp = ui.alert(
    "🔧 Naprawa formatu ID urządzeń",
    "Wykryte duplikaty ID: " + (duplikaty.length ? duplikaty.join(", ") : "brak") + "\n\n" +
    "Karta urządzeń zostanie odtworzona ze wzorca w skrypcie, z kolumną ID w formacie TEKSTOWYM.\n" +
    "Harmonogram i rozliczenia NIE zostaną skasowane.\n\nKontynuować?",
    ui.ButtonSet.YES_NO);

  if (odp !== ui.Button.YES) return;

  aktualizujKarteUrzadzenKrakow(ss);

  var poNaprawie = znajdzDuplikatyIdUrzadzen_(ss.getSheetByName("1. Urządzenia"));
  ui.alert(poNaprawie.length === 0
    ? "✅ Gotowe. Wszystkie ID urządzeń są unikalne i zapisane jako tekst.\n\nNastępny krok: 📅 Wygeneruj Harmonogram 2026."
    : "⚠️ Nadal występują duplikaty: " + poNaprawie.join(", "));
}
/**
 * MIGRACJA STARYCH ID PRZEGLĄDÓW
 *
 * Stare wpisy w Rejestrze mają ID w formacie PRZ-2026-002 (licznik), którego nie ma już
 * w harmonogramie. Funkcja dopasowuje je po nazwie urządzenia i dacie wykonania
 * do nowych, stabilnych ID (PRZ-<urządzenie>-<data>) i przepisuje kolumnę B.
 * Wpisy, których nie da się dopasować, są oznaczane w kolumnie "Uwagi" - nic nie jest kasowane.
 */
function migrujStareIdPrzegladow__zapis() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetRej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (!sheetRej || sheetRej.getLastRow() < 2) {
    ui.alert("Brak danych w Rejestrze Przeglądów.");
    return;
  }

  // Indeks harmonogramu: nazwa urządzenia -> lista {id, data}
  var indeks = {};
  var idIstniejace = {};
  var sheets = ss.getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    if (!czyArkuszHarmonogramu_(sh.getName())) continue;
    if (sh.getLastRow() < 2) continue;

    var dane = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getDisplayValues();
    for (var i = 0; i < dane.length; i++) {
      var idP = String(dane[i][0]).trim();
      if (!idP) continue;
      idIstniejace[normalizujId_(idP)] = true;

      var klucz = normalizujId_(dane[i][3]); // nazwa urządzenia
      if (!indeks[klucz]) indeks[klucz] = [];
      indeks[klucz].push({ id: idP, data: String(dane[i][6]).trim(), idUrz: String(dane[i][1]).trim() });
    }
  }

  var n = sheetRej.getLastRow() - 1;
  var kolB = sheetRej.getRange(2, 2, n, 1).getDisplayValues();
  var dane = sheetRej.getRange(2, 1, n, 11).getDisplayValues();

  var zmienione = 0, juzOk = 0, nieDopasowane = 0;
  var noweB = [];
  var noweUwagi = [];

  for (var r = 0; r < n; r++) {
    var stareId = String(kolB[r][0]).trim();
    var uwagi = String(dane[r][10] || "").trim();

    if (!stareId) { noweB.push([""]); noweUwagi.push([uwagi]); continue; }

    if (idIstniejace[normalizujId_(stareId)]) {
      juzOk++;
      noweB.push([stareId]);
      noweUwagi.push([uwagi]);
      continue;
    }

    // próba dopasowania po nazwie urządzenia + dacie wykonania
    var nazwa = normalizujId_(dane[r][4]);
    var dataWyk = String(dane[r][5] || "").substring(0, 10);
    var kandydaci = indeks[nazwa] || [];
    var trafienie = null;

    for (var k = 0; k < kandydaci.length; k++) {
      if (kandydaci[k].data === dataWyk) { trafienie = kandydaci[k]; break; }
    }
    // jeśli nie ma na ten sam dzień - bierzemy najbliższy wcześniejszy termin planowany
    if (!trafienie && kandydaci.length > 0 && dataWyk) {
      var najlepszy = null;
      for (var k2 = 0; k2 < kandydaci.length; k2++) {
        if (kandydaci[k2].data <= dataWyk && (!najlepszy || kandydaci[k2].data > najlepszy.data)) {
          najlepszy = kandydaci[k2];
        }
      }
      trafienie = najlepszy;
    }

    if (trafienie) {
      noweB.push([trafienie.id]);
      noweUwagi.push([oczyscUwagi_(uwagi + " | [stare ID: " + stareId + "]")]);
      zmienione++;
    } else {
      noweB.push([stareId]);
      noweUwagi.push([oczyscUwagi_(uwagi)]); // archiwum - wyróżnione formatowaniem w Rejestrze
      nieDopasowane++;
    }
  }

  sheetRej.getRange(2, 2, n, 1).setNumberFormat("@").setValues(noweB);
  sheetRej.getRange(2, 11, n, 1).setValues(noweUwagi);

  ui.alert("🔁 MIGRACJA ID PRZEGLĄDÓW\n\n" +
    "Przepisane na nowe ID: " + zmienione + "\n" +
    "Już poprawne: " + juzOk + "\n" +
    "Bez dopasowania (archiwum – wyszarzone w Rejestrze): " + nieDopasowane + "\n\n" +
    "Nic nie zostało usunięte.");
  naprawStruktureRejestruPrzegladow();
}

/**
 * NAPRAWA ID URZĄDZEŃ W ARKUSZU USTEREK
 *
 * W kolumnie "ID Urządzenia" zdarzały się nazwy obszarów zamiast ID (np. "Kompresory").
 * Funkcja próbuje odtworzyć właściwe ID po nazwie urządzenia z karty urządzeń.
 */
function naprawUsterkiIdUrzadzen__zapis() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert("Brak danych w arkuszu usterek.");
    return;
  }

  var mapaUrz = pobierzMapeUrzadzen_(ss);
  var n = sheet.getLastRow() - 1;
  var dane = sheet.getRange(2, 1, n, 12).getDisplayValues();
  var wynik = [];
  var przesuniete = 0, naprawione = 0, poprawne = 0, grupowe = 0, doRecznej = 0;

  for (var i = 0; i < n; i++) {
    var w = dane[i].slice();
    if (!String(w[0]).trim()) { wynik.push(w); continue; }

    // 1) Wiersze w starym układzie 11 kolumn (brak kolumny "ID Urządzenia") - przesuwamy o 1 w prawo
    if (czyWierszUsterkiPrzesuniety_(w)) {
      w = [w[0], w[1], "", w[2], w[3], w[4], w[5], w[6], w[7], w[8], w[9], w[10]];
      przesuniete++;
    }

    var id = String(w[2]).trim();

    // 2) Poprawne ID z karty urządzeń
    if (id && mapaUrz[normalizujId_(id)]) {
      if (!String(w[3]).trim()) w[3] = mapaUrz[normalizujId_(id)].obszar;
      poprawne++;
    }
    // 3) ID grupowe ze starego systemu (np. "5.1-5.2") - zostawiamy, to realna informacja
    else if (/^\d+\.\d+\s*-\s*\d+\.\d+$/.test(id)) {
      grupowe++;
    }
    // 4) Próba odtworzenia ID po nazwie urządzenia
    else {
      var u = znajdzUrzadzeniePoNazwie_(w[4], mapaUrz, w[3]);
      if (u) {
        w[2] = u.id;
        w[3] = u.obszar;
        naprawione++;
      } else {
        // w kolumnie ID siedziała nazwa obszaru (np. "Kompresory") - przenosimy ją tam, gdzie jej miejsce
        if (id && !String(w[3]).trim()) w[3] = id;
        w[2] = "";
        doRecznej++;
      }
    }
    wynik.push(w);
  }

  sheet.getRange(2, 3, n, 1).setNumberFormat("@");
  sheet.getRange(2, 1, n, 12).setValues(wynik);
  formatujArkuszUsterek(sheet);

  ui.alert("🔗 NAPRAWA ARKUSZA USTEREK\n\n" +
    "Wiersze wyrównane (stary układ kolumn): " + przesuniete + "\n" +
    "ID odtworzone po nazwie urządzenia: " + naprawione + "\n" +
    "Już poprawne: " + poprawne + "\n" +
    "ID grupowe ze starego systemu (np. 5.1-5.2): " + grupowe + "\n" +
    "Do ręcznego uzupełnienia (pomarańczowe pole): " + doRecznej);
}

/* ==========================================================================
 *  CZYTELNOŚĆ I WYGODA (NOWE W V4.1)
 * ========================================================================== */

/**
 * Kolor tła dla obszaru (ten sam w karcie urządzeń i na dashboardzie).
 */
function kolorObszaru_(obszar) {
  return KOLORY_OBSZAROW[String(obszar || "").trim()] || "#f1f5f9";
}

/**
 * Kafelek KPI na dashboardzie: etykieta (1 wiersz) + wartość (1 wiersz), szerokość 2 kolumn.
 */
function kafelekDashboard_(dash, wiersz, kolumna, etykieta, formula, format, kolor) {
  dash.getRange(wiersz, kolumna, 1, 2).merge()
      .setValue(etykieta).setFontSize(9).setFontWeight("bold").setFontColor("#64748b")
      .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#f8fafc");

  var w = dash.getRange(wiersz + 1, kolumna, 1, 2).merge();
  w.setFormula(formula);
  if (format) w.setNumberFormat(format);
  w.setFontSize(24).setFontWeight("bold").setFontColor(kolor)
   .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#ffffff");

  dash.getRange(wiersz, kolumna, 2, 2)
      .setBorder(true, true, true, true, null, null, "#cbd5e1", SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Formatowanie karty urządzeń (bez kasowania danych).
 */
function formatujArkuszUrzadzenV4_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  if (sheet.getFilter()) sheet.getFilter().remove();

  sheet.getRange(1, 1, 1, 6)
       .setValues([["ID Urządzenia", "Sekcja / Obszar", "Nazwa Urządzenia", "Zakres Czynności Przeglądowych", "Częstotliwość", "Kod QR"]])
       .setFontWeight("bold").setFontSize(10)
       .setBackground(KOLOR_NAGLOWKA).setFontColor("#ffffff")
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  var n = lastRow - 1;
  if (n < 1) return;
  var dane = sheet.getRange(2, 1, n, 6);

  dane.setVerticalAlignment("middle").setFontSize(10);
  sheet.getRange(2, 1, n, 1).setNumberFormat("@").setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange(2, 2, n, 1).setHorizontalAlignment("left").setFontWeight("bold").setFontSize(9);
  sheet.getRange(2, 3, n, 1).setHorizontalAlignment("left").setFontWeight("bold").setWrap(true);
  sheet.getRange(2, 4, n, 1).setHorizontalAlignment("left").setWrap(true).setFontSize(9);
  sheet.getRange(2, 5, n, 1).setHorizontalAlignment("center");
  sheet.getRange(2, 6, n, 1).setHorizontalAlignment("center");

  // Kolor sekcji w kolumnie B - od razu widać, gdzie kończy się jeden obszar a zaczyna drugi
  var obszary = sheet.getRange(2, 2, n, 1).getDisplayValues();
  var tla = [];
  for (var i = 0; i < n; i++) {
    tla.push(["#ffffff", kolorObszaru_(obszary[i][0]), "#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
  }
  dane.setBackgrounds(tla);
  dane.setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);

  // Wiersz musi być wyższy niż kod QR (70 px), inaczej obrazek jest ucinany
  sheet.setRowHeights(2, n, 80);

  sheet.setFrozenColumns(3);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 320);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 95);

  sheet.getRange(1, 1, lastRow, 6).createFilter();
}

/**
 * Formatowanie arkusza "4. Usterki i Awarie" - wcześniej nie miał żadnego formatowania.
 * Zakresy otwarte (np. "I2:I") obejmują też usterki dopisane w przyszłości.
 */
function formatujArkuszUsterekV4_(sheet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet || typeof sheet.getName !== "function") {
    sheet = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  }
  if (!sheet) return;

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.clearConditionalFormatRules();

  sheet.getRange(1, 1, 1, 12).setValues([NAGLOWKI_USTERKI])
       .setFontWeight("bold").setFontSize(10)
       .setBackground("#991b1b").setFontColor("#ffffff")
       .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  sheet.getRange("A2:L").setBackground(null).setVerticalAlignment("middle").setFontSize(10)
       .setFontColor("#0f172a").setFontWeight("normal").setWrap(false);
  sheet.getRange("A2:A").setHorizontalAlignment("center").setFontSize(9).setFontColor("#64748b");
  sheet.getRange("B2:B").setHorizontalAlignment("center").setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange("C2:C").setHorizontalAlignment("center").setNumberFormat("@").setFontWeight("bold");
  sheet.getRange("D2:D").setHorizontalAlignment("left");
  sheet.getRange("E2:E").setHorizontalAlignment("left").setFontWeight("bold").setWrap(true);
  sheet.getRange("F2:F").setHorizontalAlignment("left").setWrap(true);
  sheet.getRange("G2:G").setHorizontalAlignment("center");
  sheet.getRange("H2:H").setHorizontalAlignment("left");
  sheet.getRange("I2:I").setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange("J2:J").setHorizontalAlignment("left");
  sheet.getRange("K2:K").setHorizontalAlignment("center").setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange("L2:L").setHorizontalAlignment("left").setWrap(true);

  var ostatni = Math.max(sheet.getLastRow(), 2);
  sheet.getRange(2, 1, ostatni - 1, 12)
       .setBorder(true, true, true, true, true, true, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange("A2:L").applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  // Listy rozwijane
  sheet.getRange("I2:I").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["Zgłoszona", "W trakcie", "Usunięta"], true).setAllowInvalid(true).build());
  sheet.getRange("G2:G").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["Niski", "Średni", "Wysoki"], true).setAllowInvalid(true).build());

  var rC = sheet.getRange("C2:C");
  var rG = sheet.getRange("G2:G");
  var rI = sheet.getRange("I2:I");
  var rAH = sheet.getRange("A2:H");

  sheet.setConditionalFormatRules([
    // Brak ID urządzenia - pomarańczowe pole do uzupełnienia
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$C2="")')
      .setBackground("#fed7aa").setRanges([rC]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Zgłoszona")
      .setBackground("#fee2e2").setFontColor("#991b1b").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("W trakcie")
      .setBackground("#fef3c7").setFontColor("#92400e").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Usunięta")
      .setBackground("#d1fae5").setFontColor("#065f46").setRanges([rI]).build(),
    // Usunięte - wiersz wyszarzony
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I2="Usunięta"')
      .setFontColor("#94a3b8").setRanges([rAH]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Wysoki")
      .setFontColor("#dc2626").setBold(true).setRanges([rG]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Średni")
      .setFontColor("#b45309").setBold(true).setRanges([rG]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Niski")
      .setFontColor("#64748b").setRanges([rG]).build()
  ]);

  sheet.setFrozenColumns(5);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 75);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 190);
  sheet.setColumnWidth(6, 210);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 130);
  sheet.setColumnWidth(9, 105);
  sheet.setColumnWidth(10, 130);
  sheet.setColumnWidth(11, 125);
  sheet.setColumnWidth(12, 200);
  sheet.getRange(1, 1, ostatni, 12).createFilter();

  sheet.getRange("C1").setNote("Pomarańczowe pole = brak ID urządzenia. Uzupełnij ręcznie (np. 4.1) – " +
    "bez tego usterka nie trafi do historii awaryjności maszyny.");
  sheet.getRange("I1").setNote("Po zmianie statusu na „Usunięta” data usunięcia wpisze się sama.");
}

/**
 * Stary układ arkusza usterek miał 11 kolumn (bez "ID Urządzenia").
 * Rozpoznajemy go po tym, że status stoi w kolumnie H, a kolumna I jest pusta.
 */
function czyWierszUsterkiPrzesuniety_(w) {
  var statusy = ["ZGŁOSZONA", "WTRAKCIE", "USUNIĘTA", "ZAMKNIĘTA"];
  return !String(w[8] || "").trim() && statusy.indexOf(normalizujId_(w[7])) !== -1;
}

/**
 * Wiersz z "4. Usterki i Awarie" w jednym, aktualnym układzie kolumn.
 * Stare wpisy (bez kolumny "ID Urządzenia" - wszystko przesunięte o jedną w lewo) są wyrównywane,
 * a maszyna jest szukana po nazwie. Zwraca kopię wiersza (arkusz się nie zmienia).
 */
function wyrownajWierszUsterki_(r, mapa) {
  var w = r.slice();
  if (czyWierszUsterkiPrzesuniety_(w)) {
    w = [w[0], w[1], ""].concat(w.slice(2));
    var u = mapa ? znajdzUrzadzeniePoNazwie_(w[4], mapa, w[3]) : null;
    if (u) w[2] = u.id;
    w.przesuniety = true;
  }
  return w;
}

/**
 * Szuka urządzenia po nazwie. Zwraca urządzenie tylko przy JEDNOZNACZNYM dopasowaniu
 * (np. "Waga cementu" występuje w dwóch obszarach - wtedy rozstrzyga obszar).
 */
function znajdzUrzadzeniePoNazwie_(nazwa, mapa, obszar) {
  var szukana = normalizujId_(nazwa);
  if (!szukana) return null;
  var klucze = Object.keys(mapa);

  var kandydaci = klucze.filter(function (k) { return normalizujId_(mapa[k].nazwa) === szukana; });
  if (kandydaci.length === 0) {
    kandydaci = klucze.filter(function (k) {
      var nz = normalizujId_(mapa[k].nazwa);
      return nz.indexOf(szukana) !== -1 || szukana.indexOf(nz) !== -1;
    });
  }
  if (obszar && kandydaci.length > 1) {
    var wObszarze = kandydaci.filter(function (k) { return normalizujId_(mapa[k].obszar) === normalizujId_(obszar); });
    if (wObszarze.length > 0) kandydaci = wObszarze;
  }
  return kandydaci.length === 1 ? mapa[kandydaci[0]] : null;
}

/**
 * "🚨 [ZALEGŁY 3d] PRZ-1.10-20260918 | Klapa zrzutowa" -> "Klapa zrzutowa"
 */
function wyodrebnijNazweZEtykiety_(etykieta) {
  var czesci = String(etykieta || "").split("|");
  return czesci.length > 1 ? czesci.slice(1).join("|").trim() : "";
}

/**
 * Czy ta sama odpowiedź jest już w Rejestrze (to samo ID przeglądu, ten sam wykonawca,
 * różnica czasu do 15 minut). Chroni przed podwójnym zapisem.
 */
function czyJuzWRejestrze_(idPrzegladu, wykonawca, dataOdp) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("3. Rejestr Przeglądów");
  if (!sheet || sheet.getLastRow() < 2) return false;

  var dane = sheet.getRange(2, 2, sheet.getLastRow() - 1, 6).getValues(); // B..G
  var id = normalizujId_(idPrzegladu);
  var wyk = normalizujId_(wykonawca);
  var t = (dataOdp instanceof Date) ? dataOdp.getTime() : new Date(dataOdp).getTime();

  for (var i = 0; i < dane.length; i++) {
    if (normalizujId_(dane[i][0]) !== id) continue;
    if (wyk && normalizujId_(dane[i][5]) !== wyk) continue;
    if (isNaN(t)) return true;

    var d = dane[i][4];
    var td = (d instanceof Date) ? d.getTime() : new Date(String(d).replace(" ", "T")).getTime();
    if (!isNaN(td) && Math.abs(td - t) <= 15 * 60 * 1000) return true;
  }
  return false;
}

/**
 * Czyści kolumnę Uwagi z szumu: "- | [⚠️ ID historyczne - brak dopasowania]" -> "-"
 */
function oczyscUwagi_(tekst) {
  var s = String(tekst || "")
    .replace(/\[\s*⚠️?\s*ID historyczne[^\]]*\]/g, "")
    .replace(/\[\s*⚠\s*ID historyczne[^\]]*\]/g, "");
  var czesci = s.split("|").map(function (x) { return x.trim(); })
                .filter(function (x) { return x && x !== "-"; });
  return czesci.length ? czesci.join(" | ") : "-";
}

/**
 * Prosty wyzwalacz edycji:
 *  - Usterki: po zmianie statusu na "Usunięta" wpisuje datę usunięcia,
 *  - Harmonogramy: ręczna zmiana w kolumnach H–K jest kopiowana do drugiego arkusza
 *    z tym samym przeglądem (zbiorczy <-> miesięczny), żeby dane się nie rozjeżdżały.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    wyczyscCacheDlaArkusza_(e.range.getSheet().getName());
    var sheet = e.range.getSheet();
    var nazwa = sheet.getName();
    var row = e.range.getRow();
    var col = e.range.getColumn();
    var nr = e.range.getNumRows();
    var nc = e.range.getNumColumns();
    if (row < 2 || nr > 50) return;

    if (nazwa.indexOf("4. Usterki") === 0 && col <= 9 && col + nc - 1 >= 9) {
      for (var r = row; r < row + nr; r++) {
        if (sheet.getRange(r, 9).getValue() === "Usunięta" && !sheet.getRange(r, 11).getValue()) {
          sheet.getRange(r, 11).setValue(new Date()).setNumberFormat("yyyy-mm-dd hh:mm");
        }
      }
      return;
    }

    if (czyArkuszHarmonogramu_(nazwa) && col <= 11 && col + nc - 1 >= 8) {
      synchronizujWierszeHarmonogramu_(sheet, row, nr);
    }
  } catch (err) {
    Logger.log("onEdit: " + err.message);
  }
}

function synchronizujWierszeHarmonogramu_(zrodlo, row, nr) {
  var ss = zrodlo.getParent();
  var wiersze = zrodlo.getRange(row, 1, nr, 11).getValues();
  var doSkopiowania = {};
  wiersze.forEach(function (w) {
    var id = normalizujId_(w[0]);
    if (id) doSkopiowania[id] = [w[7], w[8], w[9], w[10]];
  });

  ss.getSheets().forEach(function (sh) {
    if (sh.getSheetId() === zrodlo.getSheetId()) return;
    if (!czyArkuszHarmonogramu_(sh.getName()) || sh.getLastRow() < 2) return;
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) {
      var dane = doSkopiowania[normalizujId_(ids[i][0])];
      if (dane) sh.getRange(i + 2, 8, 1, 4).setValues([dane]);
    }
  });
}

/**
 * Skok do dzisiejszych przeglądów w arkuszu bieżącego miesiąca.
 */
function przejdzDoDzisiaj() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Harmonogram - " + pobierzKodAktualnegoMiesiaca()) || ss.getSheetByName("2. Harmonogram");
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert("Brak harmonogramu na bieżący miesiąc.");
    return;
  }

  var dzis = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var daty = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getDisplayValues();
  var pierwszy = -1, ile = 0, najblizszy = -1;

  for (var i = 0; i < daty.length; i++) {
    var d = String(daty[i][0]).trim();
    if (d === dzis) {
      if (pierwszy < 0) pierwszy = i;
      ile++;
    } else if (najblizszy < 0 && d > dzis) {
      najblizszy = i;
    }
  }

  var cel = pierwszy >= 0 ? pierwszy : najblizszy;
  if (cel < 0) {
    SpreadsheetApp.getUi().alert("Nie znaleziono przeglądów na dziś ani późniejszych w tym arkuszu.");
    return;
  }

  ss.setActiveSheet(sheet);
  sheet.setActiveRange(sheet.getRange(cel + 2, 1, Math.max(ile, 1), 11));
  ss.toast(ile > 0 ? "Dziś zaplanowano " + ile + " przeglądów (podświetlone na żółto)."
                   : "Na dziś brak przeglądów – pokazano najbliższy termin.", "📍 CMMS", 6);
}

/**
 * Kolejność i kolory zakładek: najpierw to, czego używa się codziennie.
 */
function uporzadkujZakladki_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kod = pobierzKodAktualnegoMiesiaca();
  var aktywny = ss.getActiveSheet();

  if (typeof porzadekZakladek_ === "function" && ss.getSheetByName(ARKUSZ_START)) { porzadekZakladek_(false); return; }
  var kolejnosc = ["0. Dashboard CMMS", "Harmonogram - " + kod, "1. Urządzenia", "2. Harmonogram",
                   "3. Rejestr Przeglądów", "4. Usterki i Awarie", "4. Usterki i Awaria"];
  var kolory = {
    "0. Dashboard CMMS": "#1e40af",
    "1. Urządzenia": "#64748b",
    "2. Harmonogram": "#94a3b8",
    "3. Rejestr Przeglądów": "#7c3aed",
    "4. Usterki i Awarie": "#dc2626",
    "4. Usterki i Awaria": "#dc2626"
  };

  var pozycja = 1;
  kolejnosc.forEach(function (nazwa) {
    var sh = ss.getSheetByName(nazwa);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(pozycja++);
    if (kolory[nazwa]) sh.setTabColor(kolory[nazwa]);
  });

  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (n.indexOf("Harmonogram - ") === 0) {
      sh.setTabColor(n === "Harmonogram - " + kod ? "#16a34a" : "#86efac");
    }
  });

  ss.setActiveSheet(ss.getSheetByName("0. Dashboard CMMS") || aktywny);
}
/* ==========================================================================
 *  KODY QR PER MASZYNA (V4.2)
 *  Skan kodu QR otwiera formularz przeglądu wyłącznie dla tej jednej maszyny.
 * ========================================================================== */

/**
 * Generuje kody QR w kolumnie F karty urządzeń.
 * Każdy kod prowadzi do aplikacji mobilnej z parametrem ?id=<ID maszyny>.
 *
 * Adres aplikacji jest zapisywany na stałe. Wcześniejsza wersja brała go z
 * ScriptApp.getService().getUrl(), które potrafi zwrócić adres testowy "/dev" -
 * działa on tylko dla edytorów skryptu, więc technik po skanie dostawał błąd.
 */
function wygenerujKodyQRMaszyn() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("1. Urządzenia");
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert("Nie znaleziono arkusza '1. Urządzenia' z danymi.");
    return;
  }

  var duplikaty = znajdzDuplikatyIdUrzadzen_(sheet);
  if (duplikaty.length > 0) {
    ui.alert("⛔ Nie wygenerowano kodów QR.\n\nZduplikowane ID urządzeń: " + duplikaty.join(", ") +
      "\n\nKod QR wskazywałby dwie różne maszyny. Uruchom najpierw:\n" +
      "⚙️ CMMS System → 🛠️ Serwis i naprawa danych → 🔧 Napraw format ID urządzeń.");
    return;
  }

  var url = PropertiesService.getScriptProperties().getProperty("CMMS_URL_APLIKACJI") || "";
  if (url) {
    var odp = ui.alert("📷 Kody QR",
      "Kody będą prowadzić do aplikacji:\n" + url + "\n\n" +
      "TAK = użyj tego adresu\nNIE = wpisz inny adres",
      ui.ButtonSet.YES_NO_CANCEL);
    if (odp === ui.Button.NO) url = "";
    else if (odp !== ui.Button.YES) return;
  }
  if (!url) {
    url = zapytajOAdresAplikacji_();
    if (!url) return;
  }

  var n = sheet.getLastRow() - 1;
  var ids = sheet.getRange(2, 1, n, 1).getDisplayValues();
  var formuly = [];
  var ile = 0;

  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0]).trim();
    if (!id) { formuly.push([""]); continue; }
    var link = url + "?id=" + encodeURIComponent(id);
    formuly.push(['=IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=' +
                  encodeURIComponent(link) + '", 4, 70, 70)']);
    ile++;
  }

  sheet.getRange(1, 6).setValue("Kod QR");
  sheet.getRange(2, 6, n, 1).setFormulas(formuly).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeights(2, n, 80);
  sheet.setColumnWidth(6, 95);
  sheet.getRange(1, 6).setNote("Kody prowadzą do:\n" + url +
    "\n\nPrzykład dla pierwszej maszyny:\n" + url + "?id=" + encodeURIComponent(String(ids[0][0]).trim()));

  ui.alert("✅ Wygenerowano " + ile + " kodów QR.\n\n" +
    "Każdy kod otwiera formularz przeglądu TYLKO dla swojej maszyny.\n\n" +
    "Test: zeskanuj telefonem kod maszyny " + String(ids[0][0]).trim() + ".");
}

/**
 * Pyta o adres aplikacji mobilnej (…/exec), sprawdza go i zapisuje na stałe.
 */
function zapytajOAdresAplikacji_() {
  var ui = SpreadsheetApp.getUi();
  var auto = "";
  try { auto = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  var wykryty = /\/exec$/.test(auto) ? "\n\nWykryty adres (zostaw pole puste, żeby go użyć):\n" + auto : "";

  var odp = ui.prompt("🔗 Adres aplikacji mobilnej",
    "Wklej adres aplikacji internetowej – kończy się na /exec.\n\n" +
    "Gdzie go znaleźć: Apps Script → Wdróż → Zarządzaj wdrożeniami → " +
    "Aplikacja internetowa → Adres URL → Kopiuj." + wykryty,
    ui.ButtonSet.OK_CANCEL);
  if (odp.getSelectedButton() !== ui.Button.OK) return "";

  var url = String(odp.getResponseText() || "").trim() || (/\/exec$/.test(auto) ? auto : "");
  url = url.split("?")[0].split("#")[0].replace(/\/+$/, "");

  if (/\/dev$/.test(url)) {
    ui.alert("⛔ To adres testowy (kończy się na /dev).\n\n" +
      "Działa tylko dla osób, które mogą edytować skrypt – technicy dostaliby błąd.\n" +
      "Użyj adresu kończącego się na /exec.");
    return "";
  }
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    ui.alert("⛔ To nie wygląda na adres aplikacji Apps Script.\n\n" +
      "Adres powinien zaczynać się od https://script.google.com/ i kończyć na /exec.");
    return "";
  }

  PropertiesService.getScriptProperties().setProperty("CMMS_URL_APLIKACJI", url);
  return url;
}

/**
 * Dane do formularza mobilnego w TRYBIE MASZYNY (po zeskanowaniu kodu QR).
 * Zwraca kartę maszyny i wyłącznie jej przeglądy: zaległe, dzisiejszy i najbliższy kolejny.
 */
function pobierzPrzegladyMaszyny(idUrzadzenia) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var urz = pobierzMapeUrzadzen_(ss)[normalizujId_(idUrzadzenia)];
  if (!urz) return { maszyna: null, przeglady: [], domyslny: "" };
  var start = daneStartowe_();
  var klucz = normalizujId_(urz.id);
  var tejMaszyny = rozpakujPrzeglady_(start.lista).filter(function (p) { return normalizujId_(p.idUrzadzenia) === klucz; });
  var doZrobienia = tejMaszyny.filter(function (p) { return p.dni <= 0; }).sort(function (a, b) { return a.dni - b.dni; });
  var kolejne = tejMaszyny.filter(function (p) { return p.dni > 0; });
  if (start.dalej[klucz]) kolejne.push(start.dalej[klucz]);
  kolejne.sort(function (a, b) { return a.dni - b.dni; });
  var nastepny = kolejne[0] || null;
  var dzisiejszy = doZrobienia.filter(function (p) { return p.dni === 0; })[0];
  return {
    maszyna: urz,
    przeglady: doZrobienia.concat(nastepny ? [nastepny] : []),
    domyslny: dzisiejszy ? dzisiejszy.idPrzegladu : (doZrobienia[0] ? doZrobienia[0].idPrzegladu : (nastepny ? nastepny.idPrzegladu : ""))
  };
}

/** Wersja bez pamięci podręcznej (odczyt wprost z arkusza) - zostawiona do diagnostyki. */
function czytajPrzegladyMaszyny_(idUrzadzenia) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapa = pobierzMapeUrzadzen_(ss);
  var urz = mapa[normalizujId_(idUrzadzenia)];
  if (!urz) return { maszyna: null, przeglady: [], domyslny: "" };

  var wynik = { maszyna: urz, przeglady: [], domyslny: "" };
  var sheet = ss.getSheetByName("2. Harmonogram");
  if (!sheet || sheet.getLastRow() < 2) return wynik;

  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var dzis = new Date(dzisStr + "T00:00:00");
  var klucz = normalizujId_(urz.id);
  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getDisplayValues();

  var doZrobienia = [];
  var nastepny = null;

  for (var i = 0; i < dane.length; i++) {
    var r = dane[i];
    if (normalizujId_(r[1]) !== klucz) continue;

    var status = String(r[8] || "").trim();
    if (status.toLowerCase() === "wykonany") continue;

    var dataStr = String(r[6] || "").trim();
    var d = new Date(dataStr + "T00:00:00");
    if (isNaN(d.getTime())) continue;
    var dni = Math.round((d.getTime() - dzis.getTime()) / 86400000);

    var p = {
      idPrzegladu: String(r[0] || "").trim(),
      idUrzadzenia: String(r[1] || "").trim(),
      obszar: String(r[2] || "").trim(),
      nazwaUrzadzenia: String(r[3] || "").trim(),
      czestotliwosc: String(r[4] || "").trim(),
      zakres: String(r[5] || "").trim(),
      dataPlanowana: dataStr,
      status: status,
      czyWykonany: false,
      dni: dni,
      kategoria: dni < 0 ? "zalegly" : (dni === 0 ? "dzis" : "nadchodzacy")
    };

    if (dni <= 0) doZrobienia.push(p);
    else if (!nastepny || dni < nastepny.dni) nastepny = p;
  }

  doZrobienia.sort(function (a, b) { return a.dni - b.dni; });
  wynik.przeglady = doZrobienia.concat(nastepny ? [nastepny] : []);

  // Domyślnie: dzisiejszy; jeśli go nie ma - najstarszy zaległy; jeśli nic - najbliższy kolejny
  var dzisiejszy = doZrobienia.filter(function (p) { return p.dni === 0; })[0];
  wynik.domyslny = dzisiejszy ? dzisiejszy.idPrzegladu
                 : (doZrobienia[0] ? doZrobienia[0].idPrzegladu
                 : (nastepny ? nastepny.idPrzegladu : ""));
  return wynik;
}
/* ==========================================================================
 *  CZYTELNE KODY QR: podgląd na ekranie + etykiety do druku (V4.2)
 * ========================================================================== */

/**
 * Adres obrazka z kodem QR (z białą ramką - ułatwia skanowanie).
 */
function adresKoduQR_(url, idUrz, rozmiar) {
  var link = url + "?id=" + encodeURIComponent(idUrz);
  return "https://api.qrserver.com/v1/create-qr-code/?size=" + rozmiar + "x" + rozmiar +
         "&margin=16&ecc=L&data=" + encodeURIComponent(link);
}

function pobierzUrlAplikacjiLubZapytaj_() {
  var url = PropertiesService.getScriptProperties().getProperty("CMMS_URL_APLIKACJI") || "";
  return url || zapytajOAdresAplikacji_();
}

function escHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Duży kod QR zaznaczonej maszyny w oknie - do skanowania prosto z monitora.
 * Działa w "1. Urządzenia" (ID w kolumnie A) i w harmonogramach (ID w kolumnie B).
 */
function pokazKodQRMaszyny() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var nazwaArk = sheet.getName();
  var wiersz = sheet.getActiveCell().getRow();

  var idUrz = "";
  if (wiersz >= 2 && nazwaArk === "1. Urządzenia") {
    idUrz = String(sheet.getRange(wiersz, 1).getDisplayValue()).trim();
  } else if (wiersz >= 2 && czyArkuszHarmonogramu_(nazwaArk)) {
    idUrz = String(sheet.getRange(wiersz, 2).getDisplayValue()).trim();
  }
  if (!idUrz) {
    ui.alert("Kliknij najpierw w wiersz maszyny w arkuszu „1. Urządzenia” (albo w harmonogramie), a potem użyj tej opcji.");
    return;
  }

  var urz = pobierzMapeUrzadzen_(ss)[normalizujId_(idUrz)];
  if (!urz) {
    ui.alert("Nie znaleziono maszyny o ID " + idUrz + " w karcie urządzeń.");
    return;
  }

  var url = pobierzUrlAplikacjiLubZapytaj_();
  if (!url) return;
  var link = url + "?id=" + encodeURIComponent(urz.id);

  var html =
    '<div style="font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:4px 8px;color:#0f172a;">' +
      '<div style="font-size:13px;color:#64748b;">' + escHtml_(urz.obszar) + '</div>' +
      '<div style="font-size:21px;font-weight:800;margin:4px 0 8px;">' + escHtml_(urz.nazwa) + '</div>' +
      '<div style="display:inline-block;background:#1e40af;color:#fff;font-weight:800;font-size:20px;' +
        'padding:4px 16px;border-radius:8px;">ID ' + escHtml_(urz.id) + '</div>' +
      '<div style="margin:14px auto 8px;"><img src="' + adresKoduQR_(url, urz.id, 500) + '" width="340" height="340" ' +
        'style="border:1px solid #e2e8f0;"></div>' +
      '<div style="font-size:12px;color:#475569;">Zeskanuj aparatem telefonu – otworzy się formularz przeglądu tej maszyny.</div>' +
      '<div style="margin-top:10px;"><a href="' + escHtml_(link) + '" target="_blank" style="color:#1e40af;font-size:13px;">' +
        'Otwórz link na komputerze (test)</a></div>' +
    '</div>';

  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(440).setHeight(600), "📷 Kod QR maszyny");
}

/**
 * Arkusz "🖨️ Etykiety QR" - etykiety do wydruku i naklejenia na maszyny.
 * 3 etykiety w rzędzie: duży kod QR (~5 cm na A4), ID, nazwa, kolorowy pasek obszaru.
 */
function utworzEtykietyQR() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var urzSheet = ss.getSheetByName("1. Urządzenia");
  if (!urzSheet || urzSheet.getLastRow() < 2) {
    ui.alert("Nie znaleziono arkusza '1. Urządzenia' z danymi.");
    return;
  }
  var duplikaty = znajdzDuplikatyIdUrzadzen_(urzSheet);
  if (duplikaty.length > 0) {
    ui.alert("⛔ Zduplikowane ID urządzeń: " + duplikaty.join(", ") + "\nNajpierw uruchom 🔧 Napraw format ID urządzeń.");
    return;
  }
  var url = pobierzUrlAplikacjiLubZapytaj_();
  if (!url) return;

  ss.toast("Tworzę etykiety… to potrwa ok. 30 sekund.", "🖨️ CMMS", 10);

  var dane = urzSheet.getRange(2, 1, urzSheet.getLastRow() - 1, 3).getDisplayValues()
                     .filter(function (r) { return String(r[0]).trim(); });

  var NAZWA = "🖨️ Etykiety QR";
  var sh = ss.getSheetByName(NAZWA);
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
  } else {
    sh = ss.insertSheet(NAZWA);
  }

  var KOL = 3;       // etykiet w rzędzie
  var WYS = 5;       // wierszy na etykietę: QR, ID, nazwa, obszar, odstęp
  var rzedy = Math.ceil(dane.length / KOL);
  var ostatniWiersz = 1 + rzedy * WYS;

  if (sh.getMaxRows() < ostatniWiersz) sh.insertRowsAfter(sh.getMaxRows(), ostatniWiersz - sh.getMaxRows());
  if (sh.getMaxColumns() > KOL) sh.deleteColumns(KOL + 1, sh.getMaxColumns() - KOL);

  var wartosci = [], rozmiary = [], grubosci = [], kolory = [], tla = [];
  for (var r = 0; r < rzedy; r++) {
    var qr = [], id = [], nz = [], ob = [], od = [];
    for (var c = 0; c < KOL; c++) {
      var u = dane[r * KOL + c];
      if (u) {
        var idU = String(u[0]).trim();
        qr.push('=IMAGE("' + adresKoduQR_(url, idU, 500) + '", 4, 190, 190)');
        id.push("ID " + idU);          // prefiks "ID " - inaczej 1.10 zamieniłoby się w liczbę 1,1
        nz.push(String(u[2]).trim());
        ob.push(String(u[1]).trim());
      } else {
        qr.push(""); id.push(""); nz.push(""); ob.push("");
      }
      od.push("");
    }
    wartosci.push(qr, id, nz, ob, od);

    var obszaryRzedu = [0, 1, 2].map(function (c) { var x = dane[r * KOL + c]; return x ? kolorObszaru_(x[1]) : "#ffffff"; });
    rozmiary.push([10, 10, 10], [18, 18, 18], [11, 11, 11], [9, 9, 9], [6, 6, 6]);
    grubosci.push(["normal", "normal", "normal"], ["bold", "bold", "bold"], ["bold", "bold", "bold"],
                  ["normal", "normal", "normal"], ["normal", "normal", "normal"]);
    kolory.push(["#000000", "#000000", "#000000"], ["#1e40af", "#1e40af", "#1e40af"], ["#0f172a", "#0f172a", "#0f172a"],
                ["#334155", "#334155", "#334155"], ["#000000", "#000000", "#000000"]);
    tla.push(["#ffffff", "#ffffff", "#ffffff"], ["#ffffff", "#ffffff", "#ffffff"], ["#ffffff", "#ffffff", "#ffffff"],
             obszaryRzedu, ["#ffffff", "#ffffff", "#ffffff"]);
  }

  var zakres = sh.getRange(2, 1, rzedy * WYS, KOL);
  zakres.setNumberFormat("@").setValues(wartosci);
  zakres.setFontSizes(rozmiary).setFontWeights(grubosci).setFontColors(kolory).setBackgrounds(tla)
        .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);

  for (var r2 = 0; r2 < rzedy; r2++) {
    var start = 2 + r2 * WYS;
    sh.setRowHeight(start, 205);      // kod QR
    sh.setRowHeight(start + 1, 34);   // ID
    sh.setRowHeight(start + 2, 42);   // nazwa
    sh.setRowHeight(start + 3, 22);   // obszar
    sh.setRowHeight(start + 4, 18);   // odstęp
    for (var c2 = 0; c2 < KOL; c2++) {
      if (!dane[r2 * KOL + c2]) continue;
      sh.getRange(start, c2 + 1, 4, 1)
        .setBorder(true, true, true, true, null, null, "#94a3b8", SpreadsheetApp.BorderStyle.DASHED);
    }
  }

  // Formuły IMAGE muszą być formułami, nie tekstem
  var formuly = [];
  for (var r3 = 0; r3 < rzedy; r3++) formuly.push(wartosci[r3 * WYS]);
  for (var r4 = 0; r4 < rzedy; r4++) {
    sh.getRange(2 + r4 * WYS, 1, 1, KOL).setNumberFormat("General").setFormulas([formuly[r4]]);
  }

  sh.getRange(1, 1, 1, KOL).merge()
    .setValue("🖨️ Druk: Plik → Drukuj → A4, Skala: Dopasuj do szerokości, Marginesy: Wąskie, odznacz „Pokaż linie siatki”. " +
              "Sprawdź w podglądzie, czy żadna etykieta nie jest przecięta między stronami. Wytnij wzdłuż przerywanych linii.")
    .setFontSize(9).setFontColor("#64748b").setWrap(true).setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(1, 40);
  sh.setColumnWidths(1, KOL, 250);
  sh.setHiddenGridlines(true);
  sh.setTabColor("#0ea5e9");
  ss.setActiveSheet(sh);

  ui.alert("✅ Utworzono " + dane.length + " etykiet QR w arkuszu „" + NAZWA + "”.\n\n" +
    "Drukowanie: Plik → Drukuj → A4, Skala: Dopasuj do szerokości.\n" +
    "Kod na wydruku ma ok. 5 cm – wygodnie skanuje się z odległości ok. 30–50 cm.");
}
/* ==========================================================================
 *  PORZĄDKI (V4.4): karta urządzeń jako jedyne źródło + święta w harmonogramie
 * ========================================================================== */

/**
 * Karta urządzeń w arkuszu jest jedynym źródłem prawdy.
 * Lista maszyn zapisana w kodzie służy już tylko do wypełnienia PUSTEGO arkusza -
 * dzięki temu ręczne poprawki (np. nazwy 1.28-1.33 wg wykazu) nie zostaną nadpisane.
 */
function kartaUrzadzenMaDane_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return false;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  return ids.some(function (r) { return String(r[0]).trim() !== ""; });
}

/**
 * Polskie dni ustawowo wolne w danym roku, jako "RRRR-MM-DD".
 * Święta ruchome liczone od daty Wielkanocy; Wigilia wolna od 2025 r.
 */
function swietaPL_(rok) {
  var a = rok % 19, b = Math.floor(rok / 100), c = rok % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mies = Math.floor((h + l - 7 * m + 114) / 31), dzien = ((h + l - 7 * m + 114) % 31) + 1;

  function txt(dt) {
    return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2);
  }
  function odWielkanocy(dni) { return txt(new Date(rok, mies - 1, dzien + dni)); }

  var lista = [
    txt(new Date(rok, 0, 1)),   // Nowy Rok
    txt(new Date(rok, 0, 6)),   // Trzech Króli
    odWielkanocy(0),            // Wielkanoc
    odWielkanocy(1),            // Poniedziałek Wielkanocny
    txt(new Date(rok, 4, 1)),   // 1 Maja
    txt(new Date(rok, 4, 3)),   // 3 Maja
    odWielkanocy(49),           // Zielone Świątki
    odWielkanocy(60),           // Boże Ciało
    txt(new Date(rok, 7, 15)),  // Wniebowzięcie NMP
    txt(new Date(rok, 10, 1)),  // Wszystkich Świętych
    txt(new Date(rok, 10, 11)), // Święto Niepodległości
    txt(new Date(rok, 11, 25)), // Boże Narodzenie
    txt(new Date(rok, 11, 26))  // drugi dzień świąt
  ];
  if (rok >= 2025) lista.push(txt(new Date(rok, 11, 24))); // Wigilia
  return lista;
}

/**
 * Poprawia harmonogram o weekendy i święta:
 *  - przegląd codzienny wypadający w święto - usuwany (w ten dzień nikt go nie robi),
 *  - tygodniowy / miesięczny - przesuwany na najbliższy dzień roboczy.
 * Rozliczonych przeglądów nie rusza. ID przeglądu zostaje bez zmian, więc rozliczenia się nie gubią.
 */
function uwzglednijSwieta_(sheet) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return;

  var cache = {};
  function txt(dt) {
    return dt.getFullYear() + "-" + ("0" + (dt.getMonth() + 1)).slice(-2) + "-" + ("0" + dt.getDate()).slice(-2);
  }
  function wolny(str) {
    var dt = new Date(str + "T00:00:00");
    if (isNaN(dt.getTime())) return false;
    var dw = dt.getDay();
    if (dw === 0 || dw === 6) return true;
    var r = dt.getFullYear();
    if (!cache[r]) cache[r] = swietaPL_(r);
    return cache[r].indexOf(str) !== -1;
  }
  function nastepnyRoboczy(str) {
    var dt = new Date(str + "T00:00:00");
    do { dt.setDate(dt.getDate() + 1); } while (wolny(txt(dt)));
    return txt(dt);
  }

  var dane = sheet.getRange(2, 1, n, 11).getDisplayValues();
  var wynik = [], usuniete = 0, przesuniete = 0;

  dane.forEach(function (r, idx) {
    var data = String(r[6]).trim();
    if (!String(r[0]).trim() || !wolny(data)) { wynik.push({ r: r, i: idx }); return; }

    var rozliczony = String(r[8]).trim().toLowerCase() === "wykonany" ||
                     String(r[7]).trim() !== "" || String(r[10]).trim() !== "";
    if (rozliczony) { wynik.push({ r: r, i: idx }); return; }

    var cz = String(r[4]).trim();
    if (cz === "Codzienny" || cz === "Codzienna") { usuniete++; return; }

    var kopia = r.slice();
    kopia[6] = nastepnyRoboczy(data);
    przesuniete++;
    wynik.push({ r: kopia, i: idx });
  });

  wynik.sort(function (a, b) {
    return a.r[6] < b.r[6] ? -1 : (a.r[6] > b.r[6] ? 1 : a.i - b.i);
  });
  var wiersze = wynik.map(function (x) { return x.r; });

  sheet.getRange(2, 1, n, 11).clearContent();
  if (wiersze.length > 0) {
    sheet.getRange(2, 1, wiersze.length, 2).setNumberFormat("@");
    sheet.getRange(2, 1, wiersze.length, 11).setValues(wiersze);
  }
  Logger.log("Święta i weekendy: usunięto przeglądów dziennych " + usuniete + ", przesunięto " + przesuniete);
}
/* ==========================================================================
 *  PRACOWNICY + POTWIERDZENIE DTR (V4.5)
 * ========================================================================== */

var ARKUSZ_PRACOWNICY = "6. Pracownicy";

/**
 * Lista aktywnych pracowników do formularzy (wybór z listy zamiast wpisywania nazwiska).
 */
function pobierzPracownikow() {
  return zCache_("cmms_prac", 1800, czytajPracownikow_);
}
function czytajPracownikow_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARKUSZ_PRACOWNICY);
  if (!sh || sh.getLastRow() < 2) return [];
  var dane = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues();
  var widziane = {};
  var lista = [];
  dane.forEach(function (r) {
    var imie = String(r[0]).replace(/\s+/g, " ").trim();
    var status = String(r[1]).trim().toUpperCase();
    var aktywny = status !== "NIE" && status !== STATUS_DO_ZATWIERDZENIA;
    if (!imie || !aktywny || widziane[imie.toLowerCase()]) return;
    widziane[imie.toLowerCase()] = true;
    lista.push(imie);
  });
  return lista.sort(function (a, b) { return a.localeCompare(b, "pl"); });
}

/**
 * Tworzy (albo porządkuje) arkusz "6. Pracownicy".
 * W notatce przy nagłówku pokazuje nazwiska wpisywane dotąd ręcznie w Rejestrze i Usterkach -
 * żeby było widać, które warianty trzeba ujednolicić.
 */
function utworzArkuszPracownikow__zapis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARKUSZ_PRACOWNICY);
  var nowy = false;
  if (!sh) {
    sh = ss.insertSheet(ARKUSZ_PRACOWNICY);
    sh.getRange(1, 1, 1, 5).setValues([["Imię i nazwisko", "Aktywny", "Rola", "Uwagi", "Email"]]);
    sh.getRange(2, 1, 1, 5).setValues([["Gabriel Skubis", "TAK", "Wdrożenie CMMS", "", ""]]);
    nowy = true;
  }
  var kolEmail = kolumnaEmailPracownikow_(sh);

  // Warianty nazwisk z historii (Rejestr kol. G, Usterki kol. H)
  var warianty = {};
  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (rej && rej.getLastRow() > 1) {
    rej.getRange(2, 7, rej.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      var t = String(r[0]).trim(); if (t) warianty[t] = (warianty[t] || 0) + 1;
    });
  }
  var ust = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (ust && ust.getLastRow() > 1) {
    ust.getRange(2, 8, ust.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      var t = String(r[0]).trim(); if (t) warianty[t] = (warianty[t] || 0) + 1;
    });
  }
  var opis = Object.keys(warianty).sort().map(function (k) { return "• " + k + " (" + warianty[k] + ")"; }).join("\n");

  // Formatowanie
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, 1, kolEmail).setFontWeight("bold").setFontSize(10).setBackground(KOLOR_NAGLOWKA)
    .setFontColor("#ffffff").setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  sh.getRange("B2:B").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["TAK", "NIE", STATUS_DO_ZATWIERDZENIA], true).setAllowInvalid(false).build()).setHorizontalAlignment("center");
  sh.getRange("A2:A").setFontWeight("bold");
  sh.clearConditionalFormatRules();
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B2="NIE"')
      .setFontColor("#94a3b8").setStrikethrough(true).setRanges([sh.getRange(2, 1, sh.getMaxRows() - 1, kolEmail)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B2="' + STATUS_DO_ZATWIERDZENIA + '"')
      .setBackground("#fef3c7").setRanges([sh.getRange(2, 1, sh.getMaxRows() - 1, kolEmail)]).build()
  ]);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 90); sh.setColumnWidth(3, 180); sh.setColumnWidth(4, 260); sh.setColumnWidth(kolEmail, 240);
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), kolEmail).createFilter();
  sh.getRange("A1").setNote(
    "Lista osób do wyboru w formularzach. Osoby, które odeszły: ustaw „Aktywny” = NIE (nie usuwaj wiersza).\n" +
    "Email = konto Google technika; aplikacja sama wpisze go jako wykonawcę.\n" +
    "DO ZATWIERDZENIA = konto, które otworzyło aplikację, ale nie pasuje do nikogo z listy – popraw nazwisko i ustaw TAK albo NIE.\n\n" +
    "Nazwiska wpisywane dotąd ręcznie (liczba wpisów):\n" + (opis || "brak"));
  sh.setTabColor("#0ea5e9");
  ss.setActiveSheet(sh);

  SpreadsheetApp.getUi().alert("👷 Lista pracowników\n\n" +
    (nowy ? "Utworzono arkusz „" + ARKUSZ_PRACOWNICY + "” z jednym przykładowym wierszem.\n" : "Arkusz uporządkowany.\n") +
    "Dopisz techników UR – po jednym w wierszu, pełne imię i nazwisko.\n\n" +
    "W notatce przy komórce A1 są nazwiska wpisywane dotąd ręcznie – pomogą ustalić pełną listę.");
}
/* ==========================================================================
 *  AWARIE Z KODU QR, OBIEG USTEREK, HISTORIA MASZYNY (V4.6)
 *  Nowe kolumny w "4. Usterki i Awarie": M = Źródło, N = Maszyna stoi, O = Czas przestoju (h)
 * ========================================================================== */

var KOL_USTERKI_EXTRA = ["Źródło", "Maszyna stoi", "Czas przestoju (h)"];

function arkuszUsterek_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (!sh) {
    sh = ss.insertSheet("4. Usterki i Awarie");
    sh.getRange(1, 1, 1, 12).setValues([NAGLOWKI_USTERKI]);
  }
  if (String(sh.getRange(1, 13).getDisplayValue()).trim() !== KOL_USTERKI_EXTRA[0]) {
    sh.getRange(1, 13, 1, 3).setValues([KOL_USTERKI_EXTRA])
      .setFontWeight("bold").setFontSize(10).setBackground("#991b1b").setFontColor("#ffffff")
      .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
    sh.setColumnWidth(13, 110); sh.setColumnWidth(14, 90); sh.setColumnWidth(15, 110);
    sh.getRange("M2:O").setHorizontalAlignment("center");
    sh.getRange("O2:O").setNumberFormat("0.0");
  }
  return sh;
}

/**
 * Zgłoszenie awarii z kodu QR - bez przeglądu, w dowolnym momencie.
 */
function zglosAwarie__zapis(p) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { success: false, message: "System jest zajęty – spróbuj ponownie za chwilę." };
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var urz = pobierzMapeUrzadzen_(ss)[normalizujId_(p.idUrzadzenia)];
    if (!urz) return { success: false, message: "Nie rozpoznano maszyny o ID " + p.idUrzadzenia + "." };

    var opis = String(p.opis || "").trim();
    if (!opis) return { success: false, message: "Opisz awarię." };
    if (p.zalecenia && String(p.zalecenia).trim()) opis += " | Zalecenia / części: " + String(p.zalecenia).trim();

    var kto = String(p.zglaszajacy || "").trim() || "nieznany";
    var prio = p.priorytet || "Średni";
    var stoi = p.maszynaStoi === true;
    var tz = ss.getSpreadsheetTimeZone();
    var data = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    var id = generujUnikalneId_("UST");

    var sh = arkuszUsterek_(ss);
    var w = sh.getLastRow() + 1;
    sh.getRange(w, 3).setNumberFormat("@"); // ID maszyny jako tekst (1.10 ≠ 1.1)
    sh.getRange(w, 1, 1, 15).setValues([[id, data, urz.id, urz.obszar, urz.nazwa, opis, prio, kto,
                                          "Zgłoszona", "", "", "", "Awaria (QR)", stoi ? "TAK" : "NIE", ""]]);

    try {
      var html =
        "<div style='font-family:Arial,sans-serif;padding:20px;border:2px solid #ef4444;border-radius:8px;background:#fef2f2;'>" +
          "<h2 style='color:#991b1b;margin-top:0;'>" + (stoi ? "⛔ MASZYNA STOI – " : "🚨 ") + "zgłoszono awarię</h2>" +
          "<p><b>Maszyna:</b> " + escHtml_(urz.nazwa) + " [" + escHtml_(urz.id) + "] (" + escHtml_(urz.obszar) + ")</p>" +
          "<p><b>Zgłaszający:</b> " + escHtml_(kto) + "</p>" +
          "<p><b>Priorytet:</b> <span style='color:#dc2626;font-weight:bold;'>" + escHtml_(prio) + "</span></p>" +
          "<p><b>Opis:</b> " + escHtml_(opis) + "</p>" +
          "<p style='font-size:11px;color:#6b7280;'>ID zgłoszenia: " + id + " · wiadomość z systemu CMMS Holcim</p>" +
        "</div>";
      MailApp.sendEmail({
        to: EMAIL_KIEROWNIKA,
        subject: (stoi ? "⛔ MASZYNA STOI – " : "🚨 ") + "[CMMS AWARIA] " + urz.nazwa + " (" + urz.id + ")",
        htmlBody: html
      });
    } catch (errMail) {
      Logger.log("Błąd wysyłki maila o awarii: " + errMail.message);
    }

    return { success: true, idUsterki: id, message: "Zgłoszono awarię: " + urz.nazwa };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Zmiana statusu usterki z telefonu: akcja "w_trakcie" albo "usunieta".
 * Przy zamknięciu usterki z maszyną stojącą liczy czas przestoju (od zgłoszenia do usunięcia).
 */
function zmienStatusUsterki__zapis(p) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) {
    return { success: false, message: "System jest zajęty – spróbuj ponownie za chwilę." };
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = arkuszUsterek_(ss);
    var n = sh.getLastRow() - 1;
    if (n < 1) return { success: false, message: "Brak usterek w arkuszu." };

    var ids = sh.getRange(2, 1, n, 1).getDisplayValues();
    var w = -1;
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(p.idUsterki).trim()) { w = i + 2; break; }
    }
    if (w < 0) return { success: false, message: "Nie znaleziono usterki " + p.idUsterki + "." };

    // stary wpis z przesuniętymi kolumnami - najpierw wyrównaj wiersz, żeby status trafił we właściwe miejsce
    var kolW = Math.max(12, Math.min(15, sh.getLastColumn()));
    var surowy = sh.getRange(w, 1, 1, kolW).getValues()[0];
    if (czyWierszUsterkiPrzesuniety_(surowy.map(function (x) { return x instanceof Date ? "x" : x; }))) {
      var wyrownany = wyrownajWierszUsterki_(surowy, pobierzMapeUrzadzen_(ss)).slice(0, Math.max(kolW, 12));
      while (wyrownany.length < kolW) wyrownany.push("");
      sh.getRange(w, 3).setNumberFormat("@");
      sh.getRange(w, 1, 1, kolW).setValues([wyrownany.slice(0, kolW)]);
    }

    var osoba = String(p.osoba || "").trim();
    if (!osoba) return { success: false, message: "Wybierz, kto obsługuje usterkę." };

    if (p.akcja === "w_trakcie") {
      sh.getRange(w, 9, 1, 2).setValues([["W trakcie", osoba]]);
      return { success: true, message: "Usterka w trakcie naprawy." };
    }

    if (p.akcja === "usunieta") {
      var opis = String(p.opisNaprawy || "").trim();
      if (!opis) return { success: false, message: "Opisz, co zostało zrobione." };
      var teraz = new Date();
      sh.getRange(w, 9, 1, 4).setValues([["Usunięta", osoba, teraz, opis]]);
      sh.getRange(w, 11).setNumberFormat("yyyy-mm-dd hh:mm");

      var info = "";
      if (String(sh.getRange(w, 14).getDisplayValue()).trim().toUpperCase() === "TAK") {
        var start = sh.getRange(w, 2).getValue();
        var t0 = (start instanceof Date) ? start.getTime() : new Date(String(start).replace(" ", "T")).getTime();
        if (!isNaN(t0)) {
          var h = Math.round((teraz.getTime() - t0) / 36e5 * 10) / 10;
          sh.getRange(w, 15).setValue(h).setNumberFormat("0.0");
          info = " Czas przestoju: " + String(h).replace(".", ",") + " h.";
        }
      }
      return { success: true, message: "Usterka zamknięta." + info };
    }

    return { success: false, message: "Nieznana akcja." };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Otwarte usterki i ostatnie zdarzenia (przeglądy + usterki) jednej maszyny - do widoku po skanie QR.
 */
function pobierzUsterkiIHistorieMaszyny(idUrzadzenia, limit) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var klucz = normalizujId_(idUrzadzenia);
  var wynik = { otwarte: [], historia: [] };

  var sh = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (sh && sh.getLastRow() > 1) {
    var kol = Math.max(12, Math.min(15, sh.getLastColumn()));
    sh.getRange(2, 1, sh.getLastRow() - 1, kol).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim() || normalizujId_(r[2]) !== klucz) return;
      var status = String(r[8]).trim() || "Zgłoszona";
      var u = {
        id: String(r[0]).trim(), data: String(r[1]).trim(), opis: String(r[5]).trim(),
        priorytet: String(r[6]).trim(), zglaszajacy: String(r[7]).trim(), status: status,
        osoba: String(r[9] || "").trim(), stoi: String(r[13] || "").trim().toUpperCase() === "TAK"
      };
      if (status !== "Usunięta") wynik.otwarte.push(u);
      wynik.historia.push({
        data: u.data, rodzaj: status === "Usunięta" ? "Usterka usunięta" : "Usterka · " + status,
        opis: u.opis, kto: u.zglaszajacy, ok: status === "Usunięta"
      });
    });
  }

  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (rej && rej.getLastRow() > 1) {
    rej.getRange(2, 1, rej.getLastRow() - 1, 11).getDisplayValues().forEach(function (r) {
      if (normalizujId_(r[2]) !== klucz) return;
      var ok = String(r[8]).trim().toUpperCase() !== "NOK";
      wynik.historia.push({
        data: String(r[5]).trim(), rodzaj: "Przegląd · " + (ok ? "OK" : "NOK"),
        opis: String(r[9]).trim(), kto: String(r[6]).trim(), ok: ok
      });
    });
  }

  wynik.otwarte.sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  wynik.historia.sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  wynik.historia = wynik.historia.slice(0, Math.min(50, Math.max(1, parseInt(limit, 10) || 6)));
  return wynik;
}
/* ==========================================================================
 *  TERMINY UDT I KALIBRACJI + PRZYPOMNIENIA E-MAIL (V4.7)
 * ========================================================================== */

var ARKUSZ_TERMINY = "7. Terminy UDT i kalibracje";
var NAGLOWKI_TERMINY = ["ID", "ID urządzenia", "Urządzenie", "Rodzaj", "Ostatnie wykonanie", "Co ile (mies.)",
                        "Następny termin", "Dni do terminu", "Status", "Odpowiedzialny", "Nr protokołu / dokumentu", "Uwagi"];

/**
 * Tworzy (albo porządkuje) arkusz terminów. Następny termin, dni i status liczą się formułami.
 */
function utworzArkuszTerminow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARKUSZ_TERMINY);
  var nowy = false;

  if (!sh) {
    sh = ss.insertSheet(ARKUSZ_TERMINY);
    nowy = true;
    var mapa = pobierzMapeUrzadzen_(ss);
    var nazwa = function (id) { var u = mapa[normalizujId_(id)]; return u ? u.nazwa : ""; };
    var start = [
      ["5.1", "Badanie UDT", ""], ["5.2", "Badanie UDT", ""],
      ["1.3", "Kalibracja", 12], ["1.5", "Kalibracja", 12], ["1.7", "Kalibracja", 12],
      ["3.6", "Kalibracja", 12], ["3.9", "Kalibracja", 12], ["3.12", "Kalibracja", 12]
    ];
    var wiersze = start.map(function (s, i) {
      return ["TER-" + ("0" + (i + 1)).slice(-2), s[0], nazwa(s[0]), s[1], "", s[2], "", "", "", "", "", ""];
    });
    sh.getRange(1, 1, 1, NAGLOWKI_TERMINY.length).setValues([NAGLOWKI_TERMINY]);
    sh.getRange(2, 1, wiersze.length, 2).setNumberFormat("@");
    sh.getRange(2, 1, wiersze.length, NAGLOWKI_TERMINY.length).setValues(wiersze);
  }

  // Formuły liczące (obejmują też wiersze dopisane później)
  sh.getRange("G2:I").clearContent();
  sh.getRange("G2").setFormula('=ARRAYFORMULA(IF(A2:A="","",IF((E2:E="")+(F2:F=""),"",DATE(YEAR(E2:E),MONTH(E2:E)+F2:F,DAY(E2:E)))))');
  sh.getRange("H2").setFormula('=ARRAYFORMULA(IF(G2:G="","",G2:G-TODAY()))');
  sh.getRange("I2").setFormula('=ARRAYFORMULA(IF(A2:A="","",IF(E2:E="","UZUPEŁNIJ DATĘ",IF(F2:F="","UZUPEŁNIJ OKRES",IF(H2:H<0,"PO TERMINIE",IF(H2:H<=30,"WKRÓTCE","OK"))))))');

  // Formatowanie
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, 1, NAGLOWKI_TERMINY.length).setValues([NAGLOWKI_TERMINY])
    .setFontWeight("bold").setFontSize(10).setBackground(KOLOR_NAGLOWKA).setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(1, 40);
  sh.setFrozenRows(1);
  sh.getRange("A2:C").setNumberFormat("@");
  sh.getRange("A2:B").setHorizontalAlignment("center");
  sh.getRange("C2:C").setFontWeight("bold");
  sh.getRange("E2:E").setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center");
  sh.getRange("F2:F").setNumberFormat("0").setHorizontalAlignment("center");
  sh.getRange("G2:G").setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center").setFontWeight("bold");
  sh.getRange("H2:H").setNumberFormat("0").setHorizontalAlignment("center");
  sh.getRange("I2:I").setHorizontalAlignment("center").setFontWeight("bold");
  sh.getRange("L2:L").setWrap(true);

  sh.getRange("D2:D").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["Badanie UDT", "Kalibracja", "Zawór bezpieczeństwa", "Legalizacja", "Inne"], true)
    .setAllowInvalid(true).build());
  sh.getRange("E2:E").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireDate().setAllowInvalid(false).build());

  var rI = sh.getRange("I2:I");
  sh.clearConditionalFormatRules();
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("PO TERMINIE")
      .setBackground("#fee2e2").setFontColor("#991b1b").setRanges([rI, sh.getRange("G2:G")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("WKRÓTCE")
      .setBackground("#fef3c7").setFontColor("#92400e").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK")
      .setBackground("#d1fae5").setFontColor("#065f46").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("UZUPEŁNIJ")
      .setBackground("#fed7aa").setFontColor("#7c2d12").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$E2="")')
      .setBackground("#fed7aa").setRanges([sh.getRange("E2:E")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$F2="")')
      .setBackground("#fed7aa").setRanges([sh.getRange("F2:F")]).build()
  ]);

  sh.setFrozenColumns(3);
  var szer = [70, 90, 190, 140, 110, 85, 110, 85, 130, 140, 140, 190];
  szer.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), NAGLOWKI_TERMINY.length).createFilter();
  sh.getRange("F1").setNote("Okres w miesiącach – z decyzji UDT, dokumentacji urządzenia lub wymagań producenta.\n" +
    "Np. 12 = raz w roku, 24 = co 2 lata.");
  sh.getRange("A1").setNote("Nowy obowiązek: dopisz wiersz z kolejnym ID (np. TER-09), ID urządzenia, rodzajem, " +
    "datą ostatniego wykonania i okresem. Kolumny G–I policzą się same.\n\n" +
    "Pomarańczowe pola = brak danych. Przypomnienia e-mail: ⚙️ CMMS System → 🏗️ Urządzenia → ⏰ Włącz przypomnienia o terminach.");
  sh.setTabColor("#7c3aed");
  ss.setActiveSheet(sh);

  SpreadsheetApp.getUi().alert("📅 Terminy UDT i kalibracji\n\n" +
    (nowy ? "Utworzono arkusz z 8 pozycjami: zbiorniki 5.1 i 5.2 (UDT) oraz 6 wag (kalibracja co 12 miesięcy).\n\n" : "Arkusz uporządkowany.\n\n") +
    "Uzupełnij pomarańczowe pola: datę ostatniego wykonania i – dla zbiorników – okres badań z dokumentacji UDT.");
}

/**
 * Codzienne sprawdzenie terminów. E-mail wysyłany:
 *  - gdy któryś termin wypada za 30, 14, 7, 1 dzień albo dziś,
 *  - w poniedziałki, jeśli coś jest po terminie albo ma nieuzupełnione dane.
 */
function sprawdzTerminy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARKUSZ_TERMINY);
  if (!sh || sh.getLastRow() < 2) return 0;

  var tz = ss.getSpreadsheetTimeZone();
  var poniedzialek = new Date().getDay() === 1;
  var progi = [30, 14, 7, 1, 0];
  var dane = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();

  var bliskie = [], puste = [], wyslac = false;
  dane.forEach(function (r) {
    if (!String(r[0]).trim()) return;
    var dni = (typeof r[7] === "number") ? Math.round(r[7]) : null;
    if (dni === null) { puste.push(r); return; }
    if (dni <= 30) bliskie.push(r);
    if (progi.indexOf(dni) !== -1 || (dni < 0 && poniedzialek)) wyslac = true;
  });
  if (puste.length && poniedzialek) wyslac = true;
  if (!wyslac) return 0;

  bliskie.sort(function (a, b) { return a[7] - b[7]; });
  var wiersz = function (r) {
    var dni = Math.round(r[7]);
    var kolor = dni < 0 ? "#991b1b" : (dni <= 7 ? "#b45309" : "#0f172a");
    var kiedy = dni < 0 ? (-dni) + " dni po terminie" : (dni === 0 ? "DZIŚ" : "za " + dni + " dni");
    return "<tr><td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;'>" + r[2] + " [" + r[1] + "]</td>" +
      "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;'>" + r[3] + "</td>" +
      "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;'>" + Utilities.formatDate(r[6], tz, "yyyy-MM-dd") + "</td>" +
      "<td style='padding:6px 10px;border-bottom:1px solid #e2e8f0;color:" + kolor + ";font-weight:bold;'>" + kiedy + "</td></tr>";
  };

  var html = "<div style='font-family:Arial,sans-serif;'>" +
    "<h2 style='color:#1e40af;'>📅 Terminy UDT i kalibracji</h2>";
  if (bliskie.length) {
    html += "<table style='border-collapse:collapse;font-size:14px;'>" +
      "<tr style='background:#1e40af;color:#fff;'><th style='padding:6px 10px;text-align:left;'>Urządzenie</th>" +
      "<th style='padding:6px 10px;text-align:left;'>Rodzaj</th><th style='padding:6px 10px;text-align:left;'>Termin</th>" +
      "<th style='padding:6px 10px;text-align:left;'>Kiedy</th></tr>" + bliskie.map(wiersz).join("") + "</table>";
  }
  if (puste.length) {
    html += "<p style='margin-top:16px;'><b>Brak danych do wyliczenia terminu (" + puste.length + "):</b> " +
      puste.map(function (r) { return r[2] + " – " + r[3]; }).join("; ") + "</p>";
  }
  html += "<p style='font-size:11px;color:#6b7280;margin-top:16px;'>Arkusz „" + ARKUSZ_TERMINY + "” · wiadomość z systemu CMMS Holcim</p></div>";

  var po = bliskie.filter(function (r) { return r[7] < 0; }).length;
  MailApp.sendEmail({
    to: EMAIL_KIEROWNIKA,
    subject: (po ? "⛔ " + po + " po terminie – " : "📅 ") + "[CMMS] Terminy UDT i kalibracji",
    htmlBody: html
  });
  return bliskie.length;
}

/**
 * Włącza codzienne sprawdzanie terminów (7:00) i pokazuje aktualny stan.
 */
function instalujPrzypomnieniaTerminow() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sprawdzTerminy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sprawdzTerminy").timeBased().atHour(7).everyDays(1).create();

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ARKUSZ_TERMINY);
  var stan = { po: 0, wkrotce: 0, braki: 0, ok: 0 };
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 9, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      var s = String(r[0]);
      if (s === "PO TERMINIE") stan.po++;
      else if (s === "WKRÓTCE") stan.wkrotce++;
      else if (s.indexOf("UZUPEŁNIJ") === 0) stan.braki++;
      else if (s === "OK") stan.ok++;
    });
  }
  SpreadsheetApp.getUi().alert("⏰ Przypomnienia włączone\n\n" +
    "Codziennie o 7:00 system sprawdzi terminy i w razie potrzeby wyśle e-mail do: " + EMAIL_KIEROWNIKA + ".\n\n" +
    "Stan teraz:\n• po terminie: " + stan.po + "\n• w ciągu 30 dni: " + stan.wkrotce +
    "\n• do uzupełnienia: " + stan.braki + "\n• OK: " + stan.ok);
}
/* ==========================================================================
 *  PANEL ZARZĄDU (V4.8) - osobna strona tylko do odczytu, adres z parametrem ?panel=zarzad
 * ========================================================================== */
function zbierzDaneZarzadu_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var dzis = new Date(); dzis.setHours(0, 0, 0, 0);
  var MIES = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];

  function kluczM(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function etykM(d) { return MIES[d.getMonth()] + " " + d.getFullYear(); }

  // --- Harmonogram: realizacja planu, ostatnie 3 miesiące ---
  var statsByMonth = {};
  var sh = ss.getSheetByName("2. Harmonogram");
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 11).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim()) return;
      var d = new Date(String(r[6]).trim() + "T00:00:00");
      if (isNaN(d.getTime())) return;
      var key = kluczM(d);
      if (!statsByMonth[key]) statsByMonth[key] = { total: 0, done: 0, label: etykM(d) };
      var biezacy = (d.getFullYear() === dzis.getFullYear() && d.getMonth() === dzis.getMonth());
      if (biezacy && d.getTime() > dzis.getTime()) return; // dni jeszcze nie doszłe w tym miesiącu
      statsByMonth[key].total++;
      if (String(r[8]).trim().toLowerCase() === "wykonany") statsByMonth[key].done++;
    });
  }
  var kluczeM = Object.keys(statsByMonth).sort();
  var trendRealizacji = kluczeM.slice(-3).map(function (k) {
    var s = statsByMonth[k];
    return { miesiac: s.label, pct: s.total ? Math.round(s.done / s.total * 1000) / 10 : 0 };
  });
  var realizacja = trendRealizacji.length ? trendRealizacji[trendRealizacji.length - 1].pct : 0;
  var realizacjaTrend = trendRealizacji.length >= 2
    ? Math.round((trendRealizacji[trendRealizacji.length - 1].pct - trendRealizacji[trendRealizacji.length - 2].pct) * 10) / 10
    : null;

  // --- Usterki: otwarte wysokie, maszyny stojące, top maszyny, trend zgłoszeń ---
  var mapa = pobierzMapeUrzadzen_(ss);
  var otwarteWysokie = [], maszynyStojace = 0, liczTop = {}, usterkiByMonth = {};
  var ust = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (ust && ust.getLastRow() > 1) {
    var kol = Math.min(15, ust.getLastColumn());
    ust.getRange(2, 1, ust.getLastRow() - 1, kol).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim()) return;
      var status = String(r[8]).trim() || "Zgłoszona";
      var otwarta = status !== "Usunięta";
      var idU = String(r[2]).trim();
      var prio = String(r[6]).trim();
      var stoi = String(r[13] || "").trim().toUpperCase() === "TAK";

      if (otwarta && idU) liczTop[idU] = (liczTop[idU] || 0) + 1;
      if (otwarta && stoi) maszynyStojace++;

      var dataZgl = new Date(String(r[1]).replace(" ", "T"));
      if (otwarta && prio === "Wysoki") {
        var dni = isNaN(dataZgl.getTime()) ? null : Math.floor((dzis.getTime() - dataZgl.getTime()) / 86400000);
        otwarteWysokie.push({
          id: idU, nazwa: String(r[4]).trim() || (mapa[normalizujId_(idU)] ? mapa[normalizujId_(idU)].nazwa : ""),
          data: String(r[1]).trim(), opis: String(r[5]).trim(), dni: dni
        });
      }
      if (!isNaN(dataZgl.getTime())) {
        var k2 = kluczM(dataZgl);
        if (!usterkiByMonth[k2]) usterkiByMonth[k2] = { label: etykM(dataZgl), liczba: 0 };
        usterkiByMonth[k2].liczba++;
      }
    });
  }
  otwarteWysokie.sort(function (a, b) { return (b.dni || 0) - (a.dni || 0); });

  var topMaszyny = Object.keys(liczTop).map(function (id) {
    var u = mapa[normalizujId_(id)];
    return { id: id, nazwa: u ? u.nazwa : "", liczba: liczTop[id] };
  }).sort(function (a, b) { return b.liczba - a.liczba; }).slice(0, 5);

  var trendUsterek = Object.keys(usterkiByMonth).sort().slice(-3).map(function (k) { return usterkiByMonth[k]; });

  // --- UDT / kalibracje ---
  var udtDostepne = false, udtPoTerminie = 0, udtWkrotce = 0;
  var sht = ss.getSheetByName(ARKUSZ_TERMINY);
  if (sht && sht.getLastRow() > 1) {
    udtDostepne = true;
    sht.getRange(2, 9, sht.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      var s = String(r[0]);
      if (s === "PO TERMINIE") udtPoTerminie++;
      else if (s === "WKRÓTCE") udtWkrotce++;
    });
  }

  return {
    aktualizacja: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm"),
    realizacja: realizacja,
    realizacjaTrend: realizacjaTrend,
    otwarteWysokieLiczba: otwarteWysokie.length,
    maszynyStojace: maszynyStojace,
    udtDostepne: udtDostepne,
    udtProblem: udtPoTerminie + udtWkrotce,
    udtPoTerminie: udtPoTerminie,
    trendRealizacji: trendRealizacji,
    trendUsterek: trendUsterek,
    topMaszyny: topMaszyny,
    otwarteWysokie: otwarteWysokie.slice(0, 8)
  };
}

function doGetPanelZarzadu_() {
  var t = HtmlService.createTemplateFromFile('PanelZarzadu');
  try {
    t.dane = zbierzDaneZarzadu_();
    t.blad = "";
  } catch (err) {
    Logger.log("Błąd panelu zarządu: " + err.message);
    t.dane = null;
    t.blad = err.message;
  }
  return t.evaluate()
    .setTitle('CMMS Holcim – Panel Zarządu')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Pokazuje adres panelu zarządu do skopiowania i przesłania przełożonym.
 */
function pokazLinkPaneluZarzadu() {
  var url = pobierzUrlAplikacjiLubZapytaj_();
  if (!url) return;
  var link = url + "?panel=zarzad";
  var html = '<div style="font-family:Arial,sans-serif;padding:6px 4px;">' +
    '<p style="font-size:13px;color:#334155;">Link do Panelu Zarządu (tylko odczyt):</p>' +
    '<input style="width:100%;box-sizing:border-box;padding:9px;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;" ' +
      'value="' + link + '" onclick="this.select()" readonly>' +
    '<p style="font-size:11px;color:#64748b;margin-top:10px;">Otwiera się dla każdej osoby zalogowanej kontem Holcim. ' +
      'Dane liczą się na żywo z arkusza przy każdym otwarciu.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(460).setHeight(180), "📊 Link do Panelu Zarządu");
}
/**
 * Lista wszystkich maszyn (do wyszukiwania w ogólnym formularzu - tryb "Maszyna").
 */
function pobierzListeMaszyn() {
  var mapa = pobierzMapeUrzadzen_(SpreadsheetApp.getActiveSpreadsheet());
  return Object.keys(mapa).map(function (k) {
    var u = mapa[k];
    return { id: u.id, nazwa: u.nazwa, obszar: u.obszar };
  }).sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); });
}
/* ==========================================================================
 *  PANEL ZARZĄDU V2 (V4.10): poprawione liczenie + tryb przykładowy (?panel=zarzad&demo=1)
 * ========================================================================== */

/**
 * Dane przykładowe - pokazują, jak panel będzie wyglądał po kilku miesiącach używania.
 * Nie czytają ani nie zmieniają niczego w arkuszu (poza nazwami maszyn z karty urządzeń).
 */
function daneDemoZarzadu_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var mapa = pobierzMapeUrzadzen_(ss);
  var MIES = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];
  var dzis = new Date();

  function nazwa(id, zapas) { var u = mapa[normalizujId_(id)]; return u ? u.nazwa : zapas; }
  function etyk(wstecz) {
    var d = new Date(dzis.getFullYear(), dzis.getMonth() - wstecz, 1);
    return MIES[d.getMonth()] + " " + d.getFullYear();
  }
  function dataTemu(dni) {
    return Utilities.formatDate(new Date(dzis.getTime() - dni * 86400000), tz, "yyyy-MM-dd HH:mm");
  }

  return {
    aktualizacja: Utilities.formatDate(dzis, tz, "yyyy-MM-dd HH:mm"),
    realizacja: 91.4,
    realizacjaTrend: 5.8,
    otwarteWysokieLiczba: 2,
    maszynyStojace: 1,
    udtDostepne: true,
    udtProblem: 2,
    udtPoTerminie: 0,
    trendRealizacji: [
      { miesiac: etyk(2), pct: 78.3 },
      { miesiac: etyk(1), pct: 85.6 },
      { miesiac: etyk(0), pct: 91.4 }
    ],
    trendUsterek: [
      { label: etyk(2), liczba: 17 },
      { label: etyk(1), liczba: 12 },
      { label: etyk(0), liczba: 8 }
    ],
    topMaszyny: [
      { id: "1.12", nazwa: nazwa("1.12", "Pakowaczka A"), liczba: 6 },
      { id: "2.4", nazwa: nazwa("2.4", "Bęben suszarni"), liczba: 4 },
      { id: "3.14", nazwa: nazwa("3.14", "Elewator główny mieszalnika"), liczba: 3 },
      { id: "4.2", nazwa: nazwa("4.2", "Kompresor BOGE S150 x2"), liczba: 3 },
      { id: "1.17", nazwa: nazwa("1.17", "Taśmociąg łańcuchowy pod pakowaczką"), liczba: 2 }
    ],
    otwarteWysokie: [
      { id: "1.12", nazwa: nazwa("1.12", "Pakowaczka A"), data: dataTemu(4),
        opis: "Nieszczelność zaworu dozującego – wysyp materiału", dni: 4 },
      { id: "2.4", nazwa: nazwa("2.4", "Bęben suszarni"), data: dataTemu(1),
        opis: "Podwyższona temperatura łożyska napędu bębna", dni: 1 }
    ],
    przestojH30: 11.5,
    realizacjaObszary: [
      { obszar: "Kompresory", plan: 60, wykonane: 58, nok: 1, pct: 96.7, zalegle: 2 },
      { obszar: "MIXER HRB", plan: 74, wykonane: 66, nok: 3, pct: 89.2, zalegle: 8 },
      { obszar: "Rozdzielnie El.", plan: 22, wykonane: 22, nok: 0, pct: 100, zalegle: 0 },
      { obszar: "Sprężone Powietrze", plan: 30, wykonane: 27, nok: 1, pct: 90, zalegle: 3 },
      { obszar: "Suche Mieszanki", plan: 210, wykonane: 188, nok: 6, pct: 89.5, zalegle: 22 },
      { obszar: "Suszarnia Piachu", plan: 48, wykonane: 45, nok: 2, pct: 93.8, zalegle: 3 }
    ],
    aktualneUsterki: [
      { id: "UST-D1", data: dataTemu(4), idUrzadzenia: "1.12", nazwa: nazwa("1.12", "Pakowaczka A"), obszar: "Suche Mieszanki",
        opis: "Nieszczelność zaworu dozującego – wysyp materiału", priorytet: "Wysoki", zglaszajacy: "Jan Kowalski",
        status: "W trakcie", osoba: "Piotr Nowak", stoi: false, dni: 4 },
      { id: "UST-D2", data: dataTemu(1), idUrzadzenia: "2.4", nazwa: nazwa("2.4", "Bęben suszarni"), obszar: "Suszarnia Piachu",
        opis: "Podwyższona temperatura łożyska napędu bębna", priorytet: "Wysoki", zglaszajacy: "Piotr Nowak",
        status: "Zgłoszona", osoba: "", stoi: true, dni: 1 },
      { id: "UST-D3", data: dataTemu(9), idUrzadzenia: "4.2", nazwa: nazwa("4.2", "Kompresor BOGE S150 x2"), obszar: "Kompresory",
        opis: "Wyciek oleju przy filtrze", priorytet: "Średni", zglaszajacy: "Jan Kowalski",
        status: "Zgłoszona", osoba: "", stoi: false, dni: 9 }
    ],
    maszyny: listaMaszynPanelu_(mapa)
  };
}

function doGetPanelZarzadu2_(e) {
  var demo = !!(e && e.parameter && e.parameter.demo === "1");
  var t = HtmlService.createTemplateFromFile('PanelZarzadu');
  t.demo = demo;
  try {
    t.dane = demo ? daneDemoZarzadu_() : zbierzDaneZarzadu2_();
    t.blad = "";
  } catch (err) {
    Logger.log("Błąd panelu zarządu: " + err.message);
    t.dane = null;
    t.blad = err.message;
  }
  return t.evaluate()
    .setTitle('CMMS – Panel Zarządu')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function zbierzDaneZarzadu2_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var dzis = new Date(); dzis.setHours(0, 0, 0, 0);
  var MIES = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];

  function kluczM(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function etykM(d) { return MIES[d.getMonth()] + " " + d.getFullYear(); }

  // --- Harmonogram: realizacja planu, ostatnie 3 miesiące ---
  var statsByMonth = {};
  var obszary30 = {}, granica30 = dzis.getTime() - 30 * 86400000;
  var sh = ss.getSheetByName("2. Harmonogram");
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 11).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim()) return;
      var d = new Date(String(r[6]).trim() + "T00:00:00");
      if (isNaN(d.getTime())) return;
      if (d.getTime() > dzis.getTime()) return; // przyszłe terminy nie liczą się do realizacji
      var key = kluczM(d);
      var wyk = String(r[8]).trim().toLowerCase() === "wykonany";
      if (!statsByMonth[key]) statsByMonth[key] = { total: 0, done: 0, label: etykM(d) };
      statsByMonth[key].total++;
      if (wyk) statsByMonth[key].done++;
      if (d.getTime() >= granica30) {
        var ob = String(r[2]).trim() || "—";
        if (!obszary30[ob]) obszary30[ob] = { obszar: ob, plan: 0, wykonane: 0, nok: 0 };
        obszary30[ob].plan++;
        if (wyk) obszary30[ob].wykonane++;
        if (String(r[9]).trim().toUpperCase() === "NOK") obszary30[ob].nok++;
      }
    });
  }
  var realizacjaObszary = Object.keys(obszary30).sort().map(function (k) {
    var o = obszary30[k];
    o.pct = o.plan ? Math.round(o.wykonane / o.plan * 1000) / 10 : 0;
    o.zalegle = o.plan - o.wykonane;
    return o;
  });
  var kluczeM = Object.keys(statsByMonth).sort();
  var trendRealizacji = kluczeM.slice(-3).map(function (k) {
    var s = statsByMonth[k];
    return { miesiac: s.label, pct: s.total ? Math.round(s.done / s.total * 1000) / 10 : 0 };
  });
  var realizacja = trendRealizacji.length ? trendRealizacji[trendRealizacji.length - 1].pct : 0;
  var realizacjaTrend = trendRealizacji.length >= 2
    ? Math.round((trendRealizacji[trendRealizacji.length - 1].pct - trendRealizacji[trendRealizacji.length - 2].pct) * 10) / 10
    : null;

  // --- Usterki: otwarte wysokie, maszyny stojące, top maszyny, trend zgłoszeń ---
  var mapa = pobierzMapeUrzadzen_(ss);
  var otwarteWysokie = [], maszynyStojace = 0, liczTop = {}, usterkiByMonth = {}, przestojH30 = 0;
  var ust = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (ust && ust.getLastRow() > 1) {
    var kol = Math.min(15, ust.getLastColumn());
    ust.getRange(2, 1, ust.getLastRow() - 1, kol).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim()) return;
      var status = String(r[8]).trim() || "Zgłoszona";
      var otwarta = status !== "Usunięta";
      var idU = String(r[2]).trim();
      if (!mapa[normalizujId_(idU)]) return; // stary wpis bez prawidłowego ID maszyny
      var prio = String(r[6]).trim();
      var stoi = String(r[13] || "").trim().toUpperCase() === "TAK";

      if (otwarta && idU) liczTop[idU] = (liczTop[idU] || 0) + 1;
      if (otwarta && stoi) maszynyStojace++;

      var dataZgl = new Date(String(r[1]).replace(" ", "T"));
      var przestoj = parseFloat(String(r[14] || "").replace(",", "."));
      if (!isNaN(przestoj) && !isNaN(dataZgl.getTime()) && dataZgl.getTime() >= granica30) przestojH30 += przestoj;
      if (otwarta && prio === "Wysoki") {
        var dni = isNaN(dataZgl.getTime()) ? null : Math.floor((dzis.getTime() - dataZgl.getTime()) / 86400000);
        otwarteWysokie.push({
          id: idU, nazwa: String(r[4]).trim() || (mapa[normalizujId_(idU)] ? mapa[normalizujId_(idU)].nazwa : ""),
          data: String(r[1]).trim(), opis: String(r[5]).trim(), dni: dni
        });
      }
      if (!isNaN(dataZgl.getTime())) {
        var k2 = kluczM(dataZgl);
        if (!usterkiByMonth[k2]) usterkiByMonth[k2] = { label: etykM(dataZgl), liczba: 0 };
        usterkiByMonth[k2].liczba++;
      }
    });
  }
  otwarteWysokie.sort(function (a, b) { return (b.dni || 0) - (a.dni || 0); });

  var topMaszyny = Object.keys(liczTop).map(function (id) {
    var u = mapa[normalizujId_(id)];
    return { id: id, nazwa: u ? u.nazwa : "", liczba: liczTop[id] };
  }).sort(function (a, b) { return b.liczba - a.liczba; }).slice(0, 5);

  var trendUsterek = Object.keys(usterkiByMonth).sort().slice(-3).map(function (k) { return usterkiByMonth[k]; });

  // --- UDT / kalibracje ---
  var udtDostepne = false, udtPoTerminie = 0, udtWkrotce = 0;
  var sht = ss.getSheetByName(ARKUSZ_TERMINY);
  if (sht && sht.getLastRow() > 1) {
    udtDostepne = true;
    sht.getRange(2, 9, sht.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      var s = String(r[0]);
      if (s === "PO TERMINIE") udtPoTerminie++;
      else if (s === "WKRÓTCE") udtWkrotce++;
    });
  }

  return {
    aktualizacja: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm"),
    realizacja: realizacja,
    realizacjaTrend: realizacjaTrend,
    otwarteWysokieLiczba: otwarteWysokie.length,
    maszynyStojace: maszynyStojace,
    udtDostepne: udtDostepne,
    udtProblem: udtPoTerminie + udtWkrotce,
    udtPoTerminie: udtPoTerminie,
    trendRealizacji: trendRealizacji,
    trendUsterek: trendUsterek,
    topMaszyny: topMaszyny,
    otwarteWysokie: otwarteWysokie.slice(0, 8),
    przestojH30: Math.round(przestojH30 * 10) / 10,
    realizacjaObszary: realizacjaObszary,
    aktualneUsterki: pobierzOtwarteUsterki(),
    maszyny: listaMaszynPanelu_(mapa)
  };
}

function listaMaszynPanelu_(mapa) {
  return Object.keys(mapa).map(function (k) { return { id: mapa[k].id, nazwa: mapa[k].nazwa, obszar: mapa[k].obszar }; })
    .sort(function (a, b) { return a.id.localeCompare(b.id, "pl", { numeric: true }); });
}

/**
 * Panel Zarządu: pełna karta jednej maszyny - statystyki, otwarte usterki i historia zdarzeń.
 * Wywoływane dopiero po wybraniu maszyny (panel ładuje się szybko).
 */
function pobierzHistorieMaszynyZarzad(idUrzadzenia, demo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapa = pobierzMapeUrzadzen_(ss);
  var urz = mapa[normalizujId_(idUrzadzenia)];
  if (!urz) return null;
  if (demo) return daneDemoHistoriiMaszyny_(urz);
  var klucz = normalizujId_(urz.id);
  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var st = { usterki: 0, otwarte: 0, przestojH: 0, przeglady: 0, nok: 0, ostatniPrzeglad: "", ostatniaUsterka: "", nastepnyPrzeglad: "" };
  var zdarzenia = [], otwarte = [];

  var ust = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (ust && ust.getLastRow() > 1) {
    var kol = Math.max(12, Math.min(15, ust.getLastColumn()));
    ust.getRange(2, 1, ust.getLastRow() - 1, kol).getDisplayValues().forEach(function (r) {
      if (!String(r[0]).trim() || normalizujId_(r[2]) !== klucz) return;
      var status = String(r[8]).trim() || "Zgłoszona";
      var data = String(r[1]).trim();
      var przestoj = parseFloat(String(r[14] || "").replace(",", "."));
      st.usterki++;
      if (!isNaN(przestoj)) st.przestojH += przestoj;
      if (data > st.ostatniaUsterka) st.ostatniaUsterka = data;
      var u = { id: String(r[0]).trim(), data: data, opis: String(r[5]).trim(), priorytet: String(r[6]).trim(),
                zglaszajacy: String(r[7]).trim(), status: status, osoba: String(r[9] || "").trim(),
                stoi: String(r[13] || "").trim().toUpperCase() === "TAK" };
      if (status !== "Usunięta") { st.otwarte++; otwarte.push(u); }
      zdarzenia.push({ data: data, typ: "usterka", ok: status === "Usunięta",
        tytul: status === "Usunięta" ? "Usterka usunięta" : "Usterka · " + status,
        opis: u.opis + (String(r[11] || "").trim() ? " → naprawa: " + String(r[11]).trim() : ""),
        kto: u.zglaszajacy + (u.osoba ? " / " + u.osoba : ""),
        przestoj: isNaN(przestoj) ? null : przestoj, priorytet: u.priorytet, stoi: u.stoi });
    });
  }

  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (rej && rej.getLastRow() > 1) {
    rej.getRange(2, 1, rej.getLastRow() - 1, 11).getDisplayValues().forEach(function (r) {
      if (normalizujId_(r[2]) !== klucz) return;
      var ok = String(r[8]).trim().toUpperCase() !== "NOK";
      var data = String(r[5]).trim();
      st.przeglady++;
      if (!ok) st.nok++;
      if (data > st.ostatniPrzeglad) st.ostatniPrzeglad = data;
      zdarzenia.push({ data: data, typ: "przeglad", ok: ok, tytul: "Przegląd · " + (ok ? "OK" : "NOK"),
        opis: String(r[9]).trim(), kto: String(r[6]).trim(), czas: String(r[7]).trim() });
    });
  }

  var harm = ss.getSheetByName("2. Harmonogram");
  if (harm && harm.getLastRow() > 1) {
    harm.getRange(2, 1, harm.getLastRow() - 1, 9).getDisplayValues().forEach(function (r) {
      if (normalizujId_(r[1]) !== klucz || String(r[8]).trim().toLowerCase() === "wykonany") return;
      var d = String(r[6]).trim().substring(0, 10);
      if (d >= dzisStr && (!st.nastepnyPrzeglad || d < st.nastepnyPrzeglad.substring(0, 10))) st.nastepnyPrzeglad = d + " · " + String(r[4]).trim();
    });
  }

  st.przestojH = Math.round(st.przestojH * 10) / 10;
  zdarzenia.sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  otwarte.sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  return { maszyna: urz, statystyki: st, otwarte: otwarte, historia: zdarzenia.slice(0, 60) };
}

function daneDemoHistoriiMaszyny_(urz) {
  var tz = Session.getScriptTimeZone();
  function temu(dni) { return Utilities.formatDate(new Date(Date.now() - dni * 86400000), tz, "yyyy-MM-dd HH:mm"); }
  return {
    maszyna: urz,
    statystyki: { usterki: 5, otwarte: 1, przestojH: 7.5, przeglady: 38, nok: 3, ostatniPrzeglad: temu(1),
                  ostatniaUsterka: temu(4), nastepnyPrzeglad: temu(-6).substring(0, 10) + " · Tygodniowy" },
    otwarte: [{ id: "UST-D1", data: temu(4), opis: "Nieszczelność zaworu dozującego – wysyp materiału", priorytet: "Wysoki",
                zglaszajacy: "Jan Kowalski", status: "W trakcie", osoba: "Piotr Nowak", stoi: false }],
    historia: [
      { data: temu(1), typ: "przeglad", ok: true, tytul: "Przegląd · OK", opis: "Checklista: 5/5 OK", kto: "Piotr Nowak", czas: "0,5" },
      { data: temu(4), typ: "usterka", ok: false, tytul: "Usterka · W trakcie", opis: "Nieszczelność zaworu dozującego", kto: "Jan Kowalski / Piotr Nowak", priorytet: "Wysoki", stoi: false },
      { data: temu(8), typ: "przeglad", ok: false, tytul: "Przegląd · NOK", opis: "Checklista: 4/5 OK, 1 z problemem", kto: "Jan Kowalski", czas: "1" },
      { data: temu(15), typ: "usterka", ok: true, tytul: "Usterka usunięta", opis: "Zerwany pas napędu → naprawa: wymiana pasa", kto: "Piotr Nowak", przestoj: 3.5, priorytet: "Wysoki", stoi: true },
      { data: temu(22), typ: "przeglad", ok: true, tytul: "Przegląd · OK", opis: "", kto: "Piotr Nowak", czas: "0,5" }
    ]
  };
}
/**
 * Rozpoznaje maszynę z zaznaczonego wiersza - w karcie urządzeń, harmonogramie,
 * rejestrze, usterkach, terminach UDT i punktach kontrolnych.
 */
function wykryjMaszyneZArkusza_(sheet, nazwa, wiersz) {
  if (!sheet || !wiersz || wiersz < 2) return "";
  var kolumna = 0;
  if (nazwa === "1. Urządzenia") kolumna = 1;
  else if (czyArkuszHarmonogramu_(nazwa)) kolumna = 2;
  else if (nazwa === "3. Rejestr Przeglądów") kolumna = 3;
  else if (nazwa.indexOf("4. Usterki") === 0) kolumna = 3;
  else if (nazwa === ARKUSZ_TERMINY) kolumna = 2;
  else if (nazwa === "5. Punkty kontrolne") kolumna = 3;
  if (!kolumna) return "";

  var id = String(sheet.getRange(wiersz, kolumna).getDisplayValue()).trim();
  if (!id) return "";
  var urz = pobierzMapeUrzadzen_(SpreadsheetApp.getActiveSpreadsheet())[normalizujId_(id)];
  return urz ? urz.id : "";
}
/* ==========================================================================
 *  PRZYGOTOWANIE PLIKU PILOTAŻOWEGO (V4.11)
 *  URUCHAMIAĆ WYŁĄCZNIE W KOPII ARKUSZA - kasuje dane spoza wybranego obszaru.
 * ========================================================================== */

function przygotujPilotaz() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var shU = ss.getSheetByName("1. Urządzenia");
  if (!shU || shU.getLastRow() < 2) { ui.alert("Brak karty urządzeń."); return; }

  // Lista obszarów z karty urządzeń
  var dane = shU.getRange(2, 1, shU.getLastRow() - 1, 2).getDisplayValues();
  var obszary = [];
  dane.forEach(function (r) {
    var o = String(r[1]).trim();
    if (o && obszary.indexOf(o) < 0) obszary.push(o);
  });
  if (!obszary.length) { ui.alert("Nie znaleziono obszarów w karcie urządzeń."); return; }

  var lista = obszary.map(function (o, i) {
    var ile = dane.filter(function (r) { return String(r[1]).trim() === o; }).length;
    return (i + 1) + ". " + o + " (" + ile + " maszyn)";
  }).join("\n");

  var odp = ui.prompt("🧪 Przygotowanie pliku pilotażowego",
    "UWAGA: ta operacja USUWA z tego pliku wszystkie maszyny spoza wybranego obszaru,\n" +
    "kasuje rejestr przeglądów, usterki i przeszłe terminy w harmonogramie.\n\n" +
    "Uruchamiaj TYLKO w KOPII arkusza.\n\n" +
    "Wpisz numer obszaru do pilotażu:\n\n" + lista,
    ui.ButtonSet.OK_CANCEL);
  if (odp.getSelectedButton() !== ui.Button.OK) return;

  var nr = parseInt(String(odp.getResponseText()).trim(), 10);
  if (!(nr >= 1 && nr <= obszary.length)) { ui.alert("Nieprawidłowy numer."); return; }
  var obszar = obszary[nr - 1];

  var potw = ui.alert("🧪 Potwierdzenie",
    "Zostawiam tylko obszar: " + obszar + "\n\n" +
    "Wszystkie pozostałe maszyny i dane historyczne zostaną z tego pliku usunięte.\n" +
    "Czy to jest KOPIA arkusza (nie plik produkcyjny)?", ui.ButtonSet.YES_NO);
  if (potw !== ui.Button.YES) return;

  ss.toast("Przygotowuję plik pilotażowy…", "🧪 Pilotaż", 20);

  // 1) Karta urządzeń - usuwamy maszyny spoza obszaru (od dołu, żeby nie pogubić wierszy)
  var usuniete = 0;
  for (var w = shU.getLastRow(); w >= 2; w--) {
    if (String(shU.getRange(w, 2).getDisplayValue()).trim() !== obszar) { shU.deleteRow(w); usuniete++; }
  }
  var zostalo = Math.max(shU.getLastRow() - 1, 0);

  // 2) Rejestr i usterki - czyścimy historię
  ["3. Rejestr Przeglądów", "4. Usterki i Awarie", "4. Usterki i Awaria"].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });

  // 3) Terminy UDT - zostawiamy tylko maszyny z obszaru
  var shT = ss.getSheetByName(ARKUSZ_TERMINY);
  if (shT && shT.getLastRow() > 1) {
    var mapa = pobierzMapeUrzadzen_(ss);
    for (var t = shT.getLastRow(); t >= 2; t--) {
      var idT = String(shT.getRange(t, 2).getDisplayValue()).trim();
      if (!mapa[normalizujId_(idT)]) shT.deleteRow(t);
    }
  }

  // 4) Harmonogram od nowa, bez przeszłych terminów
  generujHarmonogram2026();
  var shH = ss.getSheetByName("2. Harmonogram");
  var dzis = new Date(); dzis.setHours(0, 0, 0, 0);
  var przyciete = 0;
  if (shH && shH.getLastRow() > 1) {
    var wiersze = shH.getRange(2, 1, shH.getLastRow() - 1, 11).getDisplayValues();
    var zostawione = wiersze.filter(function (r) {
      if (!String(r[0]).trim()) return false;
      var d = new Date(String(r[6]).trim() + "T00:00:00");
      if (isNaN(d.getTime())) return false;
      if (d.getTime() < dzis.getTime()) { przyciete++; return false; }
      return true;
    });
    shH.getRange(2, 1, wiersze.length, 11).clearContent();
    if (zostawione.length) {
      shH.getRange(2, 1, zostawione.length, 2).setNumberFormat("@");
      shH.getRange(2, 1, zostawione.length, 11).setValues(zostawione);
    }
    formatujArkuszHarmonogramu(shH);
  }

  // 5) Arkusze miesięczne i dashboard od nowa
  generujArkuszeMiesieczne();
  utworzDashboardCMMS();
  uporzadkujZakladki_();

  // 6) Oznaczenie pliku
  try {
    if (ss.getName().indexOf("PILOTAŻ") < 0) ss.rename(ss.getName() + " – PILOTAŻ " + obszar);
    PropertiesService.getScriptProperties().setProperty("CMMS_PILOTAZ", obszar);
  } catch (e) { Logger.log("Zmiana nazwy pliku: " + e.message); }

  ui.alert("🧪 Plik pilotażowy gotowy\n\n" +
    "Obszar: " + obszar + "\n" +
    "Maszyn w pliku: " + zostalo + " (usunięto " + usuniete + ")\n" +
    "Usunięto przeszłych terminów z harmonogramu: " + przyciete + "\n" +
    "Rejestr i usterki: wyczyszczone\n\n" +
    "KOLEJNE KROKI:\n" +
    "1. Wdróż aplikację z TEGO pliku (Rozszerzenia → Apps Script → Wdróż → Nowe wdrożenie).\n" +
    "2. ⚙️ CMMS System → 🏗️ → 📷 Wygeneruj Kody QR – podaj NOWY adres /exec.\n" +
    "3. Wydrukuj etykiety QR i wklej na maszyny.\n" +
    "4. Uzupełnij arkusz „6. Pracownicy”.\n" +
    "5. ⚙️ CMMS System → 🛠️ → ⚙️ Zainstaluj wyzwalacze.");
}
/* ==========================================================================
 *  WIELE CZĘSTOTLIWOŚCI NA MASZYNĘ (V4.12)
 *  Kolumna "Częstotliwość" może zawierać np. "Codzienny / Tygodniowy / Miesięczny".
 *  Kolumna "Zakres" może mieć osobne sekcje: [D] ... [T] ... [M] ...
 * ========================================================================== */

var CZEST_NAZWY = { D: "Codzienny", T: "Tygodniowy", M: "Miesięczny" };

/** Zamienia zapis z arkusza na listę liter: "Codzienna / Miesięczna" -> ["D","M"] */
function rozbijCzestotliwosci_(tekst) {
  var wynik = [];
  String(tekst || "").split(/[\/,;+]+/).forEach(function (cz) {
    var t = cz.toLowerCase().trim();
    if (!t) return;
    var l = "";
    if (t.indexOf("codzien") === 0) l = "D";
    else if (t.indexOf("tydz") === 0 || t.indexOf("tygod") === 0) l = "T";
    else if (t.indexOf("mies") === 0) l = "M";
    if (l && wynik.indexOf(l) < 0) wynik.push(l);
  });
  return wynik;
}

/** Wyciąga z opisu sekcję dla danej częstotliwości; bez znaczników zwraca całość. */
function zakresDlaCzestotliwosci_(zakres, litera) {
  var txt = String(zakres || "");
  if (!/\[[DTMR]\]/i.test(txt)) return txt.trim();
  var re = new RegExp("\\[" + litera + "\\]([\\s\\S]*?)(?=\\[[DTMR]\\]|$)", "i");
  var m = txt.match(re);
  return m ? m[1].trim() : "";
}

function budujIdPrzegladu2_(idUrzadzenia, litera, strDate) {
  return "PRZ-" + String(idUrzadzenia).trim() + "-" + litera + "-" + String(strDate).replace(/-/g, "");
}

function generujHarmonogramV2___zapis(spreadsheetObj) {
  var ss = spreadsheetObj || SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var dataStart = new Date(HARM_START.getTime());
  var dataKoniec = new Date(HARM_KONIEC.getTime());

  var sheetUrz = ss.getSheetByName("1. Urządzenia");
  if (!sheetUrz || sheetUrz.getLastRow() < 2) return;

  var urzData = sheetUrz.getRange(2, 1, sheetUrz.getLastRow() - 1, 5).getDisplayValues();
  var sheetHarm = ss.getSheetByName("2. Harmonogram") || ss.insertSheet("2. Harmonogram", 2);
  var zapamietane = pobierzRozliczeniaZHarmonogramow_(ss);
  var strStart = Utilities.formatDate(dataStart, tz, "yyyy-MM-dd");

  var harmonogramRows = [], uzyteId = {};

  for (var d = new Date(dataStart); d <= dataKoniec; d.setDate(d.getDate() + 1)) {
    var strDate = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    var dayOfWeek = d.getDay(), dayOfMonth = d.getDate();

    for (var u = 0; u < urzData.length; u++) {
      var idUrz = String(urzData[u][0]).trim();
      if (!idUrz) continue;

      var obszar = String(urzData[u][1]).trim();
      var nazwa = String(urzData[u][2]).trim();
      var zakresPelny = String(urzData[u][3]).trim();
      var litery = rozbijCzestotliwosci_(urzData[u][4]);

      for (var k = 0; k < litery.length; k++) {
        var lit = litery[k], planuj = false;
        if (lit === "D") planuj = (dayOfWeek >= 1 && dayOfWeek <= 5);
        else if (lit === "T") planuj = (dayOfWeek === 2);
        else if (lit === "M") planuj = (dayOfMonth === 1 || strDate === strStart);
        if (!planuj) continue;

        var idPrzegladu = budujIdPrzegladu2_(idUrz, lit, strDate);
        if (uzyteId[idPrzegladu]) continue;
        uzyteId[idPrzegladu] = true;

        // rozliczenia: najpierw nowe ID, potem stare (bez litery) - żeby nic nie zginęło
        var zapis = zapamietane[normalizujId_(idPrzegladu)] ||
                    (litery.length === 1 ? zapamietane[normalizujId_(budujIdPrzegladu_(idUrz, strDate))] : null) || null;

        harmonogramRows.push([
          idPrzegladu, idUrz, obszar, nazwa, CZEST_NAZWY[lit] || lit,
          zakresDlaCzestotliwosci_(zakresPelny, lit) || zakresPelny, strDate,
          zapis ? zapis.wykonawca : "",
          zapis ? zapis.status : "Zaplanowany",
          zapis ? zapis.wynik : "-",
          zapis ? zapis.rozliczenie : ""
        ]);
      }
    }
  }

  sheetHarm.clear();
  sheetHarm.getRange(1, 1, 1, 11).setValues([NAGLOWKI_HARM]);
  if (harmonogramRows.length > 0) {
    sheetHarm.getRange(2, 1, harmonogramRows.length, 2).setNumberFormat("@");
    sheetHarm.getRange(2, 1, harmonogramRows.length, 11).setValues(harmonogramRows);
  }

  uwzglednijSwieta_(sheetHarm);
  formatujArkuszHarmonogramu(sheetHarm);
  Logger.log("Harmonogram V2: " + harmonogramRows.length + " pozycji");
}


/* ==========================================================================
 *  APLIKACJA PRZEGLĄDÓW: STATYSTYKI DO NAGŁÓWKA + OTWIERANIE Z ARKUSZA (V4.8)
 * ========================================================================== */

/**
 * Liczniki do kafli w nagłówku aplikacji (laptop): rozliczenia z dzisiejszą datą w Rejestrze,
 * otwarte usterki i maszyny, które stoją. Czyta tylko potrzebne kolumny.
 */
function pobierzStatystykiPrzegladow() {
  return zCache_("cmms_stat", 60, czytajStatystykiPrzegladow_);
}
function czytajStatystykiPrzegladow_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var wynik = { rozliczoneDzis: 0, otwarteUsterki: 0, maszynyStoja: 0 };

  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (rej && rej.getLastRow() > 1) {
    rej.getRange(2, 6, rej.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
      if (String(r[0]).trim().substring(0, 10) === dzisStr) wynik.rozliczoneDzis++;
    });
  }

  var sh = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (sh && sh.getLastRow() > 1) {
    var kol = Math.max(9, Math.min(14, sh.getLastColumn()));
    sh.getRange(2, 1, sh.getLastRow() - 1, kol).getDisplayValues().forEach(function (wiersz) {
      var r = wyrownajWierszUsterki_(wiersz, null);
      if (!String(r[0]).trim() || String(r[8]).trim() === "Usunięta") return;
      wynik.otwarteUsterki++;
      if (String(r[13] || "").trim().toUpperCase() === "TAK") wynik.maszynyStoja++;
    });
  }
  return wynik;
}

/**
 * Otwiera aplikację przeglądów (Web App) w nowej karcie przeglądarki - na laptopie
 * wykorzystuje cały ekran zamiast okna dialogowego w arkuszu.
 */
function otworzAplikacjePrzegladow() {
  var url = pobierzUrlAplikacjiLubZapytaj_();
  if (!url) return;
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:6px 4px;">' +
      '<p style="font-size:14px;color:#334155;margin:0 0 12px;">Aplikacja przeglądów otwiera się w nowej karcie.</p>' +
      '<a id="lnk" href="' + escHtml_(url) + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;">' +
        'Otwórz aplikację →</a>' +
      '<p style="font-size:12px;color:#64748b;margin-top:12px;">Jeśli karta się nie otworzyła, kliknij przycisk powyżej ' +
        '(przeglądarka mogła zablokować wyskakujące okno).</p>' +
    '</div>' +
    '<script>var w = window.open(' + JSON.stringify(url).replace(/</g, "\\u003c") + ', "_blank");' +
    'if (w) google.script.host.close();</script>'
  ).setWidth(380).setHeight(190);
  SpreadsheetApp.getUi().showModalDialog(html, "🖥️ Aplikacja przeglądów");
}

/**
 * Wszystkie otwarte usterki (status inny niż "Usunięta") - lista do obsługi w aplikacji.
 * Kolejność: maszyny stojące, potem priorytet, potem najstarsze zgłoszenia.
 */
function pobierzOtwarteUsterki() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (!sh || sh.getLastRow() < 2) return [];
  var mapa = pobierzMapeUrzadzen_(ss);
  var tz = ss.getSpreadsheetTimeZone();
  var dzis = new Date(Utilities.formatDate(new Date(), tz, "yyyy-MM-dd") + "T00:00:00").getTime();
  var WAGA = { "Wysoki": 0, "Średni": 1, "Niski": 2 };
  var kol = Math.max(12, Math.min(15, sh.getLastColumn()));
  var wynik = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, kol).getDisplayValues().forEach(function (wiersz) {
    if (!String(wiersz[0]).trim()) return;
    var r = wyrownajWierszUsterki_(wiersz, mapa);
    var status = String(r[8]).trim() || "Zgłoszona";
    if (status === "Usunięta") return;
    var idU = String(r[2]).trim();
    var u = mapa[normalizujId_(idU)] || null;
    var d = new Date(String(r[1]).trim().substring(0, 10) + "T00:00:00").getTime();
    wynik.push({
      id: String(r[0]).trim(), data: String(r[1]).trim(),
      idUrzadzenia: u ? u.id : idU, nazwa: String(r[4]).trim() || (u ? u.nazwa : idU), obszar: String(r[3]).trim() || (u ? u.obszar : ""),
      znanaMaszyna: !!u && !r.przesuniety, staryUklad: !!r.przesuniety, opis: String(r[5]).trim(), priorytet: String(r[6]).trim() || "Średni",
      zglaszajacy: String(r[7]).trim(), status: status, osoba: String(r[9] || "").trim(),
      stoi: String(r[13] || "").trim().toUpperCase() === "TAK",
      dni: isNaN(d) ? null : Math.round((dzis - d) / 86400000)
    });
  });
  wynik.sort(function (a, b) {
    return (b.stoi - a.stoi) || ((a.priorytet in WAGA ? WAGA[a.priorytet] : 1) - (b.priorytet in WAGA ? WAGA[b.priorytet] : 1)) || ((b.dni || 0) - (a.dni || 0));
  });
  return wynik;
}

/**
 * Przeglądy rozliczone dziś (wpisy w "3. Rejestr Przeglądów" z dzisiejszą datą) - kafel "Rozliczone dziś".
 */
function pobierzRozliczoneDzis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (!rej || rej.getLastRow() < 2) return [];
  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var mapa = pobierzMapeUrzadzen_(ss);
  var wynik = [];
  rej.getRange(2, 1, rej.getLastRow() - 1, 11).getDisplayValues().forEach(function (r) {
    var data = String(r[5]).trim();
    if (data.substring(0, 10) !== dzisStr) return;
    var u = mapa[normalizujId_(r[2])] || null;
    wynik.push({
      id: String(r[0]).trim(), idPrzegladu: String(r[1]).trim(), idUrzadzenia: u ? u.id : String(r[2]).trim(),
      nazwa: String(r[4]).trim() || (u ? u.nazwa : ""), obszar: String(r[3]).trim() || (u ? u.obszar : ""),
      znanaMaszyna: !!u, data: data, wykonawca: String(r[6]).trim(), czas: String(r[7]).trim(),
      nok: String(r[8]).trim().toUpperCase() === "NOK", opis: String(r[9]).trim()
    });
  });
  wynik.sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  return wynik;
}

/* ==========================================================================
 *  PAMIĘĆ PODRĘCZNA (V4.11) - szybkie otwieranie aplikacji z linku i z kodu QR
 *  Dane czytane z arkusza trafiają do CacheService (wspólnego dla wszystkich użytkowników).
 *  Każdy zapis z aplikacji, każda funkcja menu zmieniająca dane i każda ręczna edycja
 *  arkusza czyści pamięć, a dodatkowo wpisy wygasają same (bezpiecznik).
 * ========================================================================== */

var KLUCZE_CACHE = ["cmms_start", "cmms_mapa", "cmms_prac", "cmms_stat"];

function cacheSkryptu_() { return CacheService.getScriptCache(); }

/** Wartość z pamięci albo obliczona funkcją fn i zapamiętana (duże wartości dzielone na części po 90 KB). */
function zCache_(klucz, sekundy, fn) {
  var c = null;
  try { c = cacheSkryptu_(); } catch (e) { return fn(); }
  try {
    var ile = c.get(klucz + "#n");
    if (ile) {
      var klucze = [];
      for (var i = 0; i < +ile; i++) klucze.push(klucz + "#" + i);
      var czesci = c.getAll(klucze);
      var tekst = "", komplet = true;
      klucze.forEach(function (k) { if (czesci[k] == null) komplet = false; else tekst += czesci[k]; });
      if (komplet) return JSON.parse(tekst);
    }
  } catch (e1) {}
  var v = fn();
  try {
    var s = JSON.stringify(v), CZ = 90000, wpisy = {}, n = Math.ceil(s.length / CZ) || 1;
    if (n <= 20) {
      for (var j = 0; j < n; j++) wpisy[klucz + "#" + j] = s.substring(j * CZ, (j + 1) * CZ);
      c.putAll(wpisy, sekundy);
      c.put(klucz + "#n", String(n), sekundy);
    }
  } catch (e2) {}
  return v;
}

function wyczyscCache_(klucze) {
  try {
    var c = cacheSkryptu_();
    (klucze || KLUCZE_CACHE).forEach(function (k) { c.remove(k + "#n"); });
    if (!klucze || klucze.indexOf("cmms_prac") >= 0) c.put("cmms_prac_wersja", String(Date.now()), 21600);
  } catch (e) {}
}

function wersjaPracownikow_() {
  try { return cacheSkryptu_().get("cmms_prac_wersja") || "0"; } catch (e) { return "0"; }
}

/** Ręczna edycja arkusza (onEdit) - czyści tylko to, czego dotyczy zmieniony arkusz. */
function wyczyscCacheDlaArkusza_(nazwa) {
  if (czyArkuszHarmonogramu_(nazwa)) wyczyscCache_(["cmms_start", "cmms_stat"]);
  else if (nazwa === "1. Urządzenia") wyczyscCache_(["cmms_mapa", "cmms_start"]);
  else if (nazwa === ARKUSZ_PRACOWNICY) wyczyscCache_(["cmms_prac"]);
  else if (nazwa.indexOf("3. Rejestr") === 0 || nazwa.indexOf("4. Usterki") === 0) wyczyscCache_(["cmms_stat"]);
}

/** Menu: ręczne wyczyszczenie pamięci (np. po zmianach wprowadzonych skryptem albo importem). */
function wyczyscPamiecAplikacji() {
  wyczyscCache_();
  SpreadsheetApp.getActiveSpreadsheet().toast("Pamięć podręczna aplikacji wyczyszczona – następne otwarcie przeczyta arkusz od nowa.", "⚡ CMMS", 5);
}

/**
 * Dane startowe aplikacji, liczone JEDNYM odczytem harmonogramu (kolumny A–I) i trzymane w pamięci:
 *  - lista: niewykonane przeglądy zaległe + do 14 dni (spakowane jak dla aplikacji),
 *  - dalej: dla każdej maszyny najbliższy przegląd później niż za 14 dni (potrzebny po skanie QR).
 * Klucz zawiera datę, więc po północy liczy się od nowa (zmienia się liczba dni do terminu).
 */
function daneStartowe_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dzisStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var d = zCache_("cmms_start", 900, function () { return liczDaneStartowe_(ss, dzisStr); });
  if (d && d.dzien !== dzisStr) {
    wyczyscCache_(["cmms_start"]);
    d = zCache_("cmms_start", 900, function () { return liczDaneStartowe_(ss, dzisStr); });
  }
  return d;
}

function liczDaneStartowe_(ss, dzisStr) {
  var HORYZONT_DNI = 14;
  var wynik = { dzien: dzisStr, lista: spakujPrzeglady_([]), dalej: {} };
  var sheet = ss.getSheetByName("2. Harmonogram");
  if (!sheet) { wynik.lista = spakujPrzeglady_(czytajPrzegladyDoFormularza_("")); return wynik; }
  if (sheet.getLastRow() < 2) return wynik;
  var dzis = new Date(dzisStr + "T00:00:00").getTime();
  var dane = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getDisplayValues();
  var lista = [];
  for (var i = 0; i < dane.length; i++) {
    var r = dane[i];
    var id = String(r[0] || "").trim();
    if (!id || String(r[8]).trim().toLowerCase() === "wykonany") continue;
    var dataStr = String(r[6] || "").trim().substring(0, 10);
    var t = new Date(dataStr + "T00:00:00").getTime();
    if (isNaN(t)) continue;
    var dni = Math.round((t - dzis) / 86400000);
    var p = {
      idPrzegladu: id, idUrzadzenia: String(r[1] || "").trim(), obszar: String(r[2] || "").trim(),
      nazwaUrzadzenia: String(r[3] || "").trim(), czestotliwosc: String(r[4] || "").trim(), zakres: String(r[5] || "").trim(),
      dataPlanowana: dataStr, status: String(r[8] || "").trim(), czyWykonany: false, dni: dni,
      kategoria: dni < 0 ? "zalegly" : (dni === 0 ? "dzis" : "nadchodzacy")
    };
    if (dni <= HORYZONT_DNI) { lista.push(p); continue; }
    var k = normalizujId_(p.idUrzadzenia);
    if (!wynik.dalej[k] || dni < wynik.dalej[k].dni) { p.zakres = ""; wynik.dalej[k] = p; }
  }
  lista.sort(function (a, b) {
    if (a.dni !== b.dni) return a.dni - b.dni;
    if (a.obszar !== b.obszar) return a.obszar.localeCompare(b.obszar);
    return a.nazwaUrzadzenia.localeCompare(b.nazwaUrzadzenia);
  });
  wynik.lista = spakujPrzeglady_(lista);
  return wynik;
}

/** Odwrotność spakujPrzeglady_ (po stronie serwera). */
function rozpakujPrzeglady_(d) {
  return ((d && d.w) || []).map(function (w) {
    var m = d.m[w[1]] || ["", ""], dni = w[4], wyk = w[6] === 1;
    return { idPrzegladu: w[0], idUrzadzenia: w[1], nazwaUrzadzenia: m[0], obszar: m[1], czestotliwosc: w[2],
             dataPlanowana: w[3], dni: dni, zakres: d.z[w[5]] || "", czyWykonany: wyk, status: wyk ? "Wykonany" : "",
             kategoria: wyk ? "wykonany" : (dni < 0 ? "zalegly" : (dni === 0 ? "dzis" : "nadchodzacy")) };
  });
}

function zapiszRozliczenie() {
  try { return zapiszRozliczenie__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function generujHarmonogramV2_() {
  try { return generujHarmonogramV2___zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function generujArkuszeMiesieczne() {
  try { return generujArkuszeMiesieczne__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function oznaczZalegleePrzeglady() {
  try { return oznaczZalegleePrzeglady__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function migrujStareIdPrzegladow() {
  try { return migrujStareIdPrzegladow__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function naprawFormatIdUrzadzen() {
  try { return naprawFormatIdUrzadzen__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function aktualizujKarteUrzadzenKrakow() {
  try { return aktualizujKarteUrzadzenKrakow__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function utworzArkuszPracownikow() {
  try { return utworzArkuszPracownikow__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function zglosAwarie() {
  try { return zglosAwarie__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function zmienStatusUsterki() {
  try { return zmienStatusUsterki__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function naprawUsterkiIdUrzadzen() {
  try { return naprawUsterkiIdUrzadzen__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}
function naprawStruktureWszystkichHarmonogramow() {
  try { return naprawStruktureWszystkichHarmonogramow__zapis.apply(this, arguments); } finally { wyczyscCache_(); }
}

/* ==========================================================================
 *  WYGLĄD ARKUSZA V5 - Start, Dziś, jeden styl wszystkich zakładek, porządek, ochrona
 *  Zmienia wyłącznie wygląd, układ i widoki. Dane, nazwy zakładek i kolumny
 *  (z których korzysta aplikacja) zostają bez zmian.
 * ========================================================================== */

var ARKUSZ_START = "🏠 Start";
var ARKUSZ_DZIS = "📅 Dziś";
var CZCIONKA = "Roboto";
var PALETA = {
  granat: "#0f172a", tekst: "#0f172a", szary: "#64748b", jasny: "#f8fafc", linia: "#e5e7eb", tlo: "#f1f5f9",
  start: "#0f172a", dzis: "#1d4ed8", urzadzenia: "#334155", harmonogram: "#1e40af", rejestr: "#6d28d9",
  usterki: "#b91c1c", terminy: "#b45309", pracownicy: "#0f766e", dashboard: "#0f172a",
  czerwony: "#dc2626", czerwonyTlo: "#fee2e2", zolty: "#b45309", zoltyTlo: "#fef3c7",
  zielony: "#047857", zielonyTlo: "#d1fae5", niebieski: "#1d4ed8", niebieskiTlo: "#dbeafe"
};

/** Menu: 🎨 Odśwież wygląd arkusza */
function nowyWygladArkusza() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast("Odświeżam wygląd arkusza… (do 1–2 minut)", "🎨 CMMS", 20);
  var bledy = [];
  function krokW(nazwa, fn) { try { fn(); } catch (e) { bledy.push(nazwa + ": " + e.message); Logger.log(nazwa + ": " + e.stack); } }

  krokW("Start", zbudujStart_);
  krokW("Dziś", zbudujDzis_);
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (czyArkuszHarmonogramu_(n)) krokW(n, function () { formatujArkuszHarmonogramu(sh); });
  });
  var urz = ss.getSheetByName("1. Urządzenia");
  if (urz) krokW("Urządzenia", function () { formatujArkuszUrzadzen_(urz); });
  krokW("Usterki", function () { formatujArkuszUsterek(); });
  krokW("Rejestr", stylRejestru_);
  krokW("Terminy", function () { var t = ss.getSheetByName(ARKUSZ_TERMINY); if (t) { naprawFormulyTerminow_(t); stylOgolny_(t, PALETA.terminy, { zamrozKolumny: 3 }); } });
  krokW("Pracownicy", function () { var t = ss.getSheetByName(ARKUSZ_PRACOWNICY); if (t) stylOgolny_(t, PALETA.pracownicy, { zamrozKolumny: 1 }); });
  krokW("Dashboard", function () { var t = ss.getSheetByName("0. Dashboard CMMS"); if (t) t.setHiddenGridlines(true); });
  krokW("Kolejność zakładek", function () { porzadekZakladek_(true); });
  krokW("Ochrona", ustawOchrone_);

  var start = ss.getSheetByName(ARKUSZ_START);
  if (start) ss.setActiveSheet(start);
  if (bledy.length) SpreadsheetApp.getUi().alert("🎨 Wygląd odświeżony, ale kilka kroków się nie udało:\n\n• " + bledy.join("\n• "));
  else ss.toast("Gotowe – nowy wygląd arkusza.", "🎨 CMMS", 6);
}

function przejdzDoStartu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARKUSZ_START);
  if (!sh) { zbudujStart_(); sh = ss.getSheetByName(ARKUSZ_START); porzadekZakladek_(false); }
  ss.setActiveSheet(sh);
}
function przejdzDoWidokuDzis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ARKUSZ_DZIS);
  if (!sh) { zbudujDzis_(); sh = ss.getSheetByName(ARKUSZ_DZIS); porzadekZakladek_(false); }
  ss.setActiveSheet(sh);
}

/* ---------- pomocnicze do formuł ---------- */

/** Polska nazwa dnia tygodnia w formule (TEXT(…,"dddd") zależy od ustawień regionalnych pliku). */
function fDzien_(x) { return 'CHOOSE(WEEKDAY(' + x + ',2),"poniedziałek","wtorek","środa","czwartek","piątek","sobota","niedziela")'; }
function refArkusza_(nazwa) { return "'" + String(nazwa).replace(/'/g, "''") + "'!"; }
function nazwaArkuszaUsterek_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName("4. Usterki i Awarie") ? "4. Usterki i Awarie" : (ss.getSheetByName("4. Usterki i Awaria") ? "4. Usterki i Awaria" : "4. Usterki i Awarie");
}
/** Data z komórki, która może być datą albo tekstem "rrrr-mm-dd ..." (jak zapisuje aplikacja). 0 gdy pusta. */
function fData_(ref) { return 'IFERROR(INT(IFERROR(DATEVALUE(LEFT(' + ref + '&"",10)),' + ref + ')),0)'; }
function linkDoArkusza_(nazwa) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nazwa);
  return sh ? "#gid=" + sh.getSheetId() : "";
}
function hiperlacze_(url, tekst) { return '=HYPERLINK("' + url + '","' + String(tekst).replace(/"/g, '""') + '")'; }

/** Przygotowuje pusty arkusz-widok o zadanym rozmiarze (tworzy albo czyści). */
function arkuszWidoku_(nazwa, kolumny, wiersze) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nazwa) || ss.insertSheet(nazwa, 0);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (String(p.getDescription()).indexOf("CMMS:") === 0) p.remove(); });
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations().clearNote();
  if (sh.getMaxColumns() < kolumny) sh.insertColumnsAfter(sh.getMaxColumns(), kolumny - sh.getMaxColumns());
  if (sh.getMaxColumns() > kolumny) sh.deleteColumns(kolumny + 1, sh.getMaxColumns() - kolumny);
  if (sh.getMaxRows() < wiersze) sh.insertRowsAfter(sh.getMaxRows(), wiersze - sh.getMaxRows());
  if (sh.getMaxRows() > wiersze) sh.deleteRows(wiersze + 1, sh.getMaxRows() - wiersze);
  sh.setFrozenRows(0); sh.setFrozenColumns(0);
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, wiersze, kolumny).setFontFamily(CZCIONKA).setFontColor(PALETA.tekst).setVerticalAlignment("middle");
  return sh;
}

/* ==========================================================================
 *  🏠 START - strona główna pliku
 * ========================================================================== */
function zbudujStart_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var KOL = 11, WIER = 34;
  var sh = arkuszWidoku_(ARKUSZ_START, KOL, WIER);
  if (!ss.getSheetByName(ARKUSZ_DZIS)) zbudujDzis_();

  var H = refArkusza_("2. Harmonogram"), R = refArkusza_("3. Rejestr Przeglądów"), U = refArkusza_(nazwaArkuszaUsterek_());
  var dG = fData_(H + "G2:G");

  // siatka: marginesy, 5 kafli, odstępy
  [16, 172, 12, 172, 12, 172, 12, 172, 12, 172, 16].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setRowHeights(1, WIER, 22);
  sh.getRange(1, 1, WIER, KOL).setBackground(PALETA.tlo);

  // nagłówek
  sh.setRowHeight(1, 14);
  sh.getRange("B2:J2").merge().setValue("📋  CMMS · Utrzymanie Ruchu — Kraków Nowa Huta")
    .setFontSize(20).setFontWeight("bold").setFontColor(PALETA.granat);
  sh.setRowHeight(2, 42);
  sh.getRange("B3:J3").merge().setFormula('="Stan na: " & ' + fDzien_("NOW()") + ' & ", " & TEXT(NOW(),"dd.mm.yyyy") & ", godz. " & TEXT(NOW(),"HH:mm") & "   ·   liczby liczą się same przy każdej zmianie w arkuszu"')
    .setFontSize(10).setFontColor(PALETA.szary);
  sh.setRowHeight(4, 14);

  // KAFLE
  var dzis = linkDoArkusza_(ARKUSZ_DZIS), ust = linkDoArkusza_(nazwaArkuszaUsterek_()), rej = linkDoArkusza_("3. Rejestr Przeglądów");
  var zalegle = 'SUMPRODUCT((' + H + 'A2:A<>"")*(' + H + 'I2:I<>"Wykonany")*(' + dG + '>0)*(' + dG + '<TODAY()))';
  var planDzis = 'SUMPRODUCT((' + H + 'A2:A<>"")*(' + dG + '=TODAY()))';
  var wykDzis = 'SUMPRODUCT((' + H + 'A2:A<>"")*(' + dG + '=TODAY())*(' + H + 'I2:I="Wykonany"))';
  var rozlDzis = 'SUMPRODUCT(--(' + fData_(R + "F2:F") + '=TODAY()))';
  var otwarte = 'SUMPRODUCT((' + U + 'A2:A<>"")*(' + U + 'I2:I<>"Usunięta"))';
  var wysokie = 'SUMPRODUCT((' + U + 'A2:A<>"")*(' + U + 'I2:I<>"Usunięta")*(' + U + 'G2:G="Wysoki"))';
  var stoja = 'COUNTIFS(' + U + 'N2:N,"TAK",' + U + 'I2:I,"<>Usunięta")';
  var kafle = [
    { kol: 2, et: "ZALEGŁE PRZEGLĄDY", f: zalegle, pod: '="po terminie, niewykonane"', kolor: PALETA.czerwony, tlo: "#fff1f2", link: dzis },
    { kol: 4, et: "NA DZIŚ DO ZROBIENIA", f: planDzis + "-" + wykDzis, pod: '="wykonano " & ' + wykDzis + ' & " z " & ' + planDzis, kolor: PALETA.zolty, tlo: "#fffbeb", link: dzis },
    { kol: 6, et: "ROZLICZONE DZIŚ", f: rozlDzis, pod: '="wpisy w Rejestrze"', kolor: PALETA.zielony, tlo: "#ecfdf5", link: rej },
    { kol: 8, et: "OTWARTE USTERKI", f: otwarte, pod: '="w tym priorytet Wysoki: " & ' + wysokie, kolor: "#c2410c", tlo: "#fff7ed", link: ust },
    { kol: 10, et: "MASZYNY STOJĄ", f: stoja, pod: '=IF(' + stoja + '=0,"wszystkie pracują ✓","zgłoszone jako „stoi”")', kolor: PALETA.czerwony, tlo: "#fef2f2", link: ust }
  ];
  sh.setRowHeight(5, 26); sh.setRowHeight(6, 52); sh.setRowHeight(7, 26);
  kafle.forEach(function (k) {
    var blok = sh.getRange(5, k.kol, 3, 1);
    blok.setBackground(k.tlo).setHorizontalAlignment("left")
      .setBorder(true, true, true, true, null, null, "#e2e8f0", SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(5, k.kol).setValue("  " + k.et).setFontSize(8).setFontWeight("bold").setFontColor(PALETA.szary).setVerticalAlignment("bottom");
    sh.getRange(6, k.kol).setFormula('=HYPERLINK("' + k.link + '","  "&' + k.f + ')')
      .setFontSize(30).setFontWeight("bold").setFontColor(k.kolor).setVerticalAlignment("middle").setFontLine("none");
    sh.getRange(7, k.kol).setFormula(k.pod.replace(/^=/, '="  "&')).setFontSize(9).setFontColor(PALETA.szary).setVerticalAlignment("top");
  });
  // pasek koloru pod kaflem
  sh.setRowHeight(8, 5);
  kafle.forEach(function (k) { sh.getRange(8, k.kol).setBackground(k.kolor); });
  sh.setRowHeight(9, 22);

  // PRZEJDŹ DO
  sh.getRange("B10:J10").merge().setValue("PRZEJDŹ DO").setFontSize(9).setFontWeight("bold").setFontColor(PALETA.szary);
  var url = "";
  try { url = PropertiesService.getScriptProperties().getProperty("CMMS_URL_APLIKACJI") || ""; } catch (e) {}
  var przyciski = [
    [ [ARKUSZ_DZIS, "📅  Dziś i zaległe", PALETA.dzis], [nazwaArkuszaUsterek_(), "🔧  Usterki i awarie", PALETA.usterki],
      ["2. Harmonogram", "🗓️  Harmonogram", PALETA.harmonogram], ["3. Rejestr Przeglądów", "📘  Rejestr przeglądów", PALETA.rejestr],
      ["1. Urządzenia", "🏭  Urządzenia (110)", PALETA.urzadzenia] ],
    [ ["0. Dashboard CMMS", "📊  Dashboard i wykresy", PALETA.dashboard], [ARKUSZ_TERMINY, "⏱️  Terminy UDT", PALETA.terminy],
      [ARKUSZ_PRACOWNICY, "👷  Pracownicy", PALETA.pracownicy], ["@app", "📱  Aplikacja przeglądów", "#2563eb"], ["@panel", "📈  Panel Zarządu", "#2563eb"] ]
  ];
  [11, 13].forEach(function (wiersz, r) {
    sh.setRowHeight(wiersz, 40);
    przyciski[r].forEach(function (b, i) {
      var c = sh.getRange(wiersz, 2 + i * 2), cel = "";
      if (b[0] === "@app") cel = url; else if (b[0] === "@panel") cel = url ? url + "?panel=zarzad" : "";
      else cel = linkDoArkusza_(b[0]);
      if (cel) c.setFormula(hiperlacze_(cel, b[1])).setBackground(b[2]).setFontColor("#ffffff");
      else c.setValue(b[1] + (b[0].charAt(0) === "@" ? " (ustaw adres)" : " (brak)")).setBackground("#cbd5e1").setFontColor("#475569");
      c.setFontSize(10).setFontWeight("bold").setHorizontalAlignment("center").setFontLine("none");
    });
  });
  sh.setRowHeight(12, 8);
  sh.setRowHeight(14, 22);

  // REALIZACJA WG OBSZARU (30 dni)
  sh.getRange("B15:J15").merge().setValue("REALIZACJA PLANU WG OBSZARU — ostatnie 30 dni").setFontSize(9).setFontWeight("bold").setFontColor(PALETA.szary);
  sh.getRange(16, 2, 1, 9).setValues([["Obszar", "", "Zaplanowane", "", "Wykonane", "", "Realizacja", "", "Postęp"]])
    .setFontSize(9).setFontWeight("bold").setFontColor(PALETA.szary).setBackground("#e2e8f0");
  var obszary = [];
  var urz = ss.getSheetByName("1. Urządzenia");
  if (urz && urz.getLastRow() > 1) urz.getRange(2, 2, urz.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) {
    var o = String(r[0]).trim(); if (o && obszary.indexOf(o) < 0) obszary.push(o);
  });
  obszary.slice(0, 10).forEach(function (o, i) {
    var w = 17 + i;
    var okno = '(' + H + 'C2:C=$B' + w + ')*(' + dG + '<=TODAY())*(' + dG + '>TODAY()-30)';
    sh.getRange(w, 2).setValue(o).setFontWeight("bold");
    sh.getRange(w, 1).setBackground(kolorObszaruMocny_(o));
    sh.getRange(w, 4).setFormula('=SUMPRODUCT(' + okno + ')').setHorizontalAlignment("center");
    sh.getRange(w, 6).setFormula('=SUMPRODUCT(' + okno + '*(' + H + 'I2:I="Wykonany"))').setHorizontalAlignment("center");
    sh.getRange(w, 8).setFormula('=IF(D' + w + '=0,"–",F' + w + '/D' + w + ')').setNumberFormat("0%").setHorizontalAlignment("center").setFontWeight("bold");
    sh.getRange(w, 10).setFormula('=IF(D' + w + '=0,"",SPARKLINE(F' + w + '/D' + w + ',{"charttype","bar";"max",1;"color1",IF(F' + w + '/D' + w + '>=0.8,"#10b981",IF(F' + w + '/D' + w + '>=0.5,"#f59e0b","#ef4444"));"color2","#e2e8f0"}))');
    sh.getRange(w, 2, 1, 9).setBackground("#ffffff").setBorder(null, null, true, null, null, null, PALETA.linia, SpreadsheetApp.BorderStyle.SOLID);
  });
  var poObszarach = 17 + Math.min(obszary.length, 10);
  var rOb = sh.getRange(17, 8, Math.max(1, poObszarach - 17), 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0.8).setFontColor(PALETA.zielony).setRanges([rOb]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0.5, 0.7999).setFontColor(PALETA.zolty).setRanges([rOb]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0.5).setFontColor(PALETA.czerwony).setRanges([rOb]).build()
  ]);

  // JAK TO DZIAŁA
  var wI = poObszarach + 1;
  sh.getRange(wI, 2, 1, 9).merge().setValue("JAK TO DZIAŁA").setFontSize(9).setFontWeight("bold").setFontColor(PALETA.szary);
  var instr = [
    "📱  Technik rozlicza przegląd i zgłasza awarię w aplikacji na telefonie — skan kodu QR na maszynie albo link z przycisku „Aplikacja przeglądów”.",
    "📅  Kierownik zaczyna dzień od zakładki „Dziś”: przeglądy na dziś, zaległe i otwarte usterki — wszystko liczy się samo.",
    "🔧  Usterki obsługuje się w aplikacji (W trakcie / Usunięta). Czas przestoju liczy się sam, gdy maszyna stała.",
    "✏️  Kolumny z ID i datami są chronione ostrzeżeniem — zmiany planu rób przez menu ⚙️ CMMS System, nie ręcznie."
  ];
  instr.forEach(function (t, i) {
    sh.getRange(wI + 1 + i, 2, 1, 9).merge().setValue(t).setFontSize(10).setFontColor("#334155").setWrap(true);
    sh.setRowHeight(wI + 1 + i, 26);
  });
  sh.getRange(1, 1, WIER, KOL).setFontFamily(CZCIONKA);
  sh.setTabColor(PALETA.start);
}

/** Mocniejsza wersja koloru obszaru (pasek przy nazwie). */
function kolorObszaruMocny_(o) {
  var m = { "Suche Mieszanki": "#3b82f6", "Suszarnia Piachu": "#f59e0b", "MIXER HRB": "#8b5cf6",
            "Kompresory": "#10b981", "Sprężone Powietrze": "#06b6d4", "Rozdzielnie El.": "#ef4444" };
  return m[o] || "#94a3b8";
}

/* ==========================================================================
 *  📅 DZIŚ - widok roboczy (formuły na żywo)
 * ========================================================================== */
function zbudujDzis_() {
  var KOL = 22, WIER = 600;
  var sh = arkuszWidoku_(ARKUSZ_DZIS, KOL, WIER);
  var H = refArkusza_("2. Harmonogram"), U = refArkusza_(nazwaArkuszaUsterek_());
  var dG = fData_(H + "G2:G"), dU = fData_(U + "B2:B");

  // A | B-F dziś | G | H-M zaległe | N | O-U usterki | V
  [12, 55, 250, 125, 95, 110, 16, 55, 250, 130, 80, 60, 50, 16, 230, 55, 280, 75, 90, 50, 50, 12]
    .forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  sh.getRange("B1:U1").merge().setFormula('="📅  Dziś · " & ' + fDzien_("TODAY()") + ' & ", " & TEXT(TODAY(),"dd.mm.yyyy")')
    .setFontSize(18).setFontWeight("bold").setFontColor(PALETA.granat);
  sh.setRowHeight(1, 44);
  sh.getRange("B2:U2").merge().setValue("Widok liczy się sam z Harmonogramu i Usterek. Rozliczenia i obsługa usterek — w aplikacji. Kliknij nagłówek sekcji, żeby przejść do pełnej zakładki.")
    .setFontSize(9).setFontColor(PALETA.szary);
  sh.setRowHeight(3, 10);

  var sekcje = [
    { od: 2, szer: 5, kolor: "#b45309", tlo: "#fffbeb", cel: "2. Harmonogram",
      tytul: '="🟡  NA DZIŚ DO ZROBIENIA  (" & SUMPRODUCT((' + H + 'A2:A<>"")*(' + H + 'I2:I<>"Wykonany")*(' + dG + '=TODAY())) & ")"',
      nagl: ["ID", "Maszyna", "Obszar", "Częstotliwość", "Wykonawca"],
      f: '=IFERROR(ARRAYFORMULA(SORT(FILTER({' + H + 'B2:B,' + H + 'D2:D,' + H + 'C2:C,' + H + 'E2:E,' + H + 'H2:H},' +
         H + 'A2:A<>"",' + H + 'I2:I<>"Wykonany",' + dG + '=TODAY()),3,TRUE,2,TRUE)),"✅ Wszystko na dziś zrobione")' },
    { od: 8, szer: 6, kolor: PALETA.czerwony, tlo: "#fff1f2", cel: "2. Harmonogram",
      tytul: '="🔴  ZALEGŁE — najstarsze na górze  (" & SUMPRODUCT((' + H + 'A2:A<>"")*(' + H + 'I2:I<>"Wykonany")*(' + dG + '>0)*(' + dG + '<TODAY())) & ")"',
      nagl: ["ID", "Maszyna", "Obszar", "Częst.", "Termin", "Dni"],
      f: '=IFERROR(ARRAYFORMULA(SORT(FILTER({' + H + 'B2:B,' + H + 'D2:D,' + H + 'C2:C,' + H + 'E2:E,' + dG + ',TODAY()-' + dG + '},' +
         H + 'A2:A<>"",' + H + 'I2:I<>"Wykonany",' + dG + '>0,' + dG + '<TODAY()),6,FALSE,3,TRUE)),"✅ Brak zaległości")' },
    { od: 15, szer: 7, kolor: "#c2410c", tlo: "#fff7ed", cel: nazwaArkuszaUsterek_(),
      tytul: '="🔧  OTWARTE USTERKI — stojące i pilne na górze  (" & SUMPRODUCT((' + U + 'A2:A<>"")*(' + U + 'I2:I<>"Usunięta")*(' + U + 'I2:I<>"")) & ")"',
      nagl: ["Maszyna", "ID", "Opis", "Priorytet", "Status", "Stoi", "Dni"],
      f: '=IFERROR(ARRAYFORMULA(CHOOSECOLS(SORT(FILTER({' + U + 'E2:E,' + U + 'C2:C,' + U + 'F2:F,' + U + 'G2:G,' + U + 'I2:I,' + U + 'N2:N,TODAY()-' + dU + ',' +
         '(' + U + 'N2:N="TAK")*1,IFERROR(MATCH(' + U + 'G2:G,{"Wysoki";"Średni";"Niski"},0),2)},' +
         U + 'A2:A<>"",' + U + 'I2:I<>"Usunięta",' + U + 'I2:I<>""),8,FALSE,9,TRUE,7,FALSE),1,2,3,4,5,6,7)),"✅ Brak otwartych usterek")' }
  ];
  sh.setRowHeight(4, 34); sh.setRowHeight(5, 26);
  sekcje.forEach(function (s) {
    var cel = linkDoArkusza_(s.cel);
    sh.getRange(4, s.od, 1, s.szer).merge()
      .setFormula('=HYPERLINK("' + cel + '",' + s.tytul.replace(/^=/, "") + ')')
      .setFontSize(11).setFontWeight("bold").setFontColor("#ffffff").setBackground(s.kolor).setFontLine("none");
    sh.getRange(5, s.od, 1, s.szer).setValues([s.nagl]).setFontSize(8).setFontWeight("bold")
      .setFontColor(PALETA.szary).setBackground(s.tlo)
      .setBorder(null, null, true, null, null, null, s.kolor, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(6, s.od).setFormula(s.f);
    var cialo = sh.getRange(6, s.od, WIER - 5, s.szer);
    cialo.setFontSize(10).setVerticalAlignment("middle").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
      .setBorder(null, null, null, null, null, true, "#eef2f7", SpreadsheetApp.BorderStyle.SOLID);
  });
  // formaty kolumn
  sh.getRange("B6:B").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("@");
  sh.getRange("C6:C").setFontWeight("bold");
  sh.getRange("H6:H").setFontWeight("bold").setHorizontalAlignment("center").setNumberFormat("@");
  sh.getRange("I6:I").setFontWeight("bold");
  sh.getRange("L6:L").setNumberFormat("dd.mm").setHorizontalAlignment("center");
  sh.getRange("M6:M").setNumberFormat("0").setHorizontalAlignment("center").setFontWeight("bold");
  sh.getRange("O6:O").setFontWeight("bold");
  sh.getRange("P6:P").setHorizontalAlignment("center").setNumberFormat("@");
  sh.getRange("Q6:Q").setFontSize(9);
  sh.getRange("R6:U").setHorizontalAlignment("center");
  sh.getRange("U6:U").setNumberFormat("0");

  var r = function (a) { return sh.getRange(a); };
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$M6>7').setFontColor(PALETA.czerwony).setBold(true).setRanges([r("M6:M")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$T6="TAK"').setBackground("#fee2e2").setRanges([r("O6:U")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("TAK").setFontColor(PALETA.czerwony).setBold(true).setRanges([r("T6:T")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Wysoki").setFontColor(PALETA.czerwony).setBold(true).setRanges([r("R6:R")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Średni").setFontColor(PALETA.zolty).setBold(true).setRanges([r("R6:R")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("W trakcie").setBackground(PALETA.zoltyTlo).setFontColor("#92400e").setRanges([r("S6:S")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Zgłoszona").setBackground(PALETA.czerwonyTlo).setFontColor("#991b1b").setRanges([r("S6:S")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$U6>7').setFontColor(PALETA.czerwony).setBold(true).setRanges([r("U6:U")]).build()
  ]);
  sh.setRowHeights(6, WIER - 5, 24);
  sh.setFrozenRows(5);
  sh.setTabColor(PALETA.dzis);
}

/* ==========================================================================
 *  JEDEN STYL ZAKŁADEK Z DANYMI
 * ========================================================================== */

/** Wspólny, lekki styl: nagłówek w kolorze zakładki, bez siatki, cienkie linie poziome, zamrożony nagłówek, filtr. */
function stylOgolny_(sh, kolor, opcje) {
  opcje = opcje || {};
  var lastRow = Math.max(sh.getLastRow(), 2), lastCol = Math.max(sh.getLastColumn(), 1);
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, sh.getMaxRows(), lastCol).setFontFamily(CZCIONKA);
  sh.getRange(1, 1, 1, lastCol).setBackground(kolor).setFontColor("#ffffff").setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true)
    .setBorder(false, false, false, false, false, false);
  sh.setRowHeight(1, 36);
  sh.setFrozenRows(1);
  if (opcje.zamrozKolumny !== undefined) sh.setFrozenColumns(opcje.zamrozKolumny);
  var cialo = sh.getRange(2, 1, lastRow - 1, lastCol);
  cialo.setVerticalAlignment("middle")
    .setBorder(false, false, true, false, false, true, PALETA.linia, SpreadsheetApp.BorderStyle.SOLID);
  if (opcje.pasy) {
    sh.getBandings().forEach(function (b) { b.remove(); });
    var bd = sh.getRange(1, 1, lastRow, lastCol).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
    bd.setHeaderRowColor(kolor).setFirstRowColor("#ffffff").setSecondRowColor(PALETA.jasny);
  }
  ustawFiltr_(sh, sh.getRange(1, 1, lastRow, lastCol));
  sh.setTabColor(kolor);
}

/** Zakłada filtr na zakresie; istniejący filtr w arkuszu jest najpierw usuwany (arkusz może mieć tylko jeden). */
function ustawFiltr_(sh, zakres) {
  try { var f = sh.getFilter(); if (f) f.remove(); zakres.createFilter(); } catch (e) { Logger.log("Filtr " + sh.getName() + ": " + e.message); }
}

/** Harmonogram (zbiorczy i miesięczne) - V5. */
function formatujArkuszHarmonogramu(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });
  sheet.getRange(1, 1, Math.max(lastRow, 2), 11).clearDataValidations();
  sheet.setHiddenGridlines(true);

  sheet.getRange(1, 1, 1, 11).setValues([NAGLOWKI_HARM]).setFontFamily(CZCIONKA)
    .setFontWeight("bold").setFontSize(9).setBackground(PALETA.harmonogram).setFontColor("#ffffff")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 36);
  sheet.setFrozenRows(1);

  if (lastRow >= 2) {
    var n = lastRow - 1;
    var range = sheet.getRange(2, 1, n, 11);
    range.setFontFamily(CZCIONKA).setVerticalAlignment("middle").setFontSize(10).setFontColor(PALETA.tekst)
      .setFontWeight("normal").setFontStyle("normal").setWrap(false);
    sheet.getRange(2, 1, n, 2).setNumberFormat("@").setHorizontalAlignment("center");
    sheet.getRange(2, 1, n, 1).setFontSize(8).setFontColor("#94a3b8");
    sheet.getRange(2, 2, n, 1).setFontWeight("bold");
    sheet.getRange(2, 3, n, 1).setFontSize(9).setFontColor("#475569");
    sheet.getRange(2, 4, n, 1).setFontWeight("bold").setWrap(true);
    sheet.getRange(2, 5, n, 1).setHorizontalAlignment("center").setFontSize(9);
    sheet.getRange(2, 6, n, 1).setWrap(true).setFontSize(9).setFontColor("#475569");
    sheet.getRange(2, 7, n, 1).setNumberFormat("yyyy-mm-dd").setHorizontalAlignment("center").setFontWeight("bold");
    sheet.getRange(2, 8, n, 1).setFontSize(9);
    sheet.getRange(2, 9, n, 2).setHorizontalAlignment("center").setFontWeight("bold").setFontSize(9);
    sheet.getRange(2, 11, n, 1).setWrap(true).setFontSize(8).setFontColor("#475569");

    sheet.getRange(2, 9, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(["Zaplanowany", "Wykonany", "Zaległy"], true).setAllowInvalid(true).build());
    sheet.getRange(2, 10, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(["OK", "NOK", "-"], true).setAllowInvalid(true).build());

    // pasy dzienne: każdy dzień ma swoje tło + wyraźna linia na granicy dni
    var daty = sheet.getRange(2, 7, n, 1).getDisplayValues();
    var tla = [], poprzednia = null, jasny = true;
    for (var r = 0; r < n; r++) {
      if (daty[r][0] !== poprzednia) { jasny = !jasny; poprzednia = daty[r][0]; }
      var k = jasny ? PALETA.jasny : "#ffffff";
      tla.push([k, k, k, k, k, k, k, k, k, k, k]);
    }
    range.setBackgrounds(tla);
    range.setBorder(false, false, true, false, false, true, "#eef2f7", SpreadsheetApp.BorderStyle.SOLID);

    sheet.clearConditionalFormatRules();
    var rI = sheet.getRange(2, 9, n, 1), rJ = sheet.getRange(2, 10, n, 1), rG = sheet.getRange(2, 7, n, 1);
    var rAH = sheet.getRange(2, 1, n, 8), rCaly = sheet.getRange(2, 1, n, 11);
    var dataG = 'IFERROR(DATEVALUE($G2),$G2)';
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I2="Wykonany"').setFontColor("#94a3b8").setRanges([rAH]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I2="Wykonany"').setBackground(PALETA.zielonyTlo).setFontColor("#065f46").setRanges([rI]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(' + dataG + '<TODAY(),$I2<>"Wykonany")').setBackground(PALETA.czerwonyTlo).setFontColor("#991b1b").setRanges([rI, rG]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(' + dataG + '=TODAY(),$I2<>"Wykonany")').setBackground("#fef9c3").setRanges([rCaly]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Zaplanowany").setBackground(PALETA.niebieskiTlo).setFontColor("#1e40af").setRanges([rI]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK").setBackground(PALETA.zielonyTlo).setFontColor("#065f46").setRanges([rJ]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("NOK").setBackground(PALETA.czerwonyTlo).setFontColor("#991b1b").setRanges([rJ]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("-").setFontColor("#cbd5e1").setRanges([rJ]).build()
    ]);
  }

  sheet.setFrozenColumns(4);
  [95, 55, 105, 210, 85, 260, 115, 115, 95, 55, 220].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  ustawFiltr_(sheet, sheet.getRange(1, 1, Math.max(lastRow, 2), 11));
  sheet.setTabColor(sheet.getName() === "2. Harmonogram" ? PALETA.harmonogram : "#93c5fd");
  sheet.getRange(1, 1).setNote(
    "LEGENDA:\n• Żółty wiersz = do zrobienia dziś\n• Czerwony status/data = po terminie\n• Szary wiersz = wykonany\n" +
    "• Pasy tła = kolejne dni\n\nWidok dnia: zakładka „📅 Dziś”. Skok do dzisiaj: ⚙️ CMMS System → Harmonogram → Przejdź do dzisiejszych.");
}

/** Karta urządzeń - V5. */
function formatujArkuszUrzadzen_(sheet) {
  formatujArkuszUrzadzenV4_(sheet);
  var n = sheet.getLastRow() - 1;
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, Math.max(n + 1, 2), 6).setFontFamily(CZCIONKA);
  sheet.getRange(1, 1, 1, 6).setBackground(PALETA.urzadzenia).setFontSize(9);
  sheet.setRowHeight(1, 36);
  if (n >= 1) {
    var dane = sheet.getRange(2, 1, n, 6);
    dane.setBorder(false, false, true, false, false, true, PALETA.linia, SpreadsheetApp.BorderStyle.SOLID);
    // kod QR tylko gdy kolumna F ma obrazki/formuły - wtedy wysoki wiersz; inaczej zwarta lista
    var maQR = sheet.getRange(2, 6, n, 1).getFormulas().some(function (r) { return r[0]; });
    if (!maQR) sheet.autoResizeRows(2, n);
    sheet.getRange(2, 2, n, 1).setFontColor(PALETA.tekst);
  }
  sheet.setTabColor(PALETA.urzadzenia);
}

/** Usterki i awarie - V5 (kolumny A–O, w tym Źródło / Maszyna stoi / Czas przestoju). */
function formatujArkuszUsterek(sheet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet || typeof sheet.getName !== "function") sheet = ss.getSheetByName("4. Usterki i Awarie") || ss.getSheetByName("4. Usterki i Awaria");
  if (!sheet) return;
  arkuszUsterek_(ss);   // dopilnuj kolumn M–O
  formatujArkuszUsterekV4_(sheet);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });
  var KOL = 15, ostatni = Math.max(sheet.getLastRow(), 2);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, sheet.getMaxRows(), KOL).setFontFamily(CZCIONKA);
  sheet.getRange(1, 1, 1, KOL).setBackground(PALETA.usterki).setFontColor("#ffffff").setFontWeight("bold").setFontSize(9)
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  sheet.setRowHeight(1, 36);
  sheet.getRange(2, 1, ostatni - 1, KOL).setBorder(false, false, true, false, false, true, PALETA.linia, SpreadsheetApp.BorderStyle.SOLID);
  var bd = sheet.getRange(1, 1, ostatni, KOL).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  bd.setHeaderRowColor(PALETA.usterki).setFirstRowColor("#ffffff").setSecondRowColor(PALETA.jasny);
  sheet.getRange("M2:M").setHorizontalAlignment("center").setFontSize(9).setFontColor(PALETA.szary);
  sheet.getRange("N2:N").setHorizontalAlignment("center").setFontWeight("bold");
  sheet.getRange("O2:O").setHorizontalAlignment("center").setNumberFormat("0.0");
  sheet.getRange("N2:N").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["TAK", "NIE"], true).setAllowInvalid(true).build());
  [100, 118, 60, 120, 190, 260, 75, 125, 100, 125, 118, 220, 95, 70, 80].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  var reguly = sheet.getConditionalFormatRules();
  var rCaly = sheet.getRange("A2:O"), rB = sheet.getRange("B2:B"), rN = sheet.getRange("N2:N");
  var wiek = 'TODAY()-IFERROR(INT(IFERROR(DATEVALUE(LEFT($B2&"",10)),$B2)),TODAY())';
  reguly.unshift(
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($N2="TAK",$I2<>"Usunięta")').setBackground("#fee2e2").setRanges([rCaly]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$I2<>"Usunięta",' + wiek + '>7)').setFontColor(PALETA.czerwony).setBold(true).setRanges([rB]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($N2="TAK",$I2<>"Usunięta")').setFontColor(PALETA.czerwony).setBold(true).setRanges([rN]).build()
  );
  sheet.setConditionalFormatRules(reguly);
  sheet.setFrozenColumns(5);
  ustawFiltr_(sheet, sheet.getRange(1, 1, ostatni, KOL));
  sheet.setTabColor(PALETA.usterki);
  sheet.getRange("B1").setNote("Czerwona data = usterka otwarta dłużej niż 7 dni. Czerwony wiersz = maszyna stoi.");
}

/** Rejestr przeglądów - tylko wygląd (bez przebudowy danych). */
function stylRejestru_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("3. Rejestr Przeglądów");
  if (!sh || sh.getLastRow() < 1) return;
  var KOL = 11, ostatni = Math.max(sh.getLastRow(), 2);
  if (sh.getFilter()) sh.getFilter().remove();
  stylOgolny_(sh, PALETA.rejestr, { pasy: true, zamrozKolumny: 0 });
  var n = ostatni - 1;
  sh.getRange(2, 1, n, KOL).setFontSize(10).setVerticalAlignment("middle");
  sh.getRange(2, 1, n, 2).setFontSize(8).setFontColor("#94a3b8").setHorizontalAlignment("center");
  sh.getRange(2, 3, n, 1).setHorizontalAlignment("center").setFontWeight("bold").setNumberFormat("@");
  sh.getRange(2, 4, n, 1).setFontSize(9).setFontColor("#475569");
  sh.getRange(2, 5, n, 1).setFontWeight("bold").setWrap(true);
  sh.getRange(2, 6, n, 1).setHorizontalAlignment("center").setNumberFormat("yyyy-mm-dd hh:mm").setFontSize(9);
  sh.getRange(2, 8, n, 1).setHorizontalAlignment("center").setNumberFormat("0.0#");
  sh.getRange(2, 9, n, 1).setHorizontalAlignment("center").setFontWeight("bold");
  sh.getRange(2, 10, n, 2).setWrap(true).setFontSize(9);
  [110, 150, 60, 120, 210, 125, 130, 60, 65, 260, 220].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var rI = sh.getRange("I2:I"), rCaly = sh.getRange("A2:K");
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("OK").setBackground(PALETA.zielonyTlo).setFontColor("#065f46").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("NOK").setBackground(PALETA.czerwonyTlo).setFontColor("#991b1b").setRanges([rI]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",REGEXMATCH($B2&"","^PRZ-\\d{4}-\\d+$"))').setFontColor("#94a3b8").setItalic(true).setRanges([rCaly]).build()
  ]);
  ustawFiltr_(sh, sh.getRange(1, 1, ostatni, KOL));
  sh.getRange("B1").setNote("Szare, pochyłe wpisy = archiwalne (stare ID przeglądu, sprzed obecnego harmonogramu).");
}

/* ==========================================================================
 *  KOLEJNOŚĆ ZAKŁADEK, UKRYCIE TECHNICZNYCH, OCHRONA
 * ========================================================================== */
function porzadekZakladek_(ukryjTechniczne) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aktywny = ss.getActiveSheet();
  var kod = pobierzKodAktualnegoMiesiaca();
  // kolejność = numery w nazwach zakładek (0, 1, 2, 3…), widoki na początku, miesiące harmonogramu za harmonogramem
  var miesiace = ss.getSheets().map(function (sh) { return sh.getName(); })
    .filter(function (n) { return n.indexOf("Harmonogram - ") === 0; })
    .sort(function (a, b) {
      var x = a.replace("Harmonogram - ", "").split("."), y = b.replace("Harmonogram - ", "").split(".");
      return (x[1] + x[0]).localeCompare(y[1] + y[0]);
    });
  var kolejnosc = [ARKUSZ_START, ARKUSZ_DZIS, "0. Dashboard CMMS", "1. Urządzenia", "2. Harmonogram"]
    .concat(miesiace)
    .concat(["3. Rejestr Przeglądów", nazwaArkuszaUsterek_(), ARKUSZ_PRACOWNICY, ARKUSZ_TERMINY]);
  var poz = 1;
  kolejnosc.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) return;
    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh); ss.moveActiveSheet(poz++);
  });
  var kolory = {}; kolory[ARKUSZ_START] = PALETA.start; kolory[ARKUSZ_DZIS] = PALETA.dzis;
  kolory[nazwaArkuszaUsterek_()] = PALETA.usterki; kolory["2. Harmonogram"] = PALETA.harmonogram;
  kolory["3. Rejestr Przeglądów"] = PALETA.rejestr; kolory["1. Urządzenia"] = PALETA.urzadzenia;
  kolory[ARKUSZ_TERMINY] = PALETA.terminy; kolory["0. Dashboard CMMS"] = PALETA.dashboard; kolory[ARKUSZ_PRACOWNICY] = PALETA.pracownicy;
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    if (kolory[n]) sh.setTabColor(kolory[n]);
    else if (n.indexOf("Harmonogram - ") === 0) sh.setTabColor(n === "Harmonogram - " + kod ? "#3b82f6" : "#bfdbfe");
    var techniczny = n.indexOf("Form Responses") === 0 || n.indexOf("Odpowiedzi") === 0 || n === "stare urzadzenia" || n.indexOf("Etykiety QR") >= 0;
    if (techniczny) { sh.setTabColor("#cbd5e1"); if (ukryjTechniczne && !sh.isSheetHidden() && ss.getSheets().length > 1) sh.hideSheet(); }
  });
  var start = ss.getSheetByName(ARKUSZ_START);
  ss.setActiveSheet(start || aktywny);
}

/** Ochrona "tylko ostrzeżenie": nie blokuje nikogo, ale pyta przed zmianą kolumn z kluczami i widoków. */
function ustawOchrone_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).concat(sh.getProtections(SpreadsheetApp.ProtectionType.SHEET))
      .forEach(function (p) { if (String(p.getDescription()).indexOf("CMMS:") === 0) p.remove(); });
  });
  function chron(zakres, opis) { var p = zakres.protect().setDescription("CMMS: " + opis); p.setWarningOnly(true); }
  [ARKUSZ_START, ARKUSZ_DZIS].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh) { var p = sh.protect().setDescription("CMMS: widok liczony automatycznie"); p.setWarningOnly(true); }
  });
  ss.getSheets().forEach(function (sh) {
    if (!czyArkuszHarmonogramu_(sh.getName()) || sh.getLastRow() < 2) return;
    chron(sh.getRange(2, 1, sh.getMaxRows() - 1, 7), "plan przeglądów (ID, maszyna, zakres, data) – zmieniaj przez menu");
  });
  var rej = ss.getSheetByName("3. Rejestr Przeglądów");
  if (rej) chron(rej.getRange(2, 1, rej.getMaxRows() - 1, 3), "ID wpisów w Rejestrze – zapisuje aplikacja");
  var urz = ss.getSheetByName("1. Urządzenia");
  if (urz) chron(urz.getRange(2, 1, urz.getMaxRows() - 1, 1), "ID urządzeń – zmiana rozłącza historię i kody QR");
  var ust = ss.getSheetByName(nazwaArkuszaUsterek_());
  if (ust) chron(ust.getRange(2, 1, ust.getMaxRows() - 1, 2), "ID i data zgłoszenia usterki");
  var ter = ss.getSheetByName(ARKUSZ_TERMINY);
  if (ter) chron(ter.getRange(2, 7, ter.getMaxRows() - 1, 3), "Następny termin, dni i status liczą się same – wpisz datę w „Ostatnie wykonanie”");
}

/**
 * "7. Terminy UDT i kalibracje": kolumny G–I (Następny termin, Dni, Status) liczą formuły z G2/H2/I2.
 * Ręczny wpis w kolumnie G kasuje formułę dla całej kolumny (#VALUE!). Tu formuły są przywracane,
 * a ręcznie wpisany "następny termin" zamieniany na "ostatnie wykonanie" (termin minus okres), żeby nic nie zginęło.
 */
function naprawFormulyTerminow_(sh) {
  if (sh.getLastRow() < 2) return;
  var fG = '=ARRAYFORMULA(IF(A2:A="","",IF((E2:E="")+(F2:F=""),"",DATE(YEAR(E2:E),MONTH(E2:E)+F2:F,DAY(E2:E)))))';
  var fH = '=ARRAYFORMULA(IF(G2:G="","",G2:G-TODAY()))';
  var fI = '=ARRAYFORMULA(IF(A2:A="","",IF(E2:E="","UZUPEŁNIJ DATĘ",IF(F2:F="","UZUPEŁNIJ OKRES",IF(H2:H<0,"PO TERMINIE",IF(H2:H<=30,"WKRÓTCE","OK"))))))';
  var formuly = sh.getRange("G2:I2").getFormulas()[0];
  if (formuly[0] && formuly[1] && formuly[2]) return;   // wszystko w porządku

  var n = sh.getLastRow() - 1;
  var e = sh.getRange(2, 5, n, 1).getValues(), f = sh.getRange(2, 6, n, 1).getValues(), g = sh.getRange(2, 7, n, 1).getValues();
  var przeniesione = 0;
  for (var i = 0; i < n; i++) {
    var termin = g[i][0];
    if (!(termin instanceof Date)) {
      var m = String(termin || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/) || String(termin || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      termin = m ? (m[1].length === 4 ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(+m[3], +m[2] - 1, +m[1])) : null;
    }
    var okres = parseInt(f[i][0], 10);
    if (termin && !e[i][0] && okres > 0) {
      e[i][0] = new Date(termin.getFullYear(), termin.getMonth() - okres, termin.getDate());
      przeniesione++;
    }
  }
  if (przeniesione) sh.getRange(2, 5, n, 1).setValues(e).setNumberFormat("dd.mm.yyyy");
  sh.getRange("G2:I").clearContent();
  sh.getRange("G2").setFormula(fG);
  sh.getRange("H2").setFormula(fH);
  sh.getRange("I2").setFormula(fI);
  sh.getRange("G2:G").setNumberFormat("dd.mm.yyyy");
  sh.getRange("H2:H").setNumberFormat("0");
  if (przeniesione) sh.getRange("E1").setNote("Uzupełnione automatycznie (" + przeniesione + " poz.): ręcznie wpisany „Następny termin” zamieniono na „Ostatnie wykonanie” = termin minus okres. Sprawdź daty. Kolumny G–I liczą się same – nie wpisuj w nie.");
}
