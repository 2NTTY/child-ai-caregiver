import type { IncomingHttpHeaders } from "node:http";

/** The HTTP consumer only requires the authenticated user's ID. */
export interface ServerAuthSession {
  user: { id: string };
}

export interface ServerAuthSessionWithHeaders {
  response: ServerAuthSession | null;
  headers: Headers;
}

export interface ServerAuthPort {
  handler(request: Request): Promise<Response>;
  getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  fromNodeHeaders(headers: IncomingHttpHeaders): Headers;
}
