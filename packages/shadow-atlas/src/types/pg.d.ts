declare module 'pg' {
    export interface PoolConfig {
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        max?: number;
        idleTimeoutMillis?: number;
        connectionTimeoutMillis?: number;
        [key: string]: any;
    }

    export interface PoolClient {
        query(sql: string, params?: any[]): Promise<any>;
        release(): void;
    }

    export class Pool {
        constructor(config?: PoolConfig);
        options: PoolConfig;
        connect(): Promise<PoolClient>;
        query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
        end(): Promise<void>;
        on(event: 'error', listener: (err: Error) => void): this;
    }
}
