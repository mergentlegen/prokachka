"use client";

import type { Submission } from "@/shared/domain/types";
import { FREE_MEMBERSHIP_PEOPLE, FREE_MEMBERSHIP_TRAINER } from "@/shared/domain/free-membership";
import { CabinetTrainer, cabinetHome, type CabinetView } from "./CabinetTrainer";
import styles from "./CabinetTrainer.module.css";

// «Безоплатное членство»: seven missions in a copy of the cabinet (the main page and the list of people who paid),
// then a check of five questions. The engine is CabinetTrainer.tsx.
export function freeMembershipCabinet(view: CabinetView) {
  if (view.view === "home") return cabinetHome(view, FREE_MEMBERSHIP_PEOPLE, true);
  return <div>
    <div className={styles.lhead}>Члены (Личные) <span className={styles.close} aria-hidden="true">×</span></div>
    <div className={`${styles.scroller} ${view.spot("scroll")}`} ref={view.table.ref} onScroll={view.table.onScroll} onMouseDown={view.table.onMouseDown}>
      <table className={styles.tbl}>
        <thead><tr><th style={{ width: 230 }}>Имя</th><th style={{ width: 150 }}>Тип членства</th><th style={{ width: 140 }}>Статус</th><th>Сумма</th></tr></thead>
        <tbody>{FREE_MEMBERSHIP_PEOPLE.map((person) => <tr key={person.key}>
          <td><div className={styles.who}><div className={styles.ini} style={{ background: person.color }}>{person.initials}</div>{person.name}</div></td>
          <td className={`${styles.cell} ${view.spot(`type${person.key}`)}`} data-hot={`type${person.key}`}>{person.plan}</td>
          <td>Активный</td>
          <td className={`${styles.cell} ${view.spot(`sum${person.key}`)}`} data-hot={`sum${person.key}`}>{person.sum}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className={styles.swipe}>таблица шире экрана →</div>
  </div>;
}

export function FreeMembershipGame({ taskId, onCompleted }: { taskId: string; onCompleted?: (submission: Submission) => void }) {
  return <CabinetTrainer taskId={taskId} trainer={FREE_MEMBERSHIP_TRAINER} render={freeMembershipCabinet} onCompleted={onCompleted} />;
}
