import type { ReactNode } from "react";
import type { AdminSection } from "./admin-sections";

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;

export const adminIcons: Record<AdminSection, ReactNode> = {
  dashboard: icon(<><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="4" rx="1.5" /><rect x="13" y="10" width="7" height="10" rx="2" /><rect x="4" y="13" width="7" height="7" rx="1.5" /></>),
  tasks: icon(<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4.5V3h6v1.5" /><path d="m8.5 11 1.6 1.6 3-3" /><path d="M8.5 16.5h7" /></>),
  programs: icon(<><path d="M5 6h3M5 12h3M5 18h3" /><path d="M11 6h8M11 12h8M11 18h8" /><circle cx="6.5" cy="6" r=".5" /></>),
  review: icon(<><path d="M4 12.5 9 17.5 20 6.5" /></>),
  feedback: icon(<><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /><path d="M8 10h8M8 13h5" /></>),
  history: icon(<><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4.5V8h3.5" /><path d="M12 8v4.5l3 2" /></>),
  requests: icon(<><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0" /><path d="M18.5 8v6M15.5 11h6" /></>),
  announcements: icon(<><path d="M4 10v4a1 1 0 0 0 1 1h2l7 4.5v-15L7 9H5a1 1 0 0 0-1 1Z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></>),
  stars: icon(<><path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7 1-5.5-4.1-4 5.6-.8L12 3.8Z" /></>),
  network: icon(<><circle cx="12" cy="6" r="2.5" /><circle cx="5.5" cy="17.5" r="2.5" /><circle cx="18.5" cy="17.5" r="2.5" /><path d="M12 8.5v3M12 11.5l-5 4M12 11.5l5 4" /></>),
  "welcome-video": icon(<><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="m10.5 9.5 4 2.5-4 2.5v-5Z" /></>),
};

export const profileIcon = icon(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>);
export const homeIcon = icon(<><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9v10h4.5v-5h3v5H18V9" /></>);
export const logoutIcon = icon(<><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h9" /></>);

const small = (path: ReactNode) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
export const actionIcons = {
  edit: small(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>),
  hide: small(<><path d="M3 3l18 18" /><path d="M10.6 6.2A10 10 0 0 1 12 6c5 0 8.5 4.5 9 6-.3.8-1.2 2.3-2.7 3.6M6.3 7.7C4.6 9 3.4 10.9 3 12c.5 1.5 4 6 9 6 1.4 0 2.6-.3 3.7-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  show: small(<><path d="M3 12c.5-1.5 4-6 9-6s8.5 4.5 9 6c-.5 1.5-4 6-9 6s-8.5-4.5-9-6Z" /><circle cx="12" cy="12" r="3" /></>),
  remove: small(<><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 12.5h9L17.5 7" /><path d="M10 11v5M14 11v5" /></>),
};
