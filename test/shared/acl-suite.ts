import { beforeAll, describe, expect, it } from "vitest";
import { Acl } from "../../src/acl.js";
import type { Backend } from "../../src/types.js";

/**
 * The shared behavioral suite, ported faithfully from the legacy
 * test/tests.js + test/backendtests.js. It is stateful and ordered: each block
 * builds on the previous one, exactly as the original suite did.
 *
 * Run it once per backend by passing a factory that yields a *clean* backend.
 */
export function runAclSuite(name: string, makeBackend: () => Promise<Backend> | Backend): void {
  describe(name, () => {
    let backend: Backend;
    let acl: Acl;

    beforeAll(async () => {
      backend = await makeBackend();
      await backend.clean();
      acl = new Acl(backend);
    });

    // --- constructor -------------------------------------------------------
    describe("constructor", () => {
      it("uses default bucket names", () => {
        const a = new Acl(backend);
        expect(a.buckets.meta).toBe("meta");
        expect(a.buckets.parents).toBe("parents");
        expect(a.buckets.permissions).toBe("permissions");
        expect(a.buckets.resources).toBe("resources");
        expect(a.buckets.roles).toBe("roles");
        expect(a.buckets.users).toBe("users");
      });

      it("uses given bucket names", () => {
        const a = new Acl(backend, undefined, {
          buckets: {
            meta: "Meta",
            parents: "Parents",
            permissions: "Permissions",
            resources: "Resources",
            roles: "Roles",
            users: "Users",
          },
        });
        expect(a.buckets.meta).toBe("Meta");
        expect(a.buckets.parents).toBe("Parents");
        expect(a.buckets.permissions).toBe("Permissions");
        expect(a.buckets.resources).toBe("Resources");
        expect(a.buckets.roles).toBe("Roles");
        expect(a.buckets.users).toBe("Users");
      });
    });

    // --- allow / addUserRoles ---------------------------------------------
    describe("allow", () => {
      it("guest to view blogs", () => acl.allow("guest", "blogs", "view"));
      it("guest to view forums", () => acl.allow("guest", "forums", "view"));
      it("member to view/edit/delete blogs", () =>
        acl.allow("member", "blogs", ["edit", "view", "delete"]));
    });

    describe("Add user roles", () => {
      it("joed => guest, jsmith => member, harry => admin, test@test.com => member", async () => {
        await acl.addUserRoles("joed", "guest");
        await acl.addUserRoles("jsmith", "member");
        await acl.addUserRoles("harry", "admin");
        await acl.addUserRoles("test@test.com", "member");
      });

      it("0 => guest, 1 => member, 2 => admin", async () => {
        await acl.addUserRoles(0, "guest");
        await acl.addUserRoles(1, "member");
        await acl.addUserRoles(2, "admin");
      });
    });

    describe("read User Roles", () => {
      it("userRoles / hasRole", async () => {
        await acl.addUserRoles("harry", "admin");
        expect(await acl.userRoles("harry")).toEqual(["admin"]);
        expect(await acl.hasRole("harry", "admin")).toBe(true);
        expect(await acl.hasRole("harry", "no role")).toBe(false);
      });
    });

    describe("read Role Users", () => {
      it("roleUsers", async () => {
        await acl.addUserRoles("harry", "admin");
        const users = await acl.roleUsers("admin");
        expect(users).toContain("harry");
        expect(users).not.toContain("invalid User");
      });
    });

    describe("allow more", () => {
      it("admin view/add/edit/delete users", () =>
        acl.allow("admin", "users", ["add", "edit", "view", "delete"]));
      it("foo view/edit blogs", () => acl.allow("foo", "blogs", ["edit", "view"]));
      it("bar to view/delete blogs", () => acl.allow("bar", "blogs", ["view", "delete"]));
    });

    describe("add role parents", () => {
      it("add them", () => acl.addRoleParents("baz", ["foo", "bar"]));
    });

    describe("add user roles (baz)", () => {
      it("string userId", () => acl.addUserRoles("james", "baz"));
      it("numeric userId", () => acl.addUserRoles(3, "baz"));
    });

    describe("allow admin to do anything", () => {
      it("add them", () => acl.allow("admin", ["blogs", "forums"], "*"));
    });

    describe("Arguments in one array", () => {
      it("give role fumanchu an array of resources and permissions", () =>
        acl.allow([
          {
            roles: "fumanchu",
            allows: [
              { resources: "blogs", permissions: "get" },
              { resources: ["forums", "news"], permissions: ["get", "put", "delete"] },
              {
                resources: ["/path/file/file1.txt", "/path/file/file2.txt"],
                permissions: ["get", "put", "delete"],
              },
            ],
          },
        ]));
    });

    describe("Add fumanchu role to suzanne", () => {
      it("string userId", () => acl.addUserRoles("suzanne", "fumanchu"));
      it("numeric userId", () => acl.addUserRoles(4, "fumanchu"));
    });

    // --- allowance queries -------------------------------------------------
    describe("isAllowed", () => {
      const allowed = (u: string | number, r: string, p: string | string[]) =>
        acl.isAllowed(u, r, p);

      it("joed view blogs", async () => expect(await allowed("joed", "blogs", "view")).toBe(true));
      it("userId=0 view blogs", async () => expect(await allowed(0, "blogs", "view")).toBe(true));
      it("joed view forums", async () =>
        expect(await allowed("joed", "forums", "view")).toBe(true));
      it("userId=0 view forums", async () => expect(await allowed(0, "forums", "view")).toBe(true));
      it("joed edit forums (no)", async () =>
        expect(await allowed("joed", "forums", "edit")).toBe(false));
      it("userId=0 edit forums (no)", async () =>
        expect(await allowed(0, "forums", "edit")).toBe(false));
      it("jsmith edit forums (no)", async () =>
        expect(await allowed("jsmith", "forums", "edit")).toBe(false));
      it("jsmith edit blogs", async () =>
        expect(await allowed("jsmith", "blogs", "edit")).toBe(true));
      it("test@test.com edit forums (no)", async () =>
        expect(await allowed("test@test.com", "forums", "edit")).toBe(false));
      it("test@test.com edit blogs", async () =>
        expect(await allowed("test@test.com", "blogs", "edit")).toBe(true));
      it("userId=1 edit blogs", async () => expect(await allowed(1, "blogs", "edit")).toBe(true));
      it("jsmith edit/view/clone blogs (no)", async () =>
        expect(await allowed("jsmith", "blogs", ["edit", "view", "clone"])).toBe(false));
      it("test@test.com edit/view/clone blogs (no)", async () =>
        expect(await allowed("test@test.com", "blogs", ["edit", "view", "clone"])).toBe(false));
      it("userId=1 edit/view/clone blogs (no)", async () =>
        expect(await allowed(1, "blogs", ["edit", "view", "clone"])).toBe(false));
      it("jsmith edit/clone blogs (no)", async () =>
        expect(await allowed("jsmith", "blogs", ["edit", "clone"])).toBe(false));
      it("james add blogs (no)", async () =>
        expect(await allowed("james", "blogs", "add")).toBe(false));
      it("userId=3 add blogs (no)", async () =>
        expect(await allowed(3, "blogs", "add")).toBe(false));
      it("suzanne add blogs (no)", async () =>
        expect(await allowed("suzanne", "blogs", "add")).toBe(false));
      it("userId=4 add blogs (no)", async () =>
        expect(await allowed(4, "blogs", "add")).toBe(false));
      it("suzanne get blogs", async () =>
        expect(await allowed("suzanne", "blogs", "get")).toBe(true));
      it("userId=4 get blogs", async () => expect(await allowed(4, "blogs", "get")).toBe(true));
      it("suzanne put/delete news", async () =>
        expect(await allowed("suzanne", "news", ["put", "delete"])).toBe(true));
      it("userId=4 put/delete news", async () =>
        expect(await allowed(4, "news", ["put", "delete"])).toBe(true));
      it("suzanne put/delete forums", async () =>
        expect(await allowed("suzanne", "forums", ["put", "delete"])).toBe(true));
      it("userId=4 put/delete forums", async () =>
        expect(await allowed(4, "forums", ["put", "delete"])).toBe(true));
      it("nobody view blogs (no)", async () =>
        expect(await allowed("nobody", "blogs", "view")).toBe(false));
      it("nobody view nothing (no)", async () =>
        expect(await allowed("nobody", "nothing", "view")).toBe(false));
    });

    describe("allowedPermissions", () => {
      it("james over blogs and forums", async () => {
        const p = await acl.allowedPermissions("james", ["blogs", "forums"]);
        expect(p).toHaveProperty("blogs");
        expect(p).toHaveProperty("forums");
        expect(p.blogs).toContain("edit");
        expect(p.blogs).toContain("delete");
        expect(p.blogs).toContain("view");
        expect(p.forums).toHaveLength(0);
      });
      it("userId=3 over blogs and forums", async () => {
        const p = await acl.allowedPermissions(3, ["blogs", "forums"]);
        expect(p.blogs).toContain("edit");
        expect(p.blogs).toContain("delete");
        expect(p.blogs).toContain("view");
        expect(p.forums).toHaveLength(0);
      });
      it("nonsense user over blogs and forums", async () => {
        const p = await acl.allowedPermissions("nonsense", ["blogs", "forums"]);
        expect(p.forums).toHaveLength(0);
        expect(p.blogs).toHaveLength(0);
      });
    });

    // --- whatResources -----------------------------------------------------
    describe("whatResources queries", () => {
      it('"bar" some rights', async () => {
        const r = (await acl.whatResources("bar")) as Record<string, string[]>;
        expect(r.blogs).toContain("view");
        expect(r.blogs).toContain("delete");
      });
      it('"bar" view rights', async () => {
        const r = (await acl.whatResources("bar", "view")) as string[];
        expect(r).toContain("blogs");
      });
      it('"fumanchu" some rights', async () => {
        const r = (await acl.whatResources("fumanchu")) as Record<string, string[]>;
        expect(r.blogs).toContain("get");
        expect(r.forums).toContain("delete");
        expect(r.forums).toContain("get");
        expect(r.forums).toContain("put");
        expect(r.news).toContain("delete");
        expect(r.news).toContain("get");
        expect(r.news).toContain("put");
        expect(r["/path/file/file1.txt"]).toContain("delete");
        expect(r["/path/file/file2.txt"]).toContain("put");
      });
      it('"baz" some rights', async () => {
        const r = (await acl.whatResources("baz")) as Record<string, string[]>;
        expect(r.blogs).toContain("view");
        expect(r.blogs).toContain("delete");
        expect(r.blogs).toContain("edit");
      });
    });

    // --- removeAllow -------------------------------------------------------
    describe("removeAllow", () => {
      it("remove get from blogs/forums for fumanchu", () =>
        acl.removeAllow("fumanchu", ["blogs", "forums"], "get"));
      it("remove delete from news for fumanchu", () =>
        acl.removeAllow("fumanchu", "news", "delete"));
      it("remove view from blogs for bar", () => acl.removeAllow("bar", "blogs", "view"));
    });

    describe("See if permissions were removed", () => {
      it("fumanchu rights after removal", async () => {
        const r = (await acl.whatResources("fumanchu")) as Record<string, string[]>;
        expect("blogs" in r).toBe(false);
        expect(r).toHaveProperty("news");
        expect(r.news).toContain("get");
        expect(r.news).toContain("put");
        expect(r.news).not.toContain("delete");
        expect(r).toHaveProperty("forums");
        expect(r.forums).toContain("delete");
        expect(r.forums).toContain("put");
      });
    });

    // --- removeRole --------------------------------------------------------
    describe("removeRole", () => {
      it("remove fumanchu", () => acl.removeRole("fumanchu"));
      it("remove member", () => acl.removeRole("member"));
      it("remove foo", () => acl.removeRole("foo"));
    });

    describe("Was role removed?", () => {
      it("fumanchu has no resources", async () => {
        const r = (await acl.whatResources("fumanchu")) as Record<string, string[]>;
        expect(Object.keys(r)).toHaveLength(0);
      });
      it("member has no resources", async () => {
        const r = (await acl.whatResources("member")) as Record<string, string[]>;
        expect(Object.keys(r)).toHaveLength(0);
      });
      it("jsmith over blogs and forums (empty)", async () => {
        const p = await acl.allowedPermissions("jsmith", ["blogs", "forums"]);
        expect(p.blogs).toHaveLength(0);
        expect(p.forums).toHaveLength(0);
      });
      it("test@test.com over blogs and forums (empty)", async () => {
        const p = await acl.allowedPermissions("test@test.com", ["blogs", "forums"]);
        expect(p.blogs).toHaveLength(0);
        expect(p.forums).toHaveLength(0);
      });
      it("james over blogs still has delete", async () => {
        const p = await acl.allowedPermissions("james", "blogs");
        expect(p).toHaveProperty("blogs");
        expect(p.blogs).toContain("delete");
      });
    });

    // --- RoleParentRemoval (self-contained) --------------------------------
    describe("RoleParentRemoval", () => {
      beforeAll(async () => {
        await acl.allow("parent1", "x", "read1");
        await acl.allow("parent2", "x", "read2");
        await acl.allow("parent3", "x", "read3");
        await acl.allow("parent4", "x", "read4");
        await acl.allow("parent5", "x", "read5");
        await acl.addRoleParents("child", ["parent1", "parent2", "parent3", "parent4", "parent5"]);
      });

      const childResources = async () =>
        (await acl.whatResources("child")) as Record<string, string[]>;

      it("environment check", async () => {
        const r = await childResources();
        expect(r.x).toHaveLength(5);
        expect(r.x).toEqual(expect.arrayContaining(["read1", "read2", "read3", "read4", "read5"]));
      });

      it("returns a promise removing a specific parent role", () =>
        acl.removeRoleParents("child", "parentX"));
      it("returns a promise removing multiple specific parent roles", () =>
        acl.removeRoleParents("child", ["parentX", "parentY"]));

      it('remove non-existent "parentX" keeps all 5', async () => {
        await acl.removeRoleParents("child", "parentX");
        const r = await childResources();
        expect(r.x).toHaveLength(5);
      });

      it('remove "parent1" leaves 4', async () => {
        await acl.removeRoleParents("child", "parent1");
        const r = await childResources();
        expect(r.x).toHaveLength(4);
        expect(r.x).toEqual(expect.arrayContaining(["read2", "read3", "read4", "read5"]));
      });

      it('remove "parent2" & "parent3" leaves 2', async () => {
        await acl.removeRoleParents("child", ["parent2", "parent3"]);
        const r = await childResources();
        expect(r.x).toHaveLength(2);
        expect(r.x).toEqual(expect.arrayContaining(["read4", "read5"]));
      });

      it("remove all parent roles", async () => {
        await acl.removeRoleParents("child");
        const r = await childResources();
        expect(r).not.toHaveProperty("x");
      });

      it("remove all parent roles again (idempotent)", async () => {
        await acl.removeRoleParents("child");
        const r = await childResources();
        expect(r).not.toHaveProperty("x");
      });

      it("remove specific parent when none remain", async () => {
        await acl.removeRoleParents("child", "parent1");
        const r = await childResources();
        expect(r).not.toHaveProperty("x");
      });

      it("remove all parent roles resolves", () => acl.removeRoleParents("child"));
    });

    // --- removeResource ----------------------------------------------------
    describe("removeResource", () => {
      it("remove blogs", () => acl.removeResource("blogs"));
      it("remove users", () => acl.removeResource("users"));
    });

    describe("allowedPermissions after resource removal", () => {
      it("james over blogs (empty)", async () => {
        const p = await acl.allowedPermissions("james", "blogs");
        expect(p).toHaveProperty("blogs");
        expect(p.blogs).toHaveLength(0);
      });
      it("userId=4 over blogs (empty)", async () => {
        const p = await acl.allowedPermissions(4, "blogs");
        expect(p).toHaveProperty("blogs");
        expect(p.blogs).toHaveLength(0);
      });
    });

    describe("whatResources after resource removal", () => {
      it('"baz" has nothing', async () => {
        const r = (await acl.whatResources("baz")) as Record<string, string[]>;
        expect(typeof r).toBe("object");
        expect(Object.keys(r)).toHaveLength(0);
      });
      it('"admin" lost users and blogs', async () => {
        const r = (await acl.whatResources("admin")) as Record<string, string[]>;
        expect("users" in r).toBe(false);
        expect("blogs" in r).toBe(false);
      });
    });

    // --- removeUserRoles ---------------------------------------------------
    describe("Remove user roles", () => {
      it("guest from joed", () => acl.removeUserRoles("joed", "guest"));
      it("guest from userId=0", () => acl.removeUserRoles(0, "guest"));
      it("admin from harry", () => acl.removeUserRoles("harry", "admin"));
      it("admin from userId=2", () => acl.removeUserRoles(2, "admin"));
    });

    describe("Were roles removed?", () => {
      it("harry over forums and blogs (empty)", async () => {
        const p = await acl.allowedPermissions("harry", ["forums", "blogs"]);
        expect(typeof p).toBe("object");
        expect(p.forums).toHaveLength(0);
      });
    });

    // --- Github issue #55 --------------------------------------------------
    describe("Github issue #55: removeAllow removing all permissions", () => {
      it("removeAllow removes only the named permission", async () => {
        await acl.addUserRoles("jannette", "member");
        await acl.allow("member", "blogs", ["view", "update"]);
        expect(await acl.isAllowed("jannette", "blogs", "view")).toBe(true);
        await acl.removeAllow("member", "blogs", "update");
        expect(await acl.isAllowed("jannette", "blogs", "view")).toBe(true);
        expect(await acl.isAllowed("jannette", "blogs", "update")).toBe(false);
        await acl.removeAllow("member", "blogs", "view");
        expect(await acl.isAllowed("jannette", "blogs", "view")).toBe(false);
      });
    });

    // --- Github issue #32 --------------------------------------------------
    describe("Github issue #32: removeRole removes the entire allows document", () => {
      it("add roles/resources/permissions", () =>
        acl.allow(
          ["role1", "role2", "role3"],
          ["res1", "res2", "res3"],
          ["perm1", "perm2", "perm3"],
        ));

      it("add user roles and parent roles", async () => {
        await acl.addUserRoles("user1", "role1");
        await acl.addRoleParents("role1", "parentRole1");
      });

      it("add user roles and parent roles (numeric)", async () => {
        await acl.addUserRoles(1, "role1");
        await acl.addRoleParents("role1", "parentRole1");
      });

      it("roles have permissions as assigned", async () => {
        const r1 = (await acl.whatResources("role1")) as Record<string, string[]>;
        expect([...(r1.res1 ?? [])].sort()).toEqual(["perm1", "perm2", "perm3"]);
        const r2 = (await acl.whatResources("role2")) as Record<string, string[]>;
        expect([...(r2.res1 ?? [])].sort()).toEqual(["perm1", "perm2", "perm3"]);
      });

      it('remove "role1"', () => acl.removeRole("role1"));

      it('"role1" empty, "role2" intact', async () => {
        await acl.removeRole("role1");
        const r1 = (await acl.whatResources("role1")) as Record<string, string[]>;
        expect(Object.keys(r1)).toHaveLength(0);
        const r2 = (await acl.whatResources("role2")) as Record<string, string[]>;
        expect([...(r2.res1 ?? [])].sort()).toEqual(["perm1", "perm2", "perm3"]);
      });
    });

    // --- backend unions conformance ----------------------------------------
    describe("backend unions", () => {
      const testData: Record<string, string[]> = {
        key1: ["1", "2", "3"],
        key2: ["3", "2", "4"],
        key3: ["3", "4", "5"],
      };
      const dataBuckets = ["bucket1", "bucket2"];

      beforeAll(async () => {
        if (!backend.unions) return;
        await backend.clean();
        const t = backend.begin();
        for (const key of Object.keys(testData)) {
          for (const bucket of dataBuckets) {
            backend.add(t, bucket, key, testData[key] as string[]);
          }
        }
        await backend.end(t);
      });

      it("responds with an appropriate map", async () => {
        if (!backend.unions) return;
        const result = await backend.unions(dataBuckets, Object.keys(testData));
        expect(result.bucket1?.sort()).toEqual(["1", "2", "3", "4", "5"]);
        expect(result.bucket2?.sort()).toEqual(["1", "2", "3", "4", "5"]);
      });

      it("gets only the specified keys", async () => {
        if (!backend.unions) return;
        const result = await backend.unions(dataBuckets, ["key1"]);
        expect(result.bucket1?.sort()).toEqual(["1", "2", "3"]);
        expect(result.bucket2?.sort()).toEqual(["1", "2", "3"]);
      });

      it("gets only the specified buckets", async () => {
        if (!backend.unions) return;
        const result = await backend.unions(["bucket1"], ["key1"]);
        expect(Object.keys(result)).toEqual(["bucket1"]);
        expect(result.bucket1?.sort()).toEqual(["1", "2", "3"]);
      });
    });
  });
}
