import { describe, expect, it } from "vitest";
import permissions from "../../scripts/tower-layout-permissions.cjs";

describe("Tower category permission policy", () => {
  it("requires every new category to declare its visibility explicitly", () => {
    expect(permissions.findCategoriesMissingPermissionPolicy([
      { name: "Public", reuse_category_id: "123" },
      { name: "Needs review", create_category: true },
      { name: "Public by choice", create_category: true, permission_overwrites: [] },
    ])).toEqual(["Needs review"]);
  });

  it("accepts an explicit restricted-category overwrite list", () => {
    const restricted = [{ id: "role-id", type: 0, deny: "1024", allow: "0" }];
    const category = { name: "Restricted", create_category: true, permission_overwrites: restricted };
    expect(permissions.findCategoriesMissingPermissionPolicy([category])).toEqual([]);
    expect(() => permissions.assertCategoriesHavePermissionPolicy([category])).not.toThrow();
    expect(permissions.permissionOverwritesForChild(category)).toEqual(restricted);
  });

  it("blocks apply until every new category has an explicit policy", () => {
    expect(() => permissions.assertCategoriesHavePermissionPolicy([
      { name: "Needs review", create_category: true },
    ])).toThrow("Needs review");
  });

  it("blocks reusing a same-name category when its live permissions differ", () => {
    const approved = [{ id: "role-id", type: 0, allow: "1024", deny: "0" }];
    const live = [{ id: "role-id", type: 0, allow: "0", deny: "1024" }];
    expect(() => permissions.assertExistingCategoryPermissionPolicyMatches({
      id: "category-id",
      name: "Restricted",
      permission_overwrites: live,
    }, { name: "Restricted", permission_overwrites: approved })).toThrow("Restricted");
  });

  it("allows reusing a same-name category only when policies match independent of order", () => {
    const approved = [
      { id: "role-a", type: 0, allow: "1024", deny: "0" },
      { id: "role-b", type: 0, allow: "0", deny: "2048" },
    ];
    const live = [...approved].reverse();
    expect(() => permissions.assertExistingCategoryPermissionPolicyMatches({
      id: "category-id",
      name: "Restricted",
      permission_overwrites: live,
    }, { name: "Restricted", permission_overwrites: approved })).not.toThrow();
  });
});

