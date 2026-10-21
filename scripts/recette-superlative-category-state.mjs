export async function disableExistingSuperlativeCategories(db, state) {
  state.originals = await db.superlativeCategory.findMany({ select: { id: true, active: true } });
  if (state.originals.length) {
    await db.superlativeCategory.updateMany({
      where: { id: { in: state.originals.map(({ id }) => id) } },
      data: { active: false },
    });
  }
}

export async function restoreRecipeSuperlativeCategories(db, state) {
  const operations = [];
  if (state.recipeCategoryId) operations.push(db.superlativeCategory.deleteMany({ where: { id: state.recipeCategoryId } }));
  for (const { id, active } of state.originals ?? []) {
    operations.push(db.superlativeCategory.updateMany({ where: { id }, data: { active } }));
  }
  const outcomes = await Promise.allSettled(operations);
  const errors = outcomes.filter(outcome => outcome.status === "rejected").map(outcome => outcome.reason);
  if (errors.length) throw new AggregateError(errors, "Impossible de restaurer les catégories de superlatifs de la recette.");
}
