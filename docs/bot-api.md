# Bot → «Бот» page: how to send a raid-boss kill

The site has no backend server. The bot writes straight into the site's Firestore database via Google's REST API, signed in as its own account. The «Бот» page (`/bot`) shows every suggestion. People there move them into the kill times one at a time or in bulk.

- **Firebase project:** `lu4-serv`
- **API key:** the `apiKey` of the `lu4-serv` config in `src/app/environments/environment.ts` (the web key — it's public anyway, it ships in the site bundle)
- **Collections:**
  - `rb-bot-suggestions` — the suggestions;
  - `rb-bot-photos` — screenshots, same document id as the suggestion;
  - `rb-bot-status` — the bot's live status (step 4).

---

## 0. One-time setup: a bot account

1. Firebase console → project **lu4-serv** → **Authentication → Users → Add user**. Give it any e-mail, e.g. `bot@lu4.bot`, and a password.
2. If Firestore rules allow only listed users, add this e-mail on the site under **Users** (`/admin/users`) as an ordinary user. If the rules only check that someone is signed in, nothing else is needed.
3. If the rules list collections explicitly, allow read/write on `rb-bot-suggestions`, `rb-bot-photos` and `rb-bot-status` for signed-in users.

---

## 1. Get a token (lasts 1 hour)

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>
Content-Type: application/json

{ "email": "bot@lu4.bot", "password": "<password>", "returnSecureToken": true }
```

The response has `idToken` (the token itself), `refreshToken` and `expiresIn` (3600 seconds).

Before the hour is up, refresh the token instead of signing in again:

```
POST https://securetoken.googleapis.com/v1/token?key=<API_KEY>
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&refresh_token=<refreshToken>
```

The response has `id_token`, a new token for another hour.

---

## 2. Send a suggestion «РБ убит»

Generate an id yourself (any unique string, e.g. a UUID). The screenshot is stored under the same id.

```
POST https://firestore.googleapis.com/v1/projects/lu4-serv/databases/(default)/documents/rb-bot-suggestions?documentId=<ID>
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "fields": {
    "bossName": { "stringValue": "Zombie Lord Ferkel" },
    "killedAt": { "timestampValue": "2026-10-10T14:23:05Z" },
    "sentAt":   { "timestampValue": "2026-10-10T14:23:40Z" },
    "hasPhoto": { "booleanValue": true },
    "note":     { "stringValue": "видел в чате клана" },
    "source":   { "stringValue": "discord-bot" }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `bossName` | **yes** | RB name, as in the game / on the site (English, as on the bookmarks). Case, spaces and punctuation don't matter. |
| `killedAt` | **yes** | Time of the kill. `timestampValue` in ISO 8601: UTC with `Z` (`2026-10-10T14:23:05Z`) or with an offset (`2026-10-10T17:23:05+03:00`). It must be the real moment: the site shows it in Kyiv time. |
| `bossId` | no | RB id from the site's `db.json` (e.g. `"25375"`). If given, it is matched by id, not by name. |
| `sentAt` | no | When the bot sent it (shown on the page). |
| `hasPhoto` | no | `true` if you send a screenshot (step 3). Otherwise the page shows no picture button. |
| `note` | no | Any text — shown next to the suggestion. |
| `source` | no | Where it came from (bot name / channel). |

Notes:
- Do **not** send `status`: a new suggestion has no status, and the page treats it as «новое».
- Several suggestions for the same RB are fine. The page groups them and shows the count; the latest time is the one moved into the kill time.
- If the name isn't recognised, the suggestion is still shown, highlighted in yellow, and the boss can be picked by hand.
- `(default)` in the URL is written literally, parentheses included.

Success is `200 OK` with the created document. `401/403` means a bad or expired token, or Firestore rules (see step 0).

---

## 3. Screenshot (optional)

A separate document in `rb-bot-photos` with **the same `<ID>`**:

```
POST https://firestore.googleapis.com/v1/projects/lu4-serv/databases/(default)/documents/rb-bot-photos?documentId=<ID>
Authorization: Bearer <idToken>
Content-Type: application/json

{ "fields": { "photo": { "stringValue": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..." } } }
```

- The picture is stored as a string: a `data:image/jpeg;base64,...` (or `png`) data URL. A bare base64 string is also accepted and treated as JPEG.
- **Size limit:** a Firestore document is at most 1 MiB, and base64 adds about a third. Keep the file **≤ 700 KB**: shrink it to about 1280 px wide, JPEG quality 70.
- The order of steps 2 and 3 doesn't matter. Just set `hasPhoto: true` in the suggestion.

---

## 4. Bot status: «работает / где сейчас / что дальше»

The bot keeps **one document of its own** in `rb-bot-status` up to date and simply overwrites it every N seconds. The «Бот» page is subscribed to this collection and updates as soon as the document changes; no polling is needed.

- **Document id = bot id.** Use any stable name, e.g. the character name or `bot-1`. Several bots → several documents → several cards.
- **Interval:** every **15–30 seconds**, plus immediately whenever the RB or state changes.
- **«Работает» / «Нет связи»** is decided by `updatedAt`. If there has been no update for more than 3 intervals (and at least 90 s), the card goes grey: «Нет связи». So **`updatedAt` must be sent every time**.

### Request (create or overwrite, the same request every time)

```
PATCH https://firestore.googleapis.com/v1/projects/lu4-serv/databases/(default)/documents/rb-bot-status/<BOT_ID>
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "fields": {
    "account":       { "stringValue": "MyCharName" },
    "state":         { "stringValue": "waiting" },
    "currentBoss":   { "stringValue": "Zombie Lord Ferkel" },
    "location":      { "stringValue": "Elven Ruins" },
    "message":       { "stringValue": "жду респ, в окне 1-го респа" },
    "updatedAt":     { "timestampValue": "2026-10-10T14:23:05Z" },
    "intervalSec":   { "integerValue": "20" },
    "version":       { "stringValue": "1.0.3" },
    "queue": { "arrayValue": { "values": [
      { "mapValue": { "fields": {
          "bossName": { "stringValue": "Madness Beast" },
          "at":       { "timestampValue": "2026-10-10T15:10:00Z" },
          "note":     { "stringValue": "1-й респ" } } } },
      { "mapValue": { "fields": {
          "bossName": { "stringValue": "Discarded Guardian" } } } }
    ] } }
  }
}
```

A `PATCH` without `updateMask` creates the document if it doesn't exist and **replaces it whole** if it does. Send the full status every time. A field you leave out disappears; for example, an omitted `queue` means «очередь пустая».

| Field | Required | Description |
|---|---|---|
| `updatedAt` | **yes** | Time of this update (UTC, `Z`). Without it the bot counts as offline. |
| `account` | desirable | The character / account the bot plays. Shown on the card. |
| `state` | desirable | What it's doing. Recognised values (shown in Russian): `idle` (ждёт), `moving` (идёт к РБ), `waiting` (ждёт респ), `fighting` (бьёт РБ), `looting` (собирает дроп), `dead` (умер), `error` (ошибка — red card), `stopped` (остановлен — grey card). Any other word is shown as is. |
| `currentBoss` | no | RB it's at right now, by name (as in the bookmarks). |
| `currentBossId` | no | Same, but as the `db.json` id; more precise than the name. |
| `location` | no | Where it is (text). |
| `message` | no | Any status line. |
| `queue` | no | What comes next: an array of objects `{ bossName, bossId?, at?, note? }`. `at` is when it expects to be there / the resp starts; the page shows «через 25 мин». It may also be an array of plain strings (`stringValue`) — just names. |
| `intervalSec` | no | How often the bot reports (seconds). «Нет связи» is counted from it (default 30). |
| `version` | no | Bot version (shown small). |

### When stopping

So the card doesn't hang on «Нет связи», send the same `PATCH` one last time with `"state": {"stringValue": "stopped"}` and a fresh `updatedAt`. The card becomes «Остановлен».

### Python

```python
def send_status(token, bot_id, account, state, current=None, queue=(), message="", interval=20):
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    fields = {
        "account":     {"stringValue": account},
        "state":       {"stringValue": state},
        "message":     {"stringValue": message},
        "updatedAt":   {"timestampValue": now},
        "intervalSec": {"integerValue": str(interval)},
        "queue": {"arrayValue": {"values": [
            {"mapValue": {"fields": {
                "bossName": {"stringValue": q["boss"]},
                **({"at": {"timestampValue": q["at"]}} if q.get("at") else {}),
                **({"note": {"stringValue": q["note"]}} if q.get("note") else {}),
            }}} for q in queue
        ]}},
    }
    if current:
        fields["currentBoss"] = {"stringValue": current}
    r = requests.patch(f"{BASE}/rb-bot-status/{bot_id}",
                       headers={"Authorization": f"Bearer {token}"},
                       json={"fields": fields}, timeout=15)
    r.raise_for_status()

# every 20 s:
send_status(token, "bot-1", "MyCharName", "waiting", current="Zombie Lord Ferkel",
            queue=[{"boss": "Madness Beast", "at": "2026-10-10T15:10:00Z", "note": "1-й респ"}],
            message="жду респ")
```

Access is the same as for suggestions: the bot account must be able to write `rb-bot-status` (Firestore rules, step 0).

---

## Example (Python, `requests`)

```python
import base64, io, uuid, datetime as dt, requests

API_KEY = "<apiKey lu4-serv>"
EMAIL, PASSWORD = "bot@lu4.bot", "<password>"
BASE = "https://firestore.googleapis.com/v1/projects/lu4-serv/databases/(default)/documents"

def login():
    r = requests.post(
        f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}",
        json={"email": EMAIL, "password": PASSWORD, "returnSecureToken": True}, timeout=15)
    r.raise_for_status()
    return r.json()["idToken"]          # cache it and refresh before the hour is up

def send_kill(token, boss_name, killed_at: dt.datetime, photo_bytes: bytes | None = None, note=""):
    doc_id = uuid.uuid4().hex
    headers = {"Authorization": f"Bearer {token}"}
    iso = lambda t: t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if photo_bytes:                      # shrink first (e.g. Pillow: 1280px, quality=70)
        data_url = "data:image/jpeg;base64," + base64.b64encode(photo_bytes).decode()
        requests.post(f"{BASE}/rb-bot-photos?documentId={doc_id}", headers=headers,
                      json={"fields": {"photo": {"stringValue": data_url}}}, timeout=30).raise_for_status()

    fields = {
        "bossName": {"stringValue": boss_name},
        "killedAt": {"timestampValue": iso(killed_at)},
        "sentAt":   {"timestampValue": iso(dt.datetime.now(dt.timezone.utc))},
        "hasPhoto": {"booleanValue": bool(photo_bytes)},
        "note":     {"stringValue": note},
        "source":   {"stringValue": "bot"},
    }
    requests.post(f"{BASE}/rb-bot-suggestions?documentId={doc_id}", headers=headers,
                  json={"fields": fields}, timeout=15).raise_for_status()
    return doc_id

token = login()
send_kill(token, "Zombie Lord Ferkel", dt.datetime.now(dt.timezone.utc), note="тест")
```

## Example (curl)

```bash
TOKEN=$(curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"bot@lu4.bot","password":"<password>","returnSecureToken":true}' | jq -r .idToken)

curl -s -X POST \
  "https://firestore.googleapis.com/v1/projects/lu4-serv/databases/(default)/documents/rb-bot-suggestions?documentId=test-$(date +%s)" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fields":{"bossName":{"stringValue":"Zombie Lord Ferkel"},"killedAt":{"timestampValue":"2026-10-10T14:23:05Z"}}}'
```

---

## What happens on the site

- The **Bot** menu item gets a red badge with the number of new suggestions.
- The «Бот» page groups suggestions by RB and shows:
  - the bot's time next to ours, and «новее / старше нашего на …»;
  - the screenshot;
  - the note.
- **«В респ»** moves one RB. **«Перенести выбранные»** moves several at once; by default it skips those where our time is fresher.
- A moved time works like a normal kill time: it goes to the bookmarks, and also to NG if «Дубль в NG» is on.
- Handled suggestions go to «Обработанные». They can be returned to the new ones or deleted along with their screenshots.
