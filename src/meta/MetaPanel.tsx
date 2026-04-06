import type { PlanModel } from "../model";
import { TaskList } from "./TaskList";

type Props = {
  model: PlanModel;
  onChange: (next: PlanModel) => void;
};

export function MetaPanel({ model, onChange }: Props) {
  const update = (key: keyof PlanModel, value: string) => {
    onChange({ ...model, [key]: value });
  };

  return (
    <aside className="meta-panel">
      <MetaSection label="Context">
        <textarea
          value={model.context}
          onChange={e => update("context", e.target.value)}
          placeholder="Apa yang sedang dibangun, kenapa…"
          spellCheck={false}
        />
      </MetaSection>

      <MetaSection label="Scope">
        <textarea
          value={model.scope}
          onChange={e => update("scope", e.target.value)}
          placeholder="File mana yang boleh disentuh, mana yang tidak…"
          spellCheck={false}
        />
      </MetaSection>

      <MetaSection label="Task">
        <TaskList
          initial={model.task}
          onChange={v => update("task", v)}
        />
      </MetaSection>

      <MetaSection label="Notes">
        <textarea
          value={model.notes}
          onChange={e => update("notes", e.target.value)}
          placeholder="Constraint, keputusan arsitektur, hal yang jangan diubah…"
          spellCheck={false}
        />
      </MetaSection>
    </aside>
  );
}

function MetaSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="meta-section">
      <div className="meta-label">{label}</div>
      {children}
    </section>
  );
}
