import { z } from "zod";

export const MAX_SESSION_CHRONICLE_LENGTH = 10000;
export const sessionChronicleInput = z.string().trim().max(MAX_SESSION_CHRONICLE_LENGTH).transform(value => value || null);
export const isSessionChroniclesEnabled = () => process.env.SESSION_CHRONICLES_ENABLED === "true";
