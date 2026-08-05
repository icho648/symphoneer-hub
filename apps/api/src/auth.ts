import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { ApiConfig } from "./config.js";
import { ApiError } from "./errors.js";

export type AuthenticatedRequest = Request & { user: { id: string } };

function bearerToken(request: Request): string | null {
  const value = request.header("authorization");
  if (!value?.toLowerCase().startsWith("bearer ")) return null;
  return value.slice(7).trim() || null;
}

export function createAuthMiddleware(config: ApiConfig) {
  const issuer = config.SUPABASE_URL ? `${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1` : null;
  const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

  return async function authenticate(request: Request, _response: Response, next: NextFunction) {
    try {
      if (config.AUTH_MODE === "dev") {
        const requested = request.header("x-dev-user-id");
        (request as AuthenticatedRequest).user = { id: requested || config.DEV_USER_ID };
        next();
        return;
      }

      const token = bearerToken(request);
      if (!token || !jwks || !issuer) throw new ApiError(401, "not_authenticated", "valid bearer token required");
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: config.SUPABASE_JWT_AUDIENCE,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new ApiError(401, "invalid_token", "token subject is missing");
      }
      (request as AuthenticatedRequest).user = { id: payload.sub };
      next();
    } catch (error) {
      next(error instanceof ApiError ? error : new ApiError(401, "invalid_token", "token verification failed"));
    }
  };
}
