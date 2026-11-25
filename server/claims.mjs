// Multi-staff claim lock. Several G2 wearers (or sessions) can read the same
// bot inbox; the first one to tap reply on a conversation claims it. Everyone
// else sees "Being answered by <name>" and cannot send until the claim ends.
// A claim ends when its holder sends, backs out, or after `ttlMs` (default 2 min)
// without activity. In memory only, like the inbox.

export const CLAIM_TTL_MS = 2 * 60_000;

/**
 * @typedef {{ id: string, name: string }} Staff
 * @typedef {{ chatId: string, staffId: string, by: string, at: number, until: number }} Claim
 */

/** @param {{ ttlMs?: number, now?: () => number }} [opts] */
export function createClaims({ ttlMs = CLAIM_TTL_MS, now = Date.now } = {}) {
  /** @type {Map<string, Claim>} */
  const claims = new Map();

  /** @param {string} chatId */
  const active = chatId => {
    const c = claims.get(chatId);
    if (c && c.until <= now()) {
      claims.delete(chatId);
      return null;
    }
    return c || null;
  };

  return {
    ttlMs,
    /** Current claim on a conversation, or null. @param {string} chatId */
    get: active,

    /** Claim held by someone other than `staff`, or null. @param {string} chatId @param {Staff} staff */
    heldByOther(chatId, staff) {
      const c = active(chatId);
      return c && c.staffId !== staff.id ? c : null;
    },

    /**
     * Take or renew the claim. Fails (ok: false) while another staff member holds it.
     * @param {string} chatId @param {Staff} staff @param {number} [ms]
     * @returns {{ ok: true, claim: Claim } | { ok: false, claim: Claim }}
     */
    claim(chatId, staff, ms = ttlMs) {
      const c = active(chatId);
      if (c && c.staffId !== staff.id) return { ok: false, claim: c };
      const t = now();
      const claim = { chatId, staffId: staff.id, by: staff.name, at: c ? c.at : t, until: t + ms };
      claims.set(chatId, claim);
      return { ok: true, claim };
    },

    /** Release a claim; only the holder can. @param {string} chatId @param {Staff} staff */
    release(chatId, staff) {
      const c = active(chatId);
      if (!c || c.staffId !== staff.id) return false;
      claims.delete(chatId);
      return true;
    },

    /** All live claims (for the companion page / debugging). */
    list() {
      return [...claims.keys()].map(active).filter(Boolean);
    },

    clear() {
      claims.clear();
    },
  };
}

/**
 * What the glasses see about someone else's claim.
 * @param {Claim | null} c @param {number} [t]
 */
export const publicClaim = (c, t = Date.now()) => (c ? { by: c.by, leftS: Math.max(0, Math.ceil((c.until - t) / 1000)) } : null);
