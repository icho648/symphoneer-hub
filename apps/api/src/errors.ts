import type { NextFunction, Request, Response } from "express";
import { RepositoryError } from "@symphoneer-hub/database";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof RepositoryError) {
    const status =
      error.code === "not_found" || error.code === "runtime_not_found"
        ? 404
        : error.code === "invalid_pairing_code"
          ? 401
          : error.code === "idempotency_key_reused" || error.code === "command_conflict"
            ? 409
            : 500;
    response.status(status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  response.status(500).json({ error: { code: "internal_error", message: "unexpected server error" } });
}
