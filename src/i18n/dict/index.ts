import { entries as calls } from "./calls";
import { entries as core } from "./core";
import { entries as crm } from "./crm";
import { entries as labels } from "./labels";
import { entries as marketing } from "./marketing";
import { entries as money } from "./money";
import { entries as myday } from "./myday";
import { entries as server } from "./server";
import { entries as settings } from "./settings";
import { entries as work } from "./work";

/** English source → [French, Spanish]. One file per area so several people can edit at once. */
export const ENTRIES: Record<string, readonly [string, string]> = { ...labels, ...server, ...core, ...calls, ...crm, ...myday, ...marketing, ...work, ...settings, ...money };
