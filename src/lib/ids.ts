import { v4, v5 } from "uuid";

/** Fixed namespace for deterministic child ids (UUIDv5), spec 4.4. */
export const VALEMONT_NS = "6f1c1d9e-3b7a-5d2e-9a64-2c8f0b7e4a11";

export const newId = () => v4();
export const childId = (...parts: string[]) => v5(parts.join(":"), VALEMONT_NS);
