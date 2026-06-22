import { beforeEach, describe, expect, it, vi } from "vitest";
import { Acl } from "../../src/acl.js";
import { MemoryBackend } from "../../src/backends/memory.js";
import {
  type AclRequest,
  type AclResponse,
  HttpError,
  aclErrorHandler,
} from "../../src/middleware.js";

describe("middleware", () => {
  let acl: Acl;

  beforeEach(async () => {
    acl = new Acl(new MemoryBackend());
    await acl.allow("admin", "/blogs", "get");
    await acl.addUserRoles("alice", "admin");
  });

  const makeRes = (): AclResponse => ({
    status: vi.fn(() => ({ end: vi.fn(), json: vi.fn(), send: vi.fn() })),
  });

  it("calls next() with no error when allowed", async () => {
    const mw = acl.middleware(undefined, "alice");
    const req = { originalUrl: "/blogs", method: "GET" } as AclRequest;
    const next = vi.fn();
    mw(req, makeRes(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    expect(next).toHaveBeenCalledWith();
  });

  it("passes a 403 HttpError when not allowed", async () => {
    const mw = acl.middleware(undefined, "alice");
    const req = { originalUrl: "/blogs", method: "DELETE" } as AclRequest;
    const next = vi.fn();
    mw(req, makeRes(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    const err = next.mock.calls[0]?.[0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.errorCode).toBe(403);
  });

  it("passes a 401 HttpError when no user can be resolved", () => {
    const mw = acl.middleware();
    const req = { originalUrl: "/blogs", method: "GET" } as AclRequest;
    const next = vi.fn();
    mw(req, makeRes(), next);
    const err = next.mock.calls[0]?.[0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.errorCode).toBe(401);
  });

  it("resolves userId from req.session and a resolver function", async () => {
    const sessionMw = acl.middleware();
    const req = {
      originalUrl: "/blogs",
      method: "GET",
      session: { userId: "alice" },
    } as AclRequest;
    const next1 = vi.fn();
    sessionMw(req, makeRes(), next1);
    await vi.waitFor(() => expect(next1).toHaveBeenCalledWith());

    const resolverMw = acl.middleware(undefined, () => "alice");
    const next2 = vi.fn();
    resolverMw({ originalUrl: "/blogs", method: "GET" } as AclRequest, makeRes(), next2);
    await vi.waitFor(() => expect(next2).toHaveBeenCalledWith());
  });

  it("limits the resource to numPathComponents", async () => {
    await acl.allow("admin", "/blogs/123", "get");
    const mw = acl.middleware(1, "alice");
    // /blogs/123/comments -> resource "/blogs/123"
    const req = { originalUrl: "/blogs/123/comments", method: "GET" } as AclRequest;
    const next = vi.fn();
    mw(req, makeRes(), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith());
  });

  describe("aclErrorHandler", () => {
    it("renders HttpError with the right status (plain text)", () => {
      const end = vi.fn();
      const res = { status: vi.fn(() => ({ end, json: vi.fn(), send: vi.fn() })) } as AclResponse;
      const next = vi.fn();
      aclErrorHandler()(new HttpError(403, "nope"), {} as AclRequest, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(end).toHaveBeenCalledWith("nope");
      expect(next).not.toHaveBeenCalled();
    });

    it("passes through non-HttpErrors", () => {
      const next = vi.fn();
      const err = new Error("other");
      aclErrorHandler()(err, {} as AclRequest, makeRes(), next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
