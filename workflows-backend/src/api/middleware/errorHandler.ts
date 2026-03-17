import { Context } from "hono";
import { ErrorCode } from "../../core/enums";
import { HTTP_STATUS_CODES } from "../../core/constants";
import { logger } from "../../core/logging/logger";

export const errorHandler = (error: Error, c: Context): Response => {
  // Enhanced console logging for root cause analysis
  console.error(`[GLOBAL_ERROR] ${c.req.method} ${c.req.url}:`, {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause
  });

  logger.error(`Error: ${c.req.method} ${c.req.url}`, error);

  const errorCode =
    (error as { code?: ErrorCode }).code || ErrorCode.INTERNAL_ERROR;
  const statusCode =
    errorCode === ErrorCode.NOT_FOUND
      ? HTTP_STATUS_CODES.NOT_FOUND
      : errorCode === ErrorCode.VALIDATION_ERROR
        ? HTTP_STATUS_CODES.BAD_REQUEST
        : HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;

  return c.json(
    {
      success: false,
      error: error.name || "Internal Server Error",
      message: error.message || "An unexpected error occurred",
      code: errorCode
    },
    statusCode
  );
};

export const notFoundHandler = (c: Context): Response => {
  if (c.req.path.startsWith("/api/compiler")) {
    logger.warn("Route not found", { method: c.req.method, path: c.req.path });
  }

  return c.json(
    {
      success: false,
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.url} not found`,
      code: ErrorCode.NOT_FOUND
    },
    HTTP_STATUS_CODES.NOT_FOUND
  );
};
