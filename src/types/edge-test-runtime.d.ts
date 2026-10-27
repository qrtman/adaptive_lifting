// Compile-only bridge for Edge modules imported by Node/Vitest tests. The Edge
// runtime resolves its complete Deno and Postgres types through supabase/deno.json.
declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined;
  }
}

// Only the Pool surface consumed by _shared/db/mod.ts is represented here.
declare module '@db/postgres' {
  export class Pool {
    constructor(
      config: {
        hostname: string;
        port: number;
        database: string;
        user: string;
        password: string;
        connection: { attempts: number };
        tls: { enabled: boolean; enforce: boolean };
      },
      size: number,
      lazy: boolean,
    );
    connect(): Promise<{
      readonly connected: boolean;
      readonly session: { pid: number | undefined };
      end(): Promise<void>;
      queryObject<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
      release(): void;
    }>;
  }
}
