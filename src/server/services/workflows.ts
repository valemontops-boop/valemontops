import { ConflictError, type DataRepository, type Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";

/**
 * Multi-tab workflows (spec 4.4). One `WorkflowRuns` row per (workflow, subject) with id = UUIDv5, so two clicks or two
 * founders share the same run. Each step writes rows with deterministic child ids (UUIDv5 of the run id + step name) and
 * must check "already there?" with a fresh read before inserting: a run killed after a write but before its step was
 * marked done re-runs that step without creating a duplicate. Finished steps are skipped on retry. No ACID claim:
 * a partial run stays visible (status running / failed) and is resumable from the UI.
 */
export type WorkflowName = Row<"WorkflowRuns">["workflow"];
export type RunRow = Row<"WorkflowRuns">;
export interface StepDef<I> { name: string; run: (input: I, runId: string) => Promise<string[]> }

export const runIdOf = (workflow: WorkflowName, subjectId: string) => childId("workflow", workflow, subjectId);
/** Deterministic child id for a row written by a step (spec 4.4). */
export const stepChildId = (runId: string, step: string, ...more: string[]) => childId(runId, step, ...more);

export interface RunResult { runId: string; status: RunRow["status"]; failedStep: string | null; error: string; steps: RunRow["steps"]; resumed: boolean; alreadyDone: boolean }

async function save(repo: DataRepository, run: RunRow, patch: Partial<RunRow>, founder: FounderKey): Promise<RunRow> {
  try {
    return await repo.update("WorkflowRuns", run.id, run.version, patch, { founder });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    // Another runner moved the row: merge our step on top of the fresh state (steps only ever move to "done").
    const fresh = await repo.get("WorkflowRuns", run.id, { fresh: true });
    if (!fresh) throw e;
    const steps = { ...fresh.steps, ...Object.fromEntries(Object.entries(patch.steps ?? {}).filter(([k]) => fresh.steps[k]?.status !== "done")) };
    return repo.update("WorkflowRuns", run.id, fresh.version, { ...patch, steps }, { founder });
  }
}

export async function runWorkflow<I extends Record<string, unknown>>(
  repo: DataRepository,
  founder: FounderKey,
  o: { workflow: WorkflowName; subjectType: RunRow["subject_type"]; subjectId: string; input: I; steps: StepDef<I>[] },
): Promise<RunResult> {
  const runId = runIdOf(o.workflow, o.subjectId);
  let run = await repo.get("WorkflowRuns", runId, { fresh: true });
  const resumed = Boolean(run);
  if (run?.status === "done") return { runId, status: "done", failedStep: null, error: "", steps: run.steps, resumed, alreadyDone: true };
  if (!run) {
    await repo.insert("WorkflowRuns", [{ id: runId, workflow: o.workflow, subject_type: o.subjectType, subject_id: o.subjectId, status: "running", steps: {}, input: o.input, started_by: founder, last_error: "", attempts: 1 }], { founder });
    run = await repo.get("WorkflowRuns", runId, { fresh: true });
    if (!run) throw new Error("Workflow run could not be read back");
  } else {
    run = await save(repo, run, { status: "running", attempts: run.attempts + 1, last_error: "" }, founder);
  }
  // The input is frozen at the first run: a retry finishes the same job, even if the form changed since.
  const input = (Object.keys(run.input).length ? run.input : o.input) as I;
  for (const step of o.steps) {
    if (run.steps[step.name]?.status === "done") continue;
    try {
      const ids = await step.run(input, runId);
      run = await save(repo, run, { steps: { ...run.steps, [step.name]: { status: "done", at: new Date().toISOString(), ids, error: "" } } }, founder);
    } catch (e) {
      const error = ((e as Error)?.message ?? "failed").slice(0, 300);
      try {
        run = await save(repo, run, { status: "failed", last_error: `${step.name}: ${error}`, steps: { ...run.steps, [step.name]: { status: "failed", at: new Date().toISOString(), ids: [], error } } }, founder);
      } catch {
        /* storage is down: the row stays "running", which the UI shows as interrupted and resumable */
      }
      return { runId, status: "failed", failedStep: step.name, error, steps: run.steps, resumed, alreadyDone: false };
    }
  }
  run = await save(repo, run, { status: "done", last_error: "" }, founder);
  return { runId, status: "done", failedStep: null, error: "", steps: run.steps, resumed, alreadyDone: false };
}
