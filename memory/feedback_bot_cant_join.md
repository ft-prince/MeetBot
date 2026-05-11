---
name: Bot join false-positive fix
description: checkCantJoin in meetBot.ts needs a grace period; botManager onError must clean up the session
type: feedback
---

Don't call `checkCantJoin` immediately when `waitForMeetingUI` starts. The "Ask to join" waiting screen can transiently look like the hard-block error screen, causing a false-positive early exit. Fixed with a 10-iteration grace period (`CANT_JOIN_GRACE = 10`) before polling begins.

**Why:** Without the grace period, the bot exits immediately after clicking "Ask to join" on any meeting that uses a waiting room, even if the host would have admitted it.

**How to apply:** Whenever modifying `waitForMeetingUI` or adding new error-detection checks in `meetBot.ts`, preserve the grace period before those checks fire.

Also: `botManager.onError` must call `endBotSession` and broadcast a `bot.error` websocket event. Without this, a session created by `createBotSession` leaks and the frontend gets no feedback.
