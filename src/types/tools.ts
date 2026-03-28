export interface ResponseEnvelope<T> {
  schema_version: string;
  source: { universe_id?: string; place_id?: string; studio_port?: number };
  freshness: { fresh: boolean; timestamp: string; ttl_ms: number };
  warnings: string[];
  data: T;
}
