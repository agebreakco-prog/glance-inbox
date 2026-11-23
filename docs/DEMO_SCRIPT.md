# Demo video script (3 minutes or less)

**Goal:** show read-and-write on G2 end to end, in the official simulator, with a real Telegram test bot and Claude drafts.

## Before you record (10 min)

1. Create a **test bot** with @BotFather. Put its token in `.env` as `TELEGRAM_BOT_TOKEN`. Also put `ANTHROPIC_API_KEY` in `.env`.
2. From a second Telegram account, or Telegram Web in another browser profile, use **test** names only. No real contacts on screen. Create:
   - a group "Falcon team" with the bot in it (set privacy mode off in BotFather → Bot Settings → Group Privacy);
   - a direct chat with the bot.
3. Run `npm run server` once. Send one message in each chat and copy the chat IDs from the log into `TELEGRAM_ALLOWED_CHAT_IDS`. Restart `npm run server`.
4. Queue these messages (send them just before recording):
   - Group: "Can you send the client deck before 3pm? They moved the call up."
   - DM: "Hi! Do you still have the rye loaf today?"
5. Start `npm run dev` and `npm run sim`. Turn on glow in the simulator if you like (`-g`).
6. Screen layout: simulator on the left, Telegram (test account) on the right. Record at 1080p with OBS, or with the built-in screen recorder (Win+Alt+R on Windows; Cmd+Shift+5 on macOS).

**No keys or tokens available?** Run without `.env`. Demo mode shows the same flow with fictional messages, and the companion page has a "Simulate incoming message" button. In that case, say "demo mode" once in the voice-over.

## Shot list

| Time | On screen | What to do | What to say |
|---|---|---|---|
| 0:00-0:15 | Title card or the simulator | - | "This is Glance Inbox. Telegram on Even Realities G2. You read one message and reply with one tap, without taking out your phone." |
| 0:15-0:35 | Simulator: inbox card | Point at the header and the body | "The glasses only show chats I picked: my work group and my shop's order bot. One message at a time: who, which chat, how long ago, and how many are waiting." |
| 0:35-1:05 | Reply drafts | **Click** (tap). Wait for the drafts | "One tap and Claude drafts three replies from the chat context: one yes, one in-between, one decline. It fits the 576 by 288 display, and I scroll with the temple or the R1 ring." |
| 1:05-1:25 | Countdown, then Telegram | **Click** the first draft. Let the 3 s run out, then point at Telegram on the right | "I tap a draft, and I get three seconds to cancel with a double-tap. It's sent, and it shows up in Telegram as a threaded reply." |
| 1:25-1:55 | Next card (shop DM), voice | **Down** (swipe) if needed, then **press and hold**. Speak: "Yes, we have two left, I can hold one for you until six." Release | "For anything longer I hold and speak. The G2 mic audio goes to my server for speech-to-text, Claude cleans it up, and nothing goes out until I tap." |
| 1:55-2:05 | Confirm, then Telegram | **Click** | "Tap. Sent." |
| 2:05-2:25 | New message banner | From the test account, send "Standup moved to 10:15, join from the car?" | "New messages are announced in the header without interrupting what I'm reading." |
| 2:25-2:45 | Menu, then Digest | **Context menu**, then **click** Digest | "And the digest summarises everything unread in four lines, most urgent first." |
| 2:45-3:00 | Architecture slide or README | - | "It runs on the Telegram Bot API with a small Node backend. Keys stay on the server, only picked chats are shown, and nothing is sent without a tap. Glance Inbox: reply to anything in two taps." |

## Simulator controls

- Click: tap
- Up / Down: swipe
- Double click: back / cancel
- Long press (hold): voice
- Context menu: menu

Use the on-screen controls in the simulator window, or script them:

```bash
curl -X POST localhost:9898/api/input -d '{"action":"click"}'
```

Other actions: `up`, `down`, `double_click`, `long_press`, `long_press_release`, `context_menu`.

## After recording

Trim to 3:00 or less. Upload to YouTube as **Unlisted**, and put the link in the DoraHacks BUIDL.
