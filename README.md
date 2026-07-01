# Backend e-Dziennika SP im. Starego Dębu

Prawdziwy serwer (Express + SQLite) — działa lokalnie na Twoim komputerze,
**za darmo, bez żadnego konta, bez internetu po instalacji**. Dane trzymane
są w jednym pliku `data/dziennik.db`, który nigdy nie znika, nawet po
zamknięciu komputera.

## Wymagania

- [Node.js](https://nodejs.org) w wersji 18 lub nowszej (sprawdź: `node --version`)

To wszystko. Żadnej karty kredytowej, żadnej rejestracji.

## Uruchomienie (3 kroki)

```bash
cd backend
npm install        # pobiera 5 paczek, ~30 sekund
npm run seed        # wypełnia bazę danymi szkoły (nauczyciele, klasy, uczniowie)
npm start            # uruchamia serwer
```

Po `npm start` zobaczysz:
```
🌳 e-Dziennik backend działa: http://localhost:4000
   Sprawdź: http://localhost:4000/api/health
```

Otwórz `http://localhost:4000/api/health` w przeglądarce — jeśli widzisz
`{"ok":true,...}`, backend działa poprawnie.

## Co zawiera baza po `npm run seed`

- 72 nauczycieli (cała karta szkoły, w tym Rzątkowscy z regułami specjalnymi)
- 32 klasy (1A–8D), po 18 uczniów każda
- Przydziały nauczyciel↔klasa↔przedmiot
- Plan lekcji Stanisława Rzątkowskiego: tylko 5A i 5D, druga zmiana
  (start ~13:50), bez wtorku, bez dwóch lekcji tej samej klasy pod rząd,
  weekendy od ~10:30–11:30, oznaczone jako sporadyczne
- Jedno powitalne ogłoszenie od dyrektora

Możesz uruchomić `npm run seed` ponownie w dowolnym momencie — czyści
i wypełnia bazę od nowa (np. gdy chcesz zacząć od czystego stanu).

## Logowanie

Każdy nauczyciel na start **nie ma hasła** — logowanie to wybór kafelka
(tak jak w obecnym demie). Endpoint `/api/auth/login` z samym `teacherId`
zwraca token JWT ważny 30 dni.

Jeśli chcesz dodać hasła (np. dla realnego użytku w szkole), nauczyciel
po zalogowaniu może wywołać `/api/auth/set-password` — od tego momentu
logowanie będzie wymagać hasła.

## Pełna lista endpointów

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/teachers` | Lista nauczycieli (do ekranu wyboru) |
| POST | `/api/auth/login` | Logowanie (zwraca token) |
| POST | `/api/auth/set-password` | Ustawienie hasła |
| GET | `/api/auth/me` | Dane zalogowanego nauczyciela |
| GET | `/api/me/assignments` | Moje przydziały klasa/przedmiot |
| GET | `/api/me/classes` | Moje klasy |
| GET | `/api/classes/:id/students` | Uczniowie klasy |
| POST | `/api/classes/:id/students` | Dodaj ucznia |
| DELETE | `/api/students/:id` | Usuń (dezaktywuj) ucznia |
| GET | `/api/grades` | Lista ocen (z filtrami `classId`, `subjectId`, `studentId`) |
| POST | `/api/grades` | Wystaw ocenę |
| POST | `/api/grades/bulk` | Wystaw oceny całej klasie naraz |
| DELETE | `/api/grades/:id` | Usuń ocenę |
| GET | `/api/attendance` | Frekwencja (filtry `classId`, `date`) |
| POST | `/api/attendance` | Zaznacz frekwencję |
| GET | `/api/students/:id/notes` | Uwagi ucznia |
| POST | `/api/students/:id/notes` | Dodaj uwagę |
| DELETE | `/api/notes/:id` | Usuń uwagę |
| GET | `/api/tests` | Zapowiedzi sprawdzianów |
| POST | `/api/tests` | Zapowiedz sprawdzian |
| DELETE | `/api/tests/:id` | Usuń zapowiedź |
| GET | `/api/timetable/me` | Mój plan lekcji |
| GET | `/api/timetable/class/:id` | Plan lekcji danej klasy |
| POST | `/api/timetable` | Dodaj wpis do planu |
| GET | `/api/messages/inbox` | Moja skrzynka (prywatne + ogłoszenia) |
| POST | `/api/messages` | Wyślij wiadomość |
| POST | `/api/messages/:id/read` | Oznacz jako przeczytaną |
| DELETE | `/api/messages/:id` | Usuń wiadomość |
| GET | `/api/stats/school` | Statystyki szkoły (tylko dyrekcja) |
| GET | `/api/health` | Healthcheck |

Wszystkie endpointy oprócz `/api/teachers`, `/api/auth/login` i `/api/health`
wymagają nagłówka `Authorization: Bearer <token>`.

## Separacja danych — jak to działa

Każdy request z tokenem niesie `teacher.id`. Endpointy ocen, frekwencji,
planu i wiadomości **filtrują wyniki po `teacher_id`** — nauczyciel A nigdy
nie zobaczy ocen wystawionych przez nauczyciela B w klasie, której nie uczy.
Próba zapisu oceny do przedmiotu, którego dany nauczyciel nie uczy, kończy
się błędem `403 Forbidden`. Dyrekcja (`director`/`vice_director`) widzi
wszystko — to celowy wyjątek.

## Test ręczny przez curl (po uruchomieniu serwera)

```bash
# 1. Lista nauczycieli
curl http://localhost:4000/api/teachers | head -c 500

# 2. Zaloguj się jako pierwszy z listy (podstaw prawdziwe ID z kroku 1)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"teacherId": 1}'

# 3. Użyj zwróconego tokenu
curl http://localhost:4000/api/me/classes \
  -H "Authorization: Bearer WKLEJ_TOKEN_TUTAJ"
```

## Podłączenie frontendu (plik .jsx z artifacts)

Obecny plik `dziennik_stary_dab.jsx` trzyma dane w `localStorage` przeglądarki.
Żeby podłączyć go do tego backendu zamiast localStorage, trzeba zamienić
wywołania `useState`/`localStorage.getItem/setItem` na `fetch()` do
`http://localhost:4000/api/...` z tokenem w nagłówku. To osobny krok
przepisania warstwy danych — strukturę zakładek (Oceny/Frekwencja/Plan/
Wiadomości) zostawiasz bez zmian, zmienia się tylko skąd biorą dane.

## Co dalej, jeśli chcesz to wystawić poza swój komputer

Ten backend działa świetnie lokalnie (np. w szkolnej sieci). Jeśli kiedyś
zechcesz, żeby działał z dowolnego miejsca w internecie (24/7, bez
trzymania włączonego komputera), najprostsza darmowa opcja to przeniesienie
`schema.sql` na Supabase (plan darmowy) — masz już gotowy `schema.sql` w
wersji PostgreSQL z poprzedniej rozmowy, więc to nie jest pisanie od zera.
