import { entries as calls } from "./calls";
import { entries as core } from "./core";
import { entries as crm } from "./crm";
import { entries as labels } from "./labels";
import { entries as marketing } from "./marketing";
import { entries as money } from "./money";
import { entries as myday } from "./myday";
import { entries as server } from "./server";
import { entries as overrides } from "./overrides";
import { entries as report } from "./report";
import { entries as round6 } from "./round6";
import { entries as growth7 } from "./growth7";
import { entries as work7 } from "./work7";
import { entries as calls7 } from "./calls7";
import { entries as seeds8 } from "./seeds8";
import { entries as data8 } from "./data8";
import { entries as growth8 } from "./growth8";
import { entries as calls8 } from "./calls8";
import { entries as calls9 } from "./calls9";
import { entries as growth9 } from "./growth9";
import { entries as seeds9 } from "./seeds9";
import { entries as settings } from "./settings";
import { entries as work } from "./work";

/** English source → [French, Spanish]. One file per area so several people can edit at once. */
export const ENTRIES: Record<string, readonly [string, string]> = { ...labels, ...server, ...core, ...calls, ...crm, ...myday, ...marketing, ...work, ...settings, ...money, ...report, ...round6, ...growth7, ...work7, ...calls7, ...seeds8, ...data8, ...growth8, ...calls8, ...calls9, ...growth9, ...seeds9, ...overrides };

/** Keys that describe sentences built on the server: only these (and number-only keys) are used as patterns. */
export const PATTERN_KEYS: ReadonlySet<string> = new Set([...Object.keys(labels), ...Object.keys(server), ...Object.keys(report), ...Object.keys(round6)]);
