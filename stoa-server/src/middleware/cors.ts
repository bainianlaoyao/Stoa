/**
 * CORS middleware for Stoa Server web client access.
 * Allows browser-based clients to communicate with the API.
 */
import { cors } from 'hono/cors';

export const corsMiddleware = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'x-stoa-session-id', 'x-stoa-session-token'],
  exposeHeaders: ['Content-Range'],
  maxAge: 86400,
});
