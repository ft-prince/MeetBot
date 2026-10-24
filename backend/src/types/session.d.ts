import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Unparsed JSON body, kept for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}
