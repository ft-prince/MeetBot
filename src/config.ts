import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  whisperUrl: process.env.WHISPER_URL || 'ws://localhost:3002',
};
