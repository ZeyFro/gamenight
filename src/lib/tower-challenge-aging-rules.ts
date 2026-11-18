const DAY_MS = 24 * 60 * 60 * 1000;

type PendingProof = {
  status: string;
  submittedAt: Date;
  now: Date;
  qualifyingVoteCount: number;
  staffReportedAt: Date | null;
  archivedAt: Date | null;
  hasOpenAppeal: boolean;
};

export function getPendingProofAgingAction(input: PendingProof): "REPORT_STAFF" | "ARCHIVE" | null {
  const submittedAt = input.submittedAt.getTime();
  const current = input.now.getTime();
  if (!Number.isFinite(submittedAt) || !Number.isFinite(current) || input.qualifyingVoteCount < 0) {
    throw new RangeError("Âge de preuve invalide");
  }
  if (input.status !== "SUBMITTED" || input.qualifyingVoteCount >= 3 || input.hasOpenAppeal || input.archivedAt) return null;
  const age = current - submittedAt;
  if (age < 0) return null;
  if (age >= 30 * DAY_MS) return input.staffReportedAt ? "ARCHIVE" : "REPORT_STAFF";
  return age >= 7 * DAY_MS && !input.staffReportedAt ? "REPORT_STAFF" : null;
}
