// Runs planCut off the main thread, so a big drawing never freezes the page while it is checked.
import { planCut } from '../../shared/cam.js';

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    self.postMessage({ id, ok: true, plan: planCut(args) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
