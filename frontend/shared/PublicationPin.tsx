import styles from "./PublicationPin.module.css";

function PinIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5 1 3-3-1-5 3 1-4-5-5 4 1 5-3 1-4Z" /><path d="m8 16-5 5" /></svg>;
}

export function PinBadge() {
  return <span className={styles.badge}><PinIcon />Закреплено</span>;
}

export function PinButton({ pinned, title, disabled, onClick }: { pinned?: boolean; title: string; disabled?: boolean; onClick: () => void }) {
  const label = pinned ? "Открепить" : "Закрепить";
  return <button type="button" className={styles.button} aria-label={label + ": " + title} aria-pressed={Boolean(pinned)} disabled={disabled} onClick={onClick}><PinIcon />{label}</button>;
}
