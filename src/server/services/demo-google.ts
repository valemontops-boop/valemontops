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
  s.addEvent(DEMO_IDS.shared, { id: "demo00shared01", title: "Démo avec Garage du Parc (demo)", description: "Événement de démo", start: at(1, 11), end: at(1, 12) });
  s.addEvent(DEMO_IDS.shared, { id: "demo00shared02", title: "Visite de découverte · Chauffage Morel (demo)", description: "", start: at(2, 14), end: at(2, 15) });
  s.addEvent(DEMO_IDS.theo, { id: "demo00theo0001", title: "Rendez-vous perso (privé)", description: "Privé", start: at(1, 15), end: at(1, 16) });
  s.addEvent(DEMO_IDS.pablo, { id: "demo00pablo001", title: "Dentista (privado)", description: "Privado", start: at(1, 9), end: at(1, 10) });
  s.addEvent(DEMO_IDS.pablo, { id: "demo00pablo002", title: "Cita personal (privado)", description: "Privado", start: at(3, 10), end: at(3, 11, 30) });
  s.addFile({ id: "demo-folder-clients", name: "Clients", mimeType: "application/vnd.google-apps.folder", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-folder-templates", name: "Modèles", mimeType: "application/vnd.google-apps.folder", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-pitch", name: "Valemont Local pitch FR (demo).pdf", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-pitch-es", name: "Valemont Local pitch ES (demo).pdf", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-file-script", name: "Script appel à froid FR (demo)", mimeType: "application/vnd.google-apps.document", parents: ["demo-folder-templates"] });
  s.addFile({ id: "demo-file-duval", name: "Notes Plomberie Duval (demo)", mimeType: "application/vnd.google-apps.document", parents: ["demo-folder-clients"] });
  // Content Studio (D081): media picked "en mode shell" from Drive. Thumbnails are inline SVGs (no network in DEMO).
  const thumb = (w: number, h: number, fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="50%" fill="#fbfaf7" font-family="sans-serif" font-size="${Math.round(w / 8)}" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`)}`;
  s.addFile({ id: "demo-folder-content", name: "Contenu", mimeType: "application/vnd.google-apps.folder", parents: [DEMO_IDS.folder] });
  s.addFile({ id: "demo-folder-reels", name: "Reels", mimeType: "application/vnd.google-apps.folder", parents: ["demo-folder-content"] });
  s.addFile({ id: "demo-folder-visuals", name: "Visuels", mimeType: "application/vnd.google-apps.folder", parents: ["demo-folder-content"] });
  s.addFile({ id: "demo-media-reel-fr", name: "Reel rapport IA FR (demo).mp4", mimeType: "video/mp4", parents: ["demo-folder-reels"], thumbnailLink: thumb(90, 160, "#7A4FD6", "FR"), videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "42000" } });
  s.addFile({ id: "demo-media-reel-es", name: "Reel informe IA ES (demo).mp4", mimeType: "video/mp4", parents: ["demo-folder-reels"], thumbnailLink: thumb(90, 160, "#2F5FBF", "ES"), videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "118000" } });
  s.addFile({ id: "demo-media-audit", name: "Audit terrain brut (demo).mov", mimeType: "video/quicktime", parents: ["demo-folder-reels"] });
  s.addFile({ id: "demo-media-slide-1", name: "Carrousel 3 erreurs 1 (demo).png", mimeType: "image/png", parents: ["demo-folder-visuals"], thumbnailLink: thumb(108, 135, "#17161A", "1"), imageMediaMetadata: { width: 1080, height: 1350 } });
  s.addFile({ id: "demo-media-slide-2", name: "Carrousel 3 erreurs 2 (demo).png", mimeType: "image/png", parents: ["demo-folder-visuals"], thumbnailLink: thumb(108, 135, "#17161A", "2"), imageMediaMetadata: { width: 1080, height: 1350 } });
  s.addFile({ id: "demo-media-banner", name: "Bannière LinkedIn Valemont (demo).jpg", mimeType: "image/jpeg", parents: ["demo-folder-visuals"], thumbnailLink: thumb(191, 100, "#2F5FBF", "Valemont"), imageMediaMetadata: { width: 1920, height: 1005 } });
  return s;
}
