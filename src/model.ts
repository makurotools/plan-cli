/**
 * Model internal untuk plan-cli.
 *
 * Fase 1: setiap section adalah string biasa. Diagram disimpan sebagai
 * teks ASCII, Task sebagai teks markdown checklist. Fase 2 akan memecah
 * `diagram` menjadi struktur nodes/edges dan `task` menjadi array item
 * terstruktur — saat itu model inilah yang jadi source of truth dan
 * markdown hanya render view.
 */
export type PlanModel = {
  diagram: string;
  context: string;
  scope: string;
  task: string;
  notes: string;
};

export const EMPTY_MODEL: PlanModel = {
  diagram: "",
  context: "",
  scope: "",
  task: "",
  notes: "",
};

export const DEFAULT_MODEL: PlanModel = {
  diagram: "",
  context: "",
  scope: "",
  task: "",
  notes: "",
};
