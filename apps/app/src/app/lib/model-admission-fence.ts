/**
 * A local account switch must not race another NanamiWork message admission.
 * Ordinary admissions may run together; a router switch is exclusive and
 * fails fast when another admission is already in progress.
 */
export class ModelAdmissionFence {
  private readers = 0;
  private exclusive = false;
  private released: Promise<void> = Promise.resolve();

  async regular<T>(work: () => Promise<T>, assertCurrent?: () => void): Promise<T> {
    while (this.exclusive) {
      await this.released;
      assertCurrent?.();
    }
    assertCurrent?.();
    this.readers += 1;
    try {
      return await work();
    } finally {
      this.readers -= 1;
    }
  }

  async routed<T>(work: () => Promise<T>, assertCurrent?: () => void): Promise<T> {
    assertCurrent?.();
    if (this.exclusive || this.readers > 0) {
      throw new Error("Another message is starting. Wait for it to finish starting, then retry Local Router.");
    }
    this.exclusive = true;
    let release: () => void = () => {};
    this.released = new Promise<void>((resolve) => { release = resolve; });
    try {
      return await work();
    } finally {
      this.exclusive = false;
      release();
    }
  }
}

export const modelAdmissionFence = new ModelAdmissionFence();
