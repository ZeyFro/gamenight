function findCategoriesMissingPermissionPolicy(categories) {
  return categories
    .filter((category) => !category.reuse_category_id && !Array.isArray(category.permission_overwrites))
    .map((category) => category.name);
}

function assertCategoriesHavePermissionPolicy(categories) {
  const missing = findCategoriesMissingPermissionPolicy(categories);
  if (missing.length) {
    throw new Error("New categories need an explicit permission_overwrites policy before apply: " + missing.join(", "));
  }
}

function permissionOverwritesForChild(parentCategory) {
  if (!Array.isArray(parentCategory?.permission_overwrites)) {
    throw new Error("Cannot verify parent category permissions: " + (parentCategory?.name ?? "unknown"));
  }
  return parentCategory.permission_overwrites;
}

function assertExistingCategoryPermissionPolicyMatches(existing, category) {
  const expected = category.permission_overwrites;
  const actual = existing?.permission_overwrites;
  if (!Array.isArray(expected) || !Array.isArray(actual)) {
    throw new Error("Cannot verify existing category permission policy: " + category.name);
  }
  const signature = overwrites => overwrites
    .map(({ id, type, allow, deny }) => `${id}:${type}:${allow ?? "0"}:${deny ?? "0"}`)
    .sort()
    .join("\n");
  if (signature(actual) !== signature(expected)) {
    throw new Error("Existing category permission policy differs from manifest: " + category.name);
  }
}

module.exports = {
  assertCategoriesHavePermissionPolicy,
  assertExistingCategoryPermissionPolicyMatches,
  findCategoriesMissingPermissionPolicy,
  permissionOverwritesForChild,
};
