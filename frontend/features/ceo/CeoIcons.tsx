import type { ReactNode } from "react";

const icon = (path: ReactNode) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;

export const ceoIcons = {
  overview: icon(<><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="4" rx="1.5" /><rect x="13" y="10" width="7" height="10" rx="2" /><rect x="4" y="13" width="7" height="7" rx="1.5" /></>),
  teams: icon(<><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M14.5 14.5A4.5 4.5 0 0 1 21 18.5" /></>),
  requests: icon(<><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20a6.5 6.5 0 0 1 13 0" /><path d="M18.5 8v6M15.5 11h6" /></>),
  users: icon(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>),
  journal: icon(<><path d="M6 4h10l3 3v13H6z" /><path d="M9 10h7M9 14h7M9 18h4" /></>),
  mentor: icon(<><path d="m12 3.8 2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5 2.7 1-5.5-4.1-4 5.6-.8L12 3.8Z" /></>),
  works: icon(<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="m8.5 11 1.6 1.6 3-3" /><path d="M8.5 16.5h7" /></>),
  clock: icon(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 2" /></>),
  quiet: icon(<><path d="M4 12h4l2-5 4 10 2-5h4" /></>),
  logout: icon(<><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h9" /></>),
};
