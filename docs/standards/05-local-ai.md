# 5. Local AI (the member's chief of staff)

The assistant inside the app for each signed-in member. MoneyMart calls her **Ore**.
Reference: `services/api/src/ai/ore.ts`, `voice.ts`, routes `/api/ore/*`; iOS `Features/Ore/`.

## 5.1 What she is (since v1.2)

One local AI for **buyers and sellers alike** — the member's chief of staff. She works only for that member.

- **Embedded knowledge:** the whole platform guide is in her prompt every turn — what the app is, how bidding, timers, anti-snipe, live shows, Buy It Now, fees (both sides), protected payments, disputes, selling, shipping, account and safety work. Apps MUST build the guide from their own constants (fees, increments, categories) so it never drifts from the code.
- **Account snapshot:** every turn she sees a short summary of the member's own account as buyer and as seller (orders in progress, bids and how many they lead, listings, shows, sales, unread notifications, Pro, verification).
- **Read-only tools for details, scoped to the member:** `my_orders`, `my_bids`, `my_listings`, `my_shows`, `my_payouts`, `my_notifications`, plus the public `search_marketplace` and `shows`. Results carry in-app links (`<app>://lot/<id>`, `<app>://stream/<id>`); tapping one closes the chat and opens that screen.
- **Attachments:** up to 4 per message — photos (JPEG/PNG/GIF/WebP, ≤ 5 MB), PDFs (≤ 10 MB), text/CSV/JSON/Markdown (≤ 200 KB, inlined and marked as data). Anything else is refused with a reason. Photos go to the model as images, PDFs as documents.
- She explains where to tap; she does not bid, buy, list or message for the member (action tools with a confirm tap may come later).
- Never invents prices, policies or features. Never asks for passwords, card numbers or codes. Never shows one member another member's private data.

## 5.2 Reporting up

One tool, always present:

```
report_to_president(kind: feature | problem | feedback, title, detail?)
```

- Filed as a `request` post for the President.
- **Anonymous:** the member is stored as a keyed hash (HMAC of the member id, first 12 hex chars), never the id.
- **Merged:** a request with the same title (case-insensitive) is counted again, once per member (`meta.refs`, `meta.votes`).
- At most 3 reports per turn.
- She tells the member it has gone to the President.

## 5.3 Directives down

Her system prompt ends with the Owner-approved, signed directives from the President:

```
DIRECTIVES FROM PRESIDENT <NAME> (approved by the Owner; follow them):
- …
```

Only entries whose signature verifies are included.

## 5.4 Controls

- Voice for calls: `POST /api/<local_ai>/speak` returns MP3 from Cartesia (voice id is the setting `ore.voice_id`), falling back to ElevenLabs; 204 when neither answers and the app uses the phone's own voice. Text is cleaned of markdown and links first. 300 per member per hour.
- On/off: setting `features.<local_ai>`. Off → the chat returns 503 `ore_off` and the app hides her.
- Her model: seat `ore` (Owner can change it in the console).
- Her key: the general key (`ANTHROPIC_API_KEY`), never the President's.
- Up to 3 model steps per turn; history from the client capped at the last 10 messages, 2,000 characters each.

## 5.5 Privacy

- She sees only the signed-in member's own conversation.
- Per-account preference profiles (what she learns about a member) need the member's consent — off by default, disclosed in the privacy policy and App Store privacy labels — and the member can see and delete them. (v1 keeps no profile.)
- Requests carry no member id.

## 5.6 In the apps

- **Layout (chat-app pattern, in the app's own look):** full screen. Top: a menu button (drawer) on the left; the chat title, a new-chat button and close on the right. A new chat shows the mark, a time-of-day greeting with the member's first name ("Evening, Will"), one line about who she is, and a few suggestion chips. Messages: the member's in a bubble on the right; hers as open text with her mark, markdown rendered, and a "Sent to President …" line when she reported something.
- **Composer:** a rounded card at the bottom with the text field, a **+** menu (Photos, Camera, Files & PDFs), picked files as removable chips, a **mic** for dictation (on-device speech to text into the field), and one round button that is **Send** when there is something to send and **Call** when empty.
- **Call:** full screen with an animated orb. Loop: listen (on-device recognition, ends after ~1.3 s of silence) → think (the same chat endpoint with `voice: true` for 1–3 spoken sentences) → speak (server voice, else the phone's voice) → listen. Mute, end, and tap-the-orb to interrupt. The call's words are added to the chat.
- **Drawer:** New chat and Recents (this account's chats, newest first, swipe to delete).
- **Privacy:** chats are stored only on the device, in a file per account (protected file storage), last 60 chats; files are not stored, only small photo previews. The server keeps no member chat history.
- The app checks `GET /api/<local_ai>/status` first and hides her when `enabled` or `available` is false.
- Entry points (MoneyMart): a gold button in the Home header and "Ask Ore" in Profile. A floating button is avoided because it would cover live-show controls.
