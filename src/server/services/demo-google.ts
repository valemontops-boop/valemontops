import { FakeGoogleStore } from "@/fake-google/store";
import { addDays, localDate, startOfLocalDay } from "@/domain/time";

/** Synthetic DEMO calendars and Drive folder. Calendar/folder ids are fake (example.com). */
export const DEMO_IDS = {
  shared: "valemont-shared@group.calendar.example.com",
  theo: "theo-personal@calendar.example.com",
  pablo: "pablo-personal@calendar.example.com",
  folder: "demo-valemont-os-folder",
};

export function demoGoogleStore(now = new Date()): FakeGoogleStore {
  const s = new FakeGoogleStore();
  const today = localDate(now, "Europe/Paris");
  const at = (d: number, h: number, m = 0) => new Date(startOfLocalDay(addDays(today, d), "Europe/Paris").getTime() + (h * 60 + m) * 60_000).toISOString();
  s.addEvent(DEMO_IDS.shared, { id: "demo00shared01", title: "Demo with Garage du Parc (demo)", description: "Synthetic demo event", start: at(1, 11), end: at(1, 12) });
  s.addEvent(DEMO_IDS.shared, { id: "demo00shared02", title: "Discovery visit · Chauffage Morel (demo)", description: "", start: at(2, 14), end: at(2, 15) });
  s.addEvent(DEMO_IDS.theo, { id: "demo00theo0001", title: "Job interview (private)", description: "Private", start: at(1, 15), end: at(1, 16) });
  s.addEvent(DEMO_IDS.pablo, { id: "demo00pablo001", title: "Dentist (private)", description: "Private", start: at(1, 9), end: at(1, 10) });
  s.addEvent(DEMO_IDS.pablo, { id: "demo00pablo002", title: "Interview at a company (private)", description: "Private", start: at(3, 10), end: at(3, 11, 30) });
  s.addFile({ id: "demo-folder-clients", name: "Clients", mimeType: "application/vnd.google-apps.folder", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-folder-templates", name: "Templates", mimeType: "application/vnd.google-apps.folder", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-pitch", name: "Valemont Local pitch FR (demo).pdf", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-pitch-es", name: "Valemont Local pitch ES (demo).pdf", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-script", name: "Cold call script FR (demo)", mimeType: "application/vnd.google-apps.document", parents: ["demo-folder-templates"] });
  s.addFile({ id: "demo-file-duval", name: "Plomberie Duval notes (demo)", mimeType: "application/vnd.google-apps.document", parents: ["demo-folder-clients"] });
  return s;
}
