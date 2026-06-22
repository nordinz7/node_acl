import type {
  AclOptions,
  AllowRule,
  Backend,
  Buckets,
  Logger,
  OneOrMany,
  Permission,
  Resource,
  Role,
  UserId,
} from "./types.js";

const DEFAULT_BUCKETS: Buckets = {
  meta: "meta",
  parents: "parents",
  permissions: "permissions",
  resources: "resources",
  roles: "roles",
  users: "users",
};

const toArray = <T>(value: OneOrMany<T>): T[] => (Array.isArray(value) ? value : [value]);

/** Set-union of two arrays, preserving first-seen order. */
const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])];

/** The per-resource permissions bucket name (e.g. `allows_blogs`). */
const allowsBucket = (resource: Resource): string => `allows_${resource}`;

const keyFromAllowsBucket = (bucket: string): string => bucket.replace(/^allows_/, "");

/**
 * Access Control List. Models authorization as users -> roles -> resources ->
 * permissions, with role hierarchies (parents).
 *
 * Promise-native: every method returns a Promise (the legacy callback API is
 * intentionally dropped). Storage is delegated to a {@link Backend}.
 *
 * @typeParam T - the backend transaction type.
 */
export class Acl<T = unknown> {
  readonly backend: Backend<T>;
  readonly logger: Logger | undefined;
  readonly buckets: Buckets;

  constructor(backend: Backend<T>, logger?: Logger, options?: AclOptions) {
    this.backend = backend;
    this.logger = logger;
    this.buckets = { ...DEFAULT_BUCKETS, ...options?.buckets };
  }

  /** Adds roles to a given user id. */
  async addUserRoles(userId: UserId, roles: OneOrMany<Role>): Promise<void> {
    const transaction = this.backend.begin();
    this.backend.add(transaction, this.buckets.meta, "users", userId);
    this.backend.add(transaction, this.buckets.users, userId, roles);
    for (const role of toArray(roles)) {
      this.backend.add(transaction, this.buckets.roles, role, userId);
    }
    await this.backend.end(transaction);
  }

  /** Removes roles from a given user id. */
  async removeUserRoles(userId: UserId, roles: OneOrMany<Role>): Promise<void> {
    const transaction = this.backend.begin();
    this.backend.remove(transaction, this.buckets.users, userId, roles);
    for (const role of toArray(roles)) {
      this.backend.remove(transaction, this.buckets.roles, role, userId);
    }
    await this.backend.end(transaction);
  }

  /** Returns all the roles assigned to a given user id. */
  userRoles(userId: UserId): Promise<Role[]> {
    return this.backend.get(this.buckets.users, userId);
  }

  /** Returns all users that have the given role. */
  roleUsers(roleName: Role): Promise<UserId[]> {
    return this.backend.get(this.buckets.roles, roleName);
  }

  /** Returns whether the user has the given role. */
  async hasRole(userId: UserId, role: Role): Promise<boolean> {
    const roles = await this.userRoles(userId);
    return roles.includes(role);
  }

  /** Adds one or more parent roles to a role. */
  async addRoleParents(role: Role, parents: OneOrMany<Role>): Promise<void> {
    const transaction = this.backend.begin();
    this.backend.add(transaction, this.buckets.meta, "roles", role);
    this.backend.add(transaction, this.buckets.parents, role, parents);
    await this.backend.end(transaction);
  }

  /** Removes parent role(s) from a role. Omit `parents` to remove all of them. */
  async removeRoleParents(role: Role, parents?: OneOrMany<Role>): Promise<void> {
    const transaction = this.backend.begin();
    if (parents !== undefined) {
      this.backend.remove(transaction, this.buckets.parents, role, parents);
    } else {
      this.backend.del(transaction, this.buckets.parents, role);
    }
    await this.backend.end(transaction);
  }

  /** Removes a role from the system, including all its permissions. */
  async removeRole(role: Role): Promise<void> {
    // Note: this is not fully transactional.
    const resources = await this.backend.get(this.buckets.resources, role);
    const transaction = this.backend.begin();

    for (const resource of resources) {
      this.backend.del(transaction, allowsBucket(resource), role);
    }

    this.backend.del(transaction, this.buckets.resources, role);
    this.backend.del(transaction, this.buckets.parents, role);
    this.backend.del(transaction, this.buckets.roles, role);
    this.backend.remove(transaction, this.buckets.meta, "roles", role);

    // The `users` bucket keeps the removed role: we don't know which users
    // have it assigned.
    await this.backend.end(transaction);
  }

  /** Removes a resource from the system. */
  async removeResource(resource: Resource): Promise<void> {
    const roles = await this.backend.get(this.buckets.meta, "roles");
    const transaction = this.backend.begin();
    this.backend.del(transaction, allowsBucket(resource), roles);
    for (const role of roles) {
      this.backend.remove(transaction, this.buckets.resources, role, resource);
    }
    await this.backend.end(transaction);
  }

  /** Adds permissions to roles over resources (compact array form). */
  allow(rules: AllowRule[]): Promise<void>;
  /** Adds the given permissions to the given roles over the given resources. */
  allow(
    roles: OneOrMany<Role>,
    resources: OneOrMany<Resource>,
    permissions: OneOrMany<Permission>,
  ): Promise<void>;
  async allow(
    roles: AllowRule[] | OneOrMany<Role>,
    resources?: OneOrMany<Resource>,
    permissions?: OneOrMany<Permission>,
  ): Promise<void> {
    if (resources === undefined) {
      return this.allowEx(roles as AllowRule[]);
    }

    const rolesArr = toArray(roles as OneOrMany<Role>);
    const resourcesArr = toArray(resources);
    const transaction = this.backend.begin();

    this.backend.add(transaction, this.buckets.meta, "roles", rolesArr);

    for (const resource of resourcesArr) {
      for (const role of rolesArr) {
        this.backend.add(
          transaction,
          allowsBucket(resource),
          role,
          permissions as OneOrMany<Permission>,
        );
      }
    }
    for (const role of rolesArr) {
      this.backend.add(transaction, this.buckets.resources, role, resourcesArr);
    }

    await this.backend.end(transaction);
  }

  /** Removes permissions from a role over resources. Omit `permissions` to remove all. */
  removeAllow(
    role: Role,
    resources: OneOrMany<Resource>,
    permissions?: OneOrMany<Permission>,
  ): Promise<void> {
    return this.removePermissions(
      role,
      toArray(resources),
      permissions !== undefined ? toArray(permissions) : null,
    );
  }

  /**
   * Removes permissions from a role over the given resources. When
   * `permissions` is null the resource is fully revoked for the role.
   *
   * Note: loses atomicity when pruning emptied role/resource links.
   */
  async removePermissions(
    role: Role,
    resources: Resource[],
    permissions: Permission[] | null,
  ): Promise<void> {
    const transaction = this.backend.begin();
    for (const resource of resources) {
      const bucket = allowsBucket(resource);
      if (permissions) {
        this.backend.remove(transaction, bucket, role, permissions);
      } else {
        this.backend.del(transaction, bucket, role);
        this.backend.remove(transaction, this.buckets.resources, role, resource);
      }
    }
    await this.backend.end(transaction);

    // Remove the resource from the role when no rights remain. Not atomic.
    const cleanup = this.backend.begin();
    await Promise.all(
      resources.map(async (resource) => {
        const remaining = await this.backend.get(allowsBucket(resource), role);
        if (remaining.length === 0) {
          this.backend.remove(cleanup, this.buckets.resources, role, resource);
        }
      }),
    );
    await this.backend.end(cleanup);
  }

  /**
   * Returns, per resource, the permissions a user has. Uses the backend's
   * `unions` optimization when available.
   */
  async allowedPermissions(
    userId: UserId,
    resources: OneOrMany<Resource>,
  ): Promise<Record<Resource, Permission[]>> {
    if (!userId) {
      return {};
    }
    if (this.backend.unions) {
      return this.optimizedAllowedPermissions(userId, resources);
    }

    const resourcesArr = toArray(resources);
    const roles = await this.userRoles(userId);
    const result: Record<Resource, Permission[]> = {};
    await Promise.all(
      resourcesArr.map(async (resource) => {
        result[resource] = await this.resourcePermissions(roles, resource);
      }),
    );
    return result;
  }

  /** `allowedPermissions` variant using the backend `unions` bulk query. */
  async optimizedAllowedPermissions(
    userId: UserId,
    resources: OneOrMany<Resource>,
  ): Promise<Record<Resource, Permission[]>> {
    if (!userId) {
      return {};
    }
    const resourcesArr = toArray(resources);
    const roles = await this.allUserRoles(userId);
    const buckets = resourcesArr.map(allowsBucket);

    const response =
      roles.length === 0
        ? Object.fromEntries(buckets.map((bucket) => [bucket, [] as Permission[]]))
        : // biome-ignore lint/style/noNonNullAssertion: guarded by the `this.backend.unions` caller
          await this.backend.unions!(buckets, roles);

    const result: Record<Resource, Permission[]> = {};
    for (const bucket of Object.keys(response)) {
      result[keyFromAllowsBucket(bucket)] = response[bucket] ?? [];
    }
    return result;
  }

  /** Checks if a user is allowed all of the given permissions on a resource. */
  async isAllowed(
    userId: UserId,
    resource: Resource,
    permissions: OneOrMany<Permission>,
  ): Promise<boolean> {
    const roles = await this.backend.get(this.buckets.users, userId);
    if (roles.length) {
      return this.areAnyRolesAllowed(roles, resource, permissions);
    }
    return false;
  }

  /** Returns true if any of the roles has all of the given permissions. */
  areAnyRolesAllowed(
    roles: OneOrMany<Role>,
    resource: Resource,
    permissions: OneOrMany<Permission>,
  ): Promise<boolean> {
    const rolesArr = toArray(roles);
    const permsArr = toArray(permissions);
    if (rolesArr.length === 0) {
      return Promise.resolve(false);
    }
    return this.checkPermissions(rolesArr, resource, permsArr);
  }

  /** Returns a map of resource -> permissions the roles have. */
  whatResources(roles: OneOrMany<Role>): Promise<Record<Resource, Permission[]>>;
  /** Returns the resources the roles have all of the given permissions over. */
  whatResources(roles: OneOrMany<Role>, permissions: OneOrMany<Permission>): Promise<Resource[]>;
  whatResources(
    roles: OneOrMany<Role>,
    permissions?: OneOrMany<Permission>,
  ): Promise<Record<Resource, Permission[]> | Resource[]> {
    const rolesArr = toArray(roles);
    const perms = permissions === undefined ? undefined : toArray(permissions);
    return this.permittedResources(rolesArr, perms);
  }

  /** Backing implementation for {@link whatResources}. */
  async permittedResources(
    roles: OneOrMany<Role>,
    permissions?: Permission[],
  ): Promise<Record<Resource, Permission[]> | Resource[]> {
    const rolesArr = toArray(roles);
    const resources = await this.rolesResources(rolesArr);

    if (permissions === undefined) {
      const result: Record<Resource, Permission[]> = {};
      await Promise.all(
        resources.map(async (resource) => {
          result[resource] = await this.resourcePermissions(rolesArr, resource);
        }),
      );
      return result;
    }

    const result: Resource[] = [];
    await Promise.all(
      resources.map(async (resource) => {
        const p = await this.resourcePermissions(rolesArr, resource);
        if (permissions.some((perm) => p.includes(perm))) {
          result.push(resource);
        }
      }),
    );
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Compact array form of {@link allow}. */
  private async allowEx(rules: OneOrMany<AllowRule>): Promise<void> {
    const demuxed: Array<{
      roles: OneOrMany<Role>;
      resources: OneOrMany<Resource>;
      permissions: OneOrMany<Permission>;
    }> = [];

    for (const rule of toArray(rules)) {
      for (const a of rule.allows) {
        demuxed.push({ roles: rule.roles, resources: a.resources, permissions: a.permissions });
      }
    }

    // Sequential to mirror the legacy bluebird.reduce.
    for (const d of demuxed) {
      await this.allow(d.roles, d.resources, d.permissions);
    }
  }

  /** Direct parents of the given roles. */
  private rolesParents(roles: Role[]): Promise<Role[]> {
    return this.backend.union(this.buckets.parents, roles);
  }

  /** All roles in the hierarchy, including the given roles. */
  private async allRoles(roleNames: Role[]): Promise<Role[]> {
    const parents = await this.rolesParents(roleNames);
    if (parents.length > 0) {
      const parentRoles = await this.allRoles(parents);
      return union(roleNames, parentRoles);
    }
    return roleNames;
  }

  /** All roles in the hierarchy of the given user. */
  private async allUserRoles(userId: UserId): Promise<Role[]> {
    const roles = await this.userRoles(userId);
    if (roles && roles.length > 0) {
      return this.allRoles(roles);
    }
    return [];
  }

  /** All resources reachable by the given roles (through the hierarchy). */
  private async rolesResources(roles: OneOrMany<Role>): Promise<Resource[]> {
    const allRoles = await this.allRoles(toArray(roles));
    const result: Resource[] = [];
    await Promise.all(
      allRoles.map(async (role) => {
        const resources = await this.backend.get(this.buckets.resources, role);
        result.push(...resources);
      }),
    );
    return result;
  }

  /** Permissions the given roles (and their parents) have over a resource. */
  private async resourcePermissions(roles: Role[], resource: Resource): Promise<Permission[]> {
    if (roles.length === 0) {
      return [];
    }
    const resourcePermissions = await this.backend.union(allowsBucket(resource), roles);
    const parents = await this.rolesParents(roles);
    if (parents?.length) {
      const morePermissions = await this.resourcePermissions(parents, resource);
      return union(resourcePermissions, morePermissions);
    }
    return resourcePermissions;
  }

  /**
   * Whether the roles (and their parents) satisfy all permissions on a resource.
   *
   * NOTE: does not handle circular role hierarchies.
   */
  private async checkPermissions(
    roles: Role[],
    resource: Resource,
    permissions: Permission[],
  ): Promise<boolean> {
    const resourcePermissions = await this.backend.union(allowsBucket(resource), roles);

    if (resourcePermissions.includes("*")) {
      return true;
    }

    const remaining = permissions.filter((p) => !resourcePermissions.includes(p));
    if (remaining.length === 0) {
      return true;
    }

    const parents = await this.backend.union(this.buckets.parents, roles);
    if (parents?.length) {
      return this.checkPermissions(parents, resource, remaining);
    }
    return false;
  }
}
