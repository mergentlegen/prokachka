"use client";

import type { Submission } from "@/shared/domain/types";
import { FREE_MEMBERSHIP_PEOPLE } from "@/shared/domain/free-membership";
import { MARKETING_DIRECTOR_BONUSES, MARKETING_DIRECTOR_BRANCHES, MARKETING_DIRECTOR_MENU, MARKETING_DIRECTOR_TRAINER } from "@/shared/domain/marketing-director";
import { CabinetTrainer, cabinetHeader, cabinetHome, type CabinetView } from "./CabinetTrainer";
import styles from "./CabinetTrainer.module.css";

// «Путь к Маркетинг директору»: six missions in a copy of the cabinet — the main page, the menu ☰, «Компенсация»
// and «Командный лидерский бонус» — then a check of four questions. The engine is CabinetTrainer.tsx.
const BADGES = ["#84CC16", "#3B82F6", "#F59E0B", "#E11D48", "#8B5CF6", "#374151", "#EAB308"];

function menu(view: CabinetView) {
  const pay = view.menu === "pay";
  // An empty spot of the menu is not a mistake (data-no-miss); it covers the cabinet, not the task bar.
  return <div className={styles.drawer} data-no-miss="">
    <div className={styles.panel}>
      <div className={styles.mtop} aria-hidden="true"><div className={styles.logo}>in</div><span>?</span><span>🎥</span><span>🔔</span><span>✕</span></div>
      {MARKETING_DIRECTOR_MENU.map(([icon, label, chevron]) => <div key={label} className={styles.mi} data-hot="mOther">
        <span className={styles.mIcon} aria-hidden="true">{icon}</span>{label}{chevron && <span className={styles.chev} aria-hidden="true">⌄</span>}
      </div>)}
      <div className={`${styles.mi} ${pay ? styles.miOpen : ""} ${view.spot("mPay")}`} data-hot="mPay">
        <span className={styles.mIcon} aria-hidden="true">💳</span>Платежи<span className={styles.chev} aria-hidden="true">{pay ? "⌃" : "⌄"}</span>
      </div>
      {pay && <div>
        <div className={`${styles.si} ${view.spot("mComp")}`} data-hot="mComp">Компенсация</div>
        <div className={styles.si} data-hot="mWallet">Кошелек</div>
      </div>}
    </div>
  </div>;
}

function compensation(view: CabinetView) {
  return <div>
    {cabinetHeader(view, "Компенсация")}
    <div className={styles.ptitle}>Компенсация</div>
    <div className={styles.psub}>Твои бонусы и доходы</div>
    {MARKETING_DIRECTOR_BONUSES.map(([icon, title, small, leader]) => <div key={title} className={`${styles.bcard} ${leader ? view.spot("compTLB") : ""}`} data-hot={leader ? "compTLB" : "compOther"}>
      <div className={styles.bi} aria-hidden="true">{icon}</div>
      <div><b>{title}</b><small>{small}</small></div>
      <div className={styles.go} aria-hidden="true">›</div>
    </div>)}
  </div>;
}

function bonus(view: CabinetView) {
  const info = <span className={`${styles.info} ${styles.grey}`} aria-hidden="true">i</span>;
  return <div>
    {cabinetHeader(view, "Командный лидерский бонус")}
    <div className={styles.crumb}><span className={styles.crumbA}>Компенса…</span><span className={styles.crumbA}>/</span><span className={styles.crumbB}>Командный лидерский… ⌄</span><span className={styles.qbtn} aria-hidden="true">?</span></div>
    <div className={styles.pill}><span aria-hidden="true">‹</span><b>Детали бонуса</b><span aria-hidden="true">›</span></div>
    <div className={styles.sect}><b>Командный лидерский бонус</b>
      <div className={`${styles.month} ${view.spot("month")}`} data-hot="month"><span aria-hidden="true">‹</span><b>Nov</b><span aria-hidden="true">›</span></div>
    </div>
    <div className={`${styles.card} ${view.spot("actTop")}`} data-hot="actTop"><div className={styles.lbl}>Общий активационный объём {info}</div><div className={styles.big}>$300.00</div></div>
    <div className={`${styles.card} ${view.spot("qualProd")}`} data-hot="qualProd"><div className={styles.lbl}>Квалифицированная продуктивность {info}</div><div className={styles.big}>$1,200.00</div></div>
    <div className={`${styles.card} ${view.spot("totalProd")}`} data-hot="totalProd"><div className={styles.lbl}>Общий объём производства {info}</div><div className={styles.big}>$1,200.00</div></div>
    <div className={styles.card}>
      <div className={styles.badges} aria-hidden="true">{BADGES.map((color, index) => <div key={color} className={`${styles.badge} ${index === 0 ? styles.badgeCur : ""}`}><i style={{ background: color }} /></div>)}</div>
      <div className={styles.more}>Показать подробности</div>
    </div>
    <div className={`${styles.card} ${view.spot("mdBlock")}`} data-hot="mdBlock">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className={styles.badge} style={{ width: 36, height: 36 }} aria-hidden="true"><i style={{ background: "#84CC16", width: 20, height: 20 }} /></div>
        <div className={styles.big} style={{ margin: 0 }}>$0.00</div>{info}
      </div>
      <div className={styles.lbl} style={{ margin: "4px 0 0 46px" }}>Маркетинг директор бонус</div>
      <div className={styles.chip}>📅 Выплата ожидается December 10</div>
      <div className={`${styles.sub2} ${view.spot("mdActivation")}`} data-hot="mdActivation">
        <div className={styles.v}>$300 / $600</div>
        <div className={styles.d}>Требуемый активационный объём {info}</div>
        <div className={styles.bar}><i style={{ width: "50%" }} /></div>
      </div>
      <div className={`${styles.sub2} ${view.spot("mdTurnover")}`} data-hot="mdTurnover">
        <div className={styles.v}>$1,200 / $3,000</div>
        <div className={styles.d}>Требования к квалифицированному товарообороту {info}</div>
        <div className={styles.bar}><i style={{ width: "40%" }} /></div>
        <div className={`${styles.chip} ${view.spot("branchMax")}`} data-hot="branchMax">✓ Максимум на одну ветку: $1,200</div>
      </div>
    </div>
    <div className={`${styles.card} ${view.spot("breakdown")}`} data-hot="breakdown">
      <div className={styles.ctitle}>Разбивка по товарообороту <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>⇅ Наибольший общий</span></div>
      <div style={{ fontSize: 13, color: "var(--muted)", margin: "10px 0 2px" }}>Товарооборот ваших команд</div>
      {MARKETING_DIRECTOR_BRANCHES.map((branch) => <div key={branch.initials} className={styles.prow}>
        <div className={styles.ini} style={{ background: branch.color }}>{branch.initials}</div>
        <div className={styles.nm}>{branch.name}<small>{branch.role}</small></div>
        <div className={styles.sum}>{branch.sum}</div>
      </div>)}
    </div>
  </div>;
}

export function marketingDirectorCabinet(view: CabinetView) {
  return <>
    {view.view === "comp" ? compensation(view) : view.view === "bonus" ? bonus(view) : cabinetHome(view, FREE_MEMBERSHIP_PEOPLE, false)}
    {view.menu !== "closed" && menu(view)}
  </>;
}

export function MarketingDirectorGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  return <CabinetTrainer taskId={taskId} trainer={MARKETING_DIRECTOR_TRAINER} render={marketingDirectorCabinet} onCompleted={onCompleted} />;
}
