// Minimal ambient declarations for transitive deps used by the WS auth layer.
// These ship without bundled types; we only use a couple of functions.

declare module 'cookie' {
  export function parse(str: string, options?: Record<string, unknown>): Record<string, string>;
  export function serialize(name: string, value: string, options?: Record<string, unknown>): string;
}

declare module 'cookie-signature' {
  export function sign(value: string, secret: string): string;
  export function unsign(input: string, secret: string): string | false;
}
