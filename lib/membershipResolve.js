// Normalisasi role/outlet dari business_members — cegah kasir outlet tampil sebagai owner.

import { ROLE_LABEL } from "./rbac.js";

export const KASIR_OUTLETS = ["KBU", "KSM", "SMT"];

const EMAIL_ROLE_MAP = {
  "kopiburiumah@gmail.com": { role: "kasir", outlet: "KBU" },
  "ramenkisamen@gmail.com": { role: "kasir", outlet: "KSM" },
  "samtarospace@gmail.com": { role: "kasir", outlet: "SMT" },
  "nf3.crb@gmail.com": { role: "purchasing", outlet: null },
  "abdulkhafid0910@gmail.com": { role: "purchasing", outlet: "Jagasatru" },
  "duriplant@gmail.com": { role: "admin", outlet: null },
  "durinah55@gmail.com": { role: "admin", outlet: null },
};

/** Role efektif untuk permission & tampilan dashboard. */
export function resolveAuthMembership({ role, outlet, email } = {}) {
  const normalizedOutlet = outlet && KASIR_OUTLETS.includes(outlet) ? outlet : null;

  if (normalizedOutlet) {
    return { role: "kasir", outlet: normalizedOutlet };
  }

  const em = (email || "").trim().toLowerCase();
  const mapped = EMAIL_ROLE_MAP[em];
  if (mapped) {
    return { role: mapped.role, outlet: mapped.outlet ?? null };
  }

  return {
    role: role || "kasir",
    outlet: outlet ?? null,
  };
}

export function roleDisplayLabel(user) {
  const role = user?.role || "kasir";
  if (role === "kasir" && user?.outlet) {
    return `Kasir · ${user.outlet}`;
  }
  if (role === "kasir") return ROLE_LABEL.kasir;
  return ROLE_LABEL[role] || role;
}
