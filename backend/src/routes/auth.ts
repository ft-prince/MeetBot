import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAuthUrl, exchangeCode, getUserById } from '../services/googleAuth';

const router = Router();

// ── OAuth state registry ──────────────────────────────────────────────────────
// Storing state in the session fails when the browser initiates OAuth on
// localhost but Google redirects to 127.0.0.1 (different host → session cookie
// is not sent → req.session.oauthState is undefined → "invalid_state").
// Using a server-side Map decouples state validation from cookie/session delivery.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingStates = new Map<string, number>(); // state → expiry timestamp

// Prune expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, expiry] of pendingStates) {
    if (now > expiry) pendingStates.delete(state);
  }
}, 5 * 60 * 1000).unref();

// GET /auth/google — redirect to Google consent screen
router.get('/google', (_req: Request, res: Response) => {
  const state = uuidv4();
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  res.redirect(getAuthUrl(state));
});

// Shared OAuth callback handler — used at both /auth/google/callback
// and /accounts/google/login/callback/ (the path Google actually redirects to
// per GOOGLE_REDIRECT_URI in .env).
export async function handleGoogleCallback(req: Request, res: Response) {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    console.error('[auth] OAuth error:', error);
    res.redirect('/signin?auth_error=' + encodeURIComponent(error));
    return;
  }

  // Validate state against the server-side registry (not the session cookie)
  const expiry = pendingStates.get(state);
  if (!expiry || Date.now() > expiry) {
    console.warn('[auth] Invalid or expired OAuth state:', state?.slice(0, 8));
    res.redirect('/signin?auth_error=invalid_state');
    return;
  }
  pendingStates.delete(state); // single-use

  try {
    const user = await exchangeCode(code);
    req.session.userId = user.id;
    // Force-persist the session BEFORE redirecting so /auth/me sees the userId
    // immediately when the browser lands on /.
    req.session.save((err) => {
      if (err) console.error('[auth] Session save error:', err);
      console.log(`[auth] User signed in: ${user.email}`);
      res.redirect('/');
    });
  } catch (err) {
    console.error('[auth] Exchange error:', err);
    res.redirect('/signin?auth_error=exchange_failed');
  }
}

// GET /auth/google/callback — handle OAuth callback
router.get('/google/callback', handleGoogleCallback);

// GET /auth/me — return current user info
router.get('/me', async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ user: null });
    return;
  }
  try {
    const user = await getUserById(req.session.userId);
    if (!user) { req.session.destroy(() => {}); res.status(401).json({ user: null }); return; }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        autoJoinMinutes: user.autoJoinMinutes,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// POST /auth/logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// PATCH /auth/settings — update auto_join_minutes
router.patch('/settings', async (req: Request, res: Response) => {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  const { autoJoinMinutes } = req.body as { autoJoinMinutes?: number };
  if (typeof autoJoinMinutes !== 'number' || autoJoinMinutes < 0 || autoJoinMinutes > 30) {
    res.status(400).json({ error: 'autoJoinMinutes must be 0-30' });
    return;
  }
  const { db } = await import('../db/client');
  await db.query('UPDATE users SET auto_join_minutes = $1 WHERE id = $2', [autoJoinMinutes, req.session.userId]);

  // When user enables global auto-join, flip every one of their FUTURE calendar
  // events to auto_join = true so the toggle shows ON by default for all of them.
  // Past/in-progress events and the user's existing opt-outs on past meetings
  // aren't touched. The user can still disable any individual upcoming meeting
  // via the calendar UI after this.
  if (autoJoinMinutes > 0) {
    await db.query(
      `UPDATE calendar_events
       SET auto_join = true
       WHERE user_id = $1
         AND start_time > now()
         AND auto_join = false`,
      [req.session.userId],
    );
  }

  res.json({ ok: true });
});

export default router;
