import { google } from 'googleapis';
import { config } from '../config';
import { db } from '../db/client';
import { v4 as uuidv4 } from 'uuid';

export interface UserRow {
  id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: Date;
  autoJoinMinutes: number;
  isAdmin: boolean;
}

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

export function getAuthUrl(state: string): string {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',           // always get refresh_token
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    state,
  });
}

export async function exchangeCode(code: string): Promise<UserRow> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user profile
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: profile } = await oauth2.userinfo.get();

  if (!profile.id || !profile.email) {
    throw new Error('Could not get Google profile info');
  }

  // Upsert user in DB
  const result = await db.query(
    `INSERT INTO users (id, google_id, email, name, picture, access_token, refresh_token, token_expiry, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (google_id) DO UPDATE SET
       email         = EXCLUDED.email,
       name          = EXCLUDED.name,
       picture       = EXCLUDED.picture,
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
       token_expiry  = EXCLUDED.token_expiry,
       updated_at    = now()
     RETURNING *`,
    [
      uuidv4(),
      profile.id,
      profile.email,
      profile.name || profile.email,
      profile.picture || null,
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    ]
  );

  return rowToUser(result.rows[0]);
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!result.rows[0]) return null;
  return rowToUser(result.rows[0]);
}

export async function getAuthedClient(userId: string) {
  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    expiry_date: user.tokenExpiry?.getTime(),
  });

  // Auto-refresh and persist new token if needed
  oauth2Client.on('tokens', async (tokens) => {
    await db.query(
      `UPDATE users SET access_token = $1, token_expiry = $2, updated_at = now() WHERE id = $3`,
      [tokens.access_token, tokens.expiry_date ? new Date(tokens.expiry_date) : null, userId]
    );
  });

  return oauth2Client;
}

function rowToUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    googleId: row.google_id as string,
    email: row.email as string,
    name: row.name as string,
    picture: row.picture as string | undefined,
    accessToken: row.access_token as string | undefined,
    refreshToken: row.refresh_token as string | undefined,
    tokenExpiry: row.token_expiry as Date | undefined,
    autoJoinMinutes: (row.auto_join_minutes as number) ?? 2,
    isAdmin: row.is_admin === true,
  };
}
