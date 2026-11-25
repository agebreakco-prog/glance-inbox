# DoraHacks BUIDL submission text

**Name:** Glance Inbox

**Tagline:** Telegram on G2. Read one message, reply with one tap.

**Tracks:**

- 01 Messaging & News (main).
- Also entered for **Best Telegram integration**.
- It uses Claude (track 04 apps) to draft replies, digests and voice clean-up.

**Links:**

- GitHub: https://github.com/agebreakco-prog/glance-inbox
- Demo video: `<YouTube unlisted URL>`
- `.ehpk` build: attached / in releases

---

## Problem

Most chat messages need a three-word answer, yet answering one on the phone takes about 20 seconds: unlock, find the chat, type, send.
It pulls you out of the meeting, the walk or the counter you are working at.
G2 can show the message privately, but there is no fast way to answer it from the glasses.

## Who it is for

- **Professionals in Telegram work groups** who need to stay reachable during meetings, commutes or driving.
- **Small businesses that run orders or support through a Telegram bot**: bakeries, shops, tutors, community managers. They can answer customers while their hands are busy.

## How it works

1. **Read.**
   - A small Node server long-polls the Telegram Bot API.
   - It passes on only the chats you picked (allowlist).
   - The G2 app shows one unread message per card: sender, chat, age and unread count.
2. **Write in one tap.**
   - Tap, and Claude drafts three short replies from the chat context: one yes, one in-between, one decline.
   - Tap a draft and it is sent as a **threaded Telegram reply** after a visible 3-second countdown, which a double-tap cancels.
3. **Or say it.**
   - Press and hold, then speak.
   - The G2 mic PCM goes to your server for speech-to-text (any OpenAI-compatible endpoint, including local Whisper).
   - Claude tidies the transcript, and you tap to send.
4. **For shops: know the customer.**
   - Next to a customer's message the card shows one line from the shop's order data, for example "Last order #1042 · 2 croissants · paid, pickup 15:00".
   - The data comes from a JSON file, a webhook (`POST /api/shop/order`) or the shop's own API, keyed by Telegram user id.
   - Claude's drafts can reference the order. The no-key rule fallback writes order-aware drafts too.
5. **For teams: no double answers.**
   - When two staff members open the same customer chat, the first to tap reply claims it.
   - The other sees "Being answered by Lena", their reply is blocked, and they can view only.
   - Claims end on send or after 2 minutes. Demo mode simulates the colleague.
6. **Catch up.**
   - The contextual menu opens a 4-line digest of everything unread, most urgent first.
   - New messages are announced in the header without interrupting you.

It works with the temple touchpad and the R1 ring: tap, swipe, hold and menu.

## Tech

- **Even Hub SDK 0.0.16:**
  - text, list and menu containers;
  - `textContainerUpgrade` for flicker-free counters and countdowns;
  - G2 microphone;
  - long-press events.
- **Telegram Bot API:** `getUpdates` and `sendMessage` with `reply_parameters`.
- **Claude** via the official Anthropic SDK:
  - structured JSON output, low effort, 8 s timeout;
  - **a local rule-based fallback**, so the app never hangs and works with no key at all.
- **Tested in the official EvenHub simulator:**
  - 24 automated tests (API end-to-end, Telegram mapping, layout limits, customer context providers, two-staff claim lock with expiry);
  - a scripted walkthrough that captures 13 simulator screenshots and a GIF.

## Safety and privacy

- Only the chats you pick are shown.
- Messages are kept in memory only.
- Nothing is sent without a tap.
- API keys live only on the server, never in the app package.
- The AI is told not to invent facts or commitments.
- The demo uses a test bot and fictional data only.

## Business potential

**Who pays:** small shops selling through a Telegram bot, as a monthly add-on per bot.

- A free personal version.
- A paid "Business inbox" for shops and support teams on Telegram bots. Already built:
  - the customer context line (last order on the card, and in Claude's drafts);
  - several G2 wearers answering one bot, with a claim lock so a customer never gets two answers.
- Next for the business tier:
  - shared templates;
  - business hours;
  - an audit log.
- The same pattern later extends to Discord, Slack and Gmail.

## What the APIs were missing (feature requests)

1. A short glanceable alert while another G2 app is in the foreground.
2. In-place list item updates, so drafts can stream without a page rebuild.
3. Built-in speech-to-text in the Even Hub SDK.
4. A scripted mic input (WAV) in the simulator, so voice flows can be tested headlessly.
5. Telegram: a quick-reply suggestion surface for bots that act for a user.
