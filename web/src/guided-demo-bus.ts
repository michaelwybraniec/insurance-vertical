/** Tiny window bus so GuidedDemo can drive ImpulseRail + ArchitectureMap. */

export const DEMO_EVENT = 'mutuellefit-demo';

/** Inspect intent held by ImpulseRail so ArchitectureMap can apply it on mount. */
export type DemoArchInspect =
  | { kind: 'edge'; id: string; at: number }
  | { kind: 'node'; id: string; at: number };

export type DemoCommand =
  | { type: 'rail-tab'; tab: 'evidence' | 'dev' | 'architecture' }
  | { type: 'open-log-match'; match: string }
  | { type: 'arch-play'; rate?: number }
  | { type: 'arch-zoom'; factor?: number }
  | { type: 'arch-inspect-edge'; edgeId: string }
  | { type: 'arch-inspect-node'; nodeId: string }
  | { type: 'arch-replay-log'; nodeId?: string }
  | { type: 'arch-idle' };

export function demoDispatch(command: DemoCommand): void {
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: command }));
}

export function demoListen(handler: (command: DemoCommand) => void): () => void {
  const onEvent = (event: Event) => {
    handler((event as CustomEvent<DemoCommand>).detail);
  };
  window.addEventListener(DEMO_EVENT, onEvent);
  return () => window.removeEventListener(DEMO_EVENT, onEvent);
}

export function waitForDemo(type: DemoCommand['type'], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      stop();
      reject(new Error(`Guided demo timed out waiting for ${type}`));
    }, timeoutMs);
    const stop = demoListen((command) => {
      if (command.type !== type) return;
      window.clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
