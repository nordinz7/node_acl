import type { Acl } from "./acl.js";
import type { OneOrMany, Permission, UserId } from "./types.js";

/**
 * Minimal structural request shape the middleware needs. Compatible with
 * Express (and most HTTP frameworks) without depending on their types.
 */
export interface AclRequest {
  originalUrl?: string;
  url?: string;
  method: string;
  session?: { userId?: UserId };
  user?: { id?: UserId };
}

export interface AclResponse {
  status(code: number): {
    end(body?: string): unknown;
    json(body: unknown): unknown;
    send(body: unknown): unknown;
  };
}

export type AclNext = (err?: unknown) => void;

export type AclMiddleware = (req: AclRequest, res: AclResponse, next: AclNext) => void;

/** Resolves the userId for a request when not supplied statically. */
export type UserIdResolver = (req: AclRequest, res: AclResponse) => UserId | undefined;

/** Error thrown by the middleware; pair it with {@link aclErrorHandler}. */
export class HttpError extends Error {
  readonly errorCode: number;
  override readonly name = "HttpError";

  constructor(errorCode: number, message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

/**
 * Build an Express-style middleware that authorizes the current request.
 *
 * @param acl                The Acl instance to check against.
 * @param numPathComponents  How many leading URL path components form the
 *                           resource name (default: the whole path).
 * @param userId             A static user id, or a resolver `(req, res) => id`.
 *                           Defaults to `req.session.userId` / `req.user.id`.
 * @param actions            Permission(s) to check (default: the HTTP method).
 */
export function aclMiddleware(
  acl: Acl,
  numPathComponents?: number,
  userId?: UserId | UserIdResolver,
  actions?: OneOrMany<Permission>,
): AclMiddleware {
  return (req, res, next) => {
    let resolvedUserId: UserId | undefined;
    if (typeof userId === "function") {
      resolvedUserId = userId(req, res);
    } else if (userId !== undefined) {
      resolvedUserId = userId;
    } else {
      resolvedUserId = req.session?.userId ?? req.user?.id;
    }

    if (resolvedUserId === undefined || resolvedUserId === null) {
      next(new HttpError(401, "User not authenticated"));
      return;
    }

    const fullUrl = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
    const resource = numPathComponents
      ? fullUrl
          .split("/")
          .slice(0, numPathComponents + 1)
          .join("/")
      : fullUrl;

    const resolvedActions = actions ?? req.method.toLowerCase();

    acl.logger?.debug(`Requesting ${resolvedActions} on ${resource} by user ${resolvedUserId}`);

    acl.isAllowed(resolvedUserId, resource, resolvedActions).then(
      (allowed) => {
        if (allowed) {
          acl.logger?.debug(`Allowed ${resolvedActions} on ${resource} by user ${resolvedUserId}`);
          next();
        } else {
          acl.logger?.debug(
            `Not allowed ${resolvedActions} on ${resource} by user ${resolvedUserId}`,
          );
          next(new HttpError(403, "Insufficient permissions to access resource"));
        }
      },
      () => next(new Error("Error checking permissions to access resource")),
    );
  };
}

/**
 * Express error handler that renders {@link HttpError}s. Pass `"json"` or
 * `"html"` to choose the response format (defaults to plain text).
 */
export function aclErrorHandler(
  contentType?: "json" | "html",
): (err: unknown, req: AclRequest, res: AclResponse, next: AclNext) => void {
  return (err, _req, res, next) => {
    if (!(err instanceof HttpError) || !err.errorCode) {
      next(err);
      return;
    }
    const response = res.status(err.errorCode);
    if (contentType === "json") {
      response.json({ message: err.message });
    } else if (contentType === "html") {
      response.send(err.message);
    } else {
      response.end(err.message);
    }
  };
}
