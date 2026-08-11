// ─── Paid Generation Guard ────────────────────────────────────────────────────
//
// Prevents accidental paid Veo / Omni video generation.
// Must call flow_confirm_paid_generation before any paid action.
// Authorization is single-use (consumed after one paid action) and expires after 5 min.

export interface GuardState {
  confirmed: boolean;
  maxBudgetCredits?: number;
  reason?: string;
  confirmedAt?: string;
  expiresAt?: string;
}

class PaidGuard {
  private state: GuardState = { confirmed: false };

  confirm(opts: { maxBudgetCredits: number; reason?: string; ttlSeconds?: number }): GuardState {
    if (!opts.maxBudgetCredits || opts.maxBudgetCredits <= 0)
      throw new Error('maxBudgetCredits must be > 0 to authorize paid generation');

    const now = Date.now();
    const ttl = (opts.ttlSeconds ?? 300) * 1000;
    this.state = {
      confirmed: true,
      maxBudgetCredits: opts.maxBudgetCredits,
      reason: opts.reason ?? 'Agent authorized paid generation',
      confirmedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
    };
    return { ...this.state };
  }

  revoke(): void {
    this.state = { confirmed: false };
  }

  isActive(): boolean {
    if (!this.state.confirmed) return false;
    if (this.state.expiresAt && Date.now() > new Date(this.state.expiresAt).getTime()) {
      this.revoke();
      return false;
    }
    return true;
  }

  /** Verify authorization exists, consume it (single-use), and return the consumed state. */
  consume(actionLabel: string, estimatedCredits = 10): GuardState {
    if (!this.isActive())
      throw new Error(
        `Paid generation blocked for "${actionLabel}". ` +
        'Call flow_confirm_paid_generation with confirm:true and maxBudgetCredits first.'
      );

    if (
      this.state.maxBudgetCredits !== undefined &&
      estimatedCredits > this.state.maxBudgetCredits
    ) {
      throw new Error(
        `Action "${actionLabel}" estimated cost (${estimatedCredits} credits) ` +
        `exceeds confirmed budget limit (${this.state.maxBudgetCredits} credits).`
      );
    }

    const consumed = { ...this.state };
    this.revoke(); // single-use
    return consumed;
  }

  getState(): GuardState {
    return { ...this.state };
  }
}

export const paidGuard = new PaidGuard();
