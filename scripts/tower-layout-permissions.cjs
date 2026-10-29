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
  return Array.isArray(parentCategory?.permission_overwrites) ? parentCategory.permission_overwrites : [];
}

module.exports = {
  assertCategoriesHavePermissionPolicy,
  findCategoriesMissingPermissionPolicy,
  permissionOverwritesForChild,
};
