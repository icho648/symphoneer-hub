import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  AUTH_MODE: z.enum(["dev", "supabase"]),
  DEV_USER_ID: z.string().min(1).default("00000000-0000-0000-0000-000000000001"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default("authenticated"),
  PAIRING_PEPPER: z.string().min(32),
  DEVICE_TOKEN_PEPPER: z.string().min(32),
});

export type ApiConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`invalid API configuration: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.AUTH_MODE === "supabase" && !parsed.data.SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required when AUTH_MODE=supabase");
  }
  return parsed.data;
}
