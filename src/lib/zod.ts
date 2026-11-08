import { z } from "zod";

/**
 * Partial "patch" schema WITHOUT defaults. In zod v4, `.partial()` keeps `.default()` values, so a
 * partial update would silently reset fields the client did not send (e.g. owner -> null, stage -> targeted).
 */
export function patchOf<S extends z.ZodRawShape>(obj: z.ZodObject<S>) {
  const shape = Object.fromEntries(
    Object.entries(obj.shape).map(([k, v]) => {
      const inner = v instanceof z.ZodDefault ? (v as z.ZodDefault<z.ZodTypeAny>).unwrap() : (v as z.ZodTypeAny);
      return [k, inner.optional()];
    }),
  );
  return z.object(shape) as unknown as ReturnType<z.ZodObject<S>["partial"]>;
}
