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
});
