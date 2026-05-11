import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getAuthUrl, exchangeCode, getUserById } from '../services/googleAuth';

const router = Router();

// GET /auth/google — redirect to Google consent screen
router.get('/google', (req: Request, res: Response) => {
  const state = uuidv4();
  req.session.oauthState = state;
  res.redirect(getAuthUrl(state));
});

// GET /auth/google/callback — handle OAuth callback
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    console.error('[auth] OAuth error:', error);
    res.redirect('/?auth_error=' + encodeURIComponent(error));
    return;
  }

  if (state !== req.session.oauthState) {
    res.redirect('/?auth_error=invalid_state');
    return;
  }

  try {
    const user = await exchangeCode(code);
    req.session.userId = user.id;
    delete req.session.oauthState;
    console.log(`[auth] User signed in: ${user.email}`);
    res.redirect('/');
  } catch (err) {
    console.error('[auth] Exchange error:', err);
    res.redirect('/?auth_error=exchange_failed');
  }
});

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
  res.json({ ok: true });
});

export default router;
