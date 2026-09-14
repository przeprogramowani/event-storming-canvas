# Event Storming Board 🟧🟦🟪

Lokalna tablica warsztatowa dla uczestników i moderatora AI, przygotowana jako
materiał dydaktyczny **10xDevs 3.0 — AI-Native Software Development**.
Przeglądarki otrzymują zmiany na żywo przez SSE. Tablica pozostaje czytelnym
plikiem JSON, a zapis z przeglądarki i agenta przechodzi przez wspólny mechanizm
kontroli wersji.

## Uruchomienie

Wymagany **Node.js 24 LTS**, aktualne wydanie poprawkowe. `.nvmrc` wskazuje linię
24; przy użyciu nvm: `nvm install` i `nvm use`.

```bash
npm start
# http://127.0.0.1:4000

# macOS/Linux: inny port
PORT=8080 npm start
```

Uruchomienie nie wymaga `npm install`: aplikacja nie ma zależności produkcyjnych.
Serwer nasłuchuje wyłącznie na `127.0.0.1`. To narzędzie lokalne; nie wystawiaj go
przez publiczny tunel ani reverse proxy. Zdalne warsztaty wymagają osobnej warstwy
uwierzytelniania i kontroli dostępu.

## Wybierz cel warsztatu

Projekt startuje z pustą, ogólną tablicą **Event Storming**, w etapie zbierania
zdarzeń. Podaj domenę w rozmowie z moderatorem albo w formularzu na tablicy.
Moderator najpierw ustala zakres, potem pomaga zbierać zdarzenia, porządkować
opowieść i badać pytania. Przykładowy warsztat fiszek jest wyłącznie fixturem
testowym, nie domyślną treścią aplikacji. Ponowne uruchomienie zachowuje rozpoczęty
warsztat; świadomie nową sesję tworzysz przyciskiem `New workshop`.

| Cel | Przebieg i rezultat |
| --- | --- |
| Big Picture | Swobodne zbieranie zdarzeń, opowieść w czasie, hotspoty, decyzje i dalsze działania |
| Process Modelling | Wybrany proces, źródła zdarzeń, decyzje, polityki, ścieżki alternatywne i błędy |
| Software Design | Pogłębienie procesu o niezmienniki i uzasadnione granice spójności oraz modeli |

Wybór `Workshop` zmienia układ i paletę. **Big Picture** to swobodna tablica
zdarzeń i pytań. **Process Modelling** automatycznie układa karty w rosnące pasy
ról oraz udostępnia komendy, aktorów, modele odczytu, polityki i systemy zewnętrzne.
**Software Design** dodaje agregaty i perspektywę granic spójności. Nie trzeba
wybierać etapów ani włączać notacji czy pasów. Etapy prowadzi moderator w rozmowie.
Istniejące karty pozostają widoczne po zmianie celu warsztatu.

Zdarzenia opisują to, co się wydarzyło, w czasie przeszłym. Komendy wyrażają zamiar;
aktor to rola biznesowa. Źródłem zdarzenia może być również polityka, system
zewnętrzny albo upływ czasu. Jedna komenda może zostać odrzucona lub wywołać wiele
zdarzeń. Nie dopisuj fikcyjnego człowieka do każdej automatycznej czynności.

W Process Modelling i Software Design aplikacja układa karteczki bez ramek według ich roli. Gdy karty
nachodzą na siebie w osi poziomej, pas rośnie w pionie, a kolejne pasy przesuwają
się niżej. Komenda nie trafia przez to do pasa modeli odczytu. Układ zachowuje oś
X i nie zmienia współrzędnych w pliku; wybór Big Picture przywraca swobodny układ.
Ramki scenariuszy wraz z członkami zachowują swój wewnętrzny układ pod pasami.

Pasy są opcjonalną pomocą. Oś pozioma porządkuje opowieść; alternatywy, równoległość
i powtarzające się działania mogą wymagać osobnych ramek. Ramka typu
`Conversational / repeated activity` pozwala zapisać warunek zakończenia pętli.
Kandydat na agregat wymaga uzasadnienia regułami spójności. Bounded context dotyczy
granicy języka i modelu, a nie samej grupy encji.

## Obsługa tablicy

- Dodaj karteczkę z paska; tekst i szczegóły zmienisz w otwartym edytorze.
- Zaznacz karteczkę kliknięciem lub klawiszem Tab. Enter / spacja otwierają edytor.
- Przeciągaj myszą, dotykiem lub rysikiem. Strzałki przesuwają o 10 px, Shift +
  strzałka o 40 px. Escape anuluje edycję tekstu lub przeciąganie.
- Shift + kliknięcie zaznacza kilka elementów. Przesuwanie działa na całej grupie.
- Ramki mają jawnych członków: wybierz `Frame membership` w edytorze karteczki.
  Przesunięcie ramki przenosi jej członków. Usunięcie ramki zachowuje karteczki.
- Użyj `Fit board` i powiększenia. Układ dobierany jest do celu warsztatu.
- `Workshop options` zawiera notatki, eksport, odzyskiwanie i nowy warsztat.
- `Undo` / `Redo` cofają lokalne zmiany z uwzględnieniem zmian innych osób.
- Zapisuj źródło i status wiedzy. `Suggested` oznacza propozycję;
  `Confirmed by participants` wymaga potwierdzenia. Kolor nadal określa rolę.
- Hotspoty mogą mieć priorytet, właściciela i następny krok. `Workshop notes`
  przechowuje zakres, decyzje, założenia oraz dalsze działania.

Nowa karta jest niepotwierdzona. AI ma proponować i pytać; wiedzę domenową
potwierdzają uczestnicy. Nie traktuj przykładowych zdarzeń jako gotowej specyfikacji.

## Współpraca z agentem

Agent korzysta z `AGENTS.md` (`CLAUDE.md` jest symlinkiem). Istniejący warsztat jest
wznawiany; nowa rozmowa nie usuwa tablicy.

```bash
node scripts/board.js get /tmp/workshop-draft.json
# Edytuj obiekt board w pliku roboczym; zachowaj revision.
node scripts/board.js put /tmp/workshop-draft.json
```

Plik roboczy zawiera `{board, revision, sequence, instance, warning}`. `get` nie
nadpisuje istniejącego pliku. `put` wysyła `board` oraz pierwotną wersję jako
`expectedRevision`. Opcjonalne `archive: true` archiwizuje poprzednią tablicę.
Zachowuj `board.workshopId` podczas edycji; nowy warsztat otrzymuje nowy UUID.
Zmiana identyfikatora zatrzymuje automatyczne łączenie szkiców z poprzedniej sesji.

Przy konflikcie HTTP 409 agent zachowuje swój szkic, pobiera najnowszy stan do
innego pliku i porównuje zmiany. Nie wolno podmienić wersji w starym szkicu, aby
wymusić zapis. Propozycje AI powinny mieć `source: "AI"`, `status: "suggested"`.

W przeglądarce niezależne zmiany łączą się automatycznie. Konkurencyjne zmiany tego
samego pola lub usunięcie edytowanej karteczki zatrzymują zapis i wymagają decyzji.
Niezapisany szkic pozostaje w pamięci oraz, jeśli przeglądarka pozwala, w
`sessionStorage` tej karty. Po przeładowaniu można go odzyskać. Błąd HTTP nie jest
pokazywany jako udany zapis; `Retry save` ponawia próbę.

## Trwałość i odzyskiwanie

`board.json` przechowuje tablicę. Serwer zapisuje plik tymczasowy, synchronizuje go
i zastępuje plik docelowy. Zachowuje ostatni poprawny stan i 50 poprzednich
migawek w `.board-history/`; archiwa warsztatów nie podlegają tej rotacji.
Nie jest to kopia zapasowa na innym urządzeniu — ważne warsztaty eksportuj.

`New workshop` archiwizuje bieżącą tablicę przed rozpoczęciem nowej.
`Recovery history` pozwala wyeksportować migawkę do sprawdzenia i jawnie ją
przywrócić. Przywrócenie archiwizuje zastępowany poprawny stan. W trakcie edycji
najpierw zapisz lub rozwiąż konflikty, aby użyć operacji zmieniających cały warsztat.

Niepoprawny plik nie zastępuje ostatniej poprawnej tablicy. Interfejs pokazuje
błąd, a zwykły zapis jest blokowany do naprawy pliku lub jawnego odzyskania
migawki. Jeśli od pierwszego uruchomienia nie ma żadnej poprawnej tablicy ani
migawki, zatrzymaj serwer i napraw lub utwórz `board.json` zgodny z modelem.

**Edycja bezpośrednio na dysku jest przeznaczona do pracy z zatrzymanym serwerem.**
Wykrywanie zmian pliku pozostaje dla kompatybilności, ale obcy proces zapisujący
plik omija protokół współbieżności. Podczas warsztatu korzystaj z API/CLI.
Jeden plik tablicy obsługuje jeden serwer na jednym wybranym porcie. Aplikacja
nie używa blokad plikowych: port jest zwalniany przez system po zakończeniu lub
awarii procesu. Ponowne `npm start` na tym samym porcie wypisuje adres już
uruchomionej tablicy i kończy się pomyślnie. Jeśli port zajmuje inna aplikacja albo
inna tablica, otrzymasz krótki komunikat. Stare pliki `server.lock` są ignorowane;
nie trzeba ich usuwać. Nie uruchamiaj tej samej tablicy jednocześnie na różnych
portach — taki układ nie zapewnia koordynacji zapisów.

## Architektura i API

```text
przeglądarka / agent CLI → HTTP + expectedRevision → walidacja → board.json
przeglądarki            ← SSE + aktualna wersja   ← jeden serwer zapisujący
                                                        ↓
                                                .board-history/
```

- `GET /api/board`: aktualny envelope.
- `POST /api/board`: `{board, expectedRevision, archive?}`; HTTP 409 dla starej wersji.
- `GET /api/stream`: SSE `board` z pełnym envelope, również po ponownym połączeniu.
- `GET /api/history`: lista migawek; `?name=...` zwraca wskazaną tablicę.
- `POST /api/restore`: `{name, expectedRevision}`.

Wspólna walidacja znajduje się w `public/model.js`. Limity: 2000 elementów,
4000 znaków tekstu karteczki, 20000 znaków notatek, 2 MiB żądania/pliku.
Nieznane role, powtórzone ID i nieprawidłowe współrzędne są odrzucane. Fazy
stanowią wskazówki metodyczne, nie uprawnienia użytkowników.

## Rozwój i testy

```bash
npm run verify             # składnia + testy modelu, synchronizacji, HTTP i plików
npm ci                     # zależności wyłącznie do testów przeglądarkowych
npx playwright install chromium
npm run test:browser       # izolowane tablice, bez zmian w board.json
```

CI uruchamia testy na Node 24 w Linux, macOS i Windows; testy przeglądarkowe na
Chromium w Linux. Testy obejmują konflikty, zmiany w trakcie zapisu, błędy HTTP,
SSE, podmianę pliku, walidację, odzyskiwanie oraz interakcje klawiaturą i dotykiem.

## Źródła metody

EventStorming stworzył Alberto Brandolini. To narzędzie jest niezależną pomocą
dydaktyczną, nie oficjalną implementacją ani definicją jednego obowiązkowego układu.

- [EventStorming](https://www.eventstorming.com/)
- [Incremental notation](https://www.eventstorming.com/patterns/incremental-notation/)
- [Chaotic exploration](https://www.eventstorming.com/patterns/chaotic-exploration/)
- [Conversational systems](https://www.eventstorming.com/patterns/conversational-system/)
- [Leave stuff around](https://www.eventstorming.com/patterns/leave-stuff-around/)
- [Introducing EventStorming](https://leanpub.com/introducing_eventstorming)

Licencja: [MIT](LICENSE).
