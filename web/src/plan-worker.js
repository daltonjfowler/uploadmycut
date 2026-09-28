// Runs the planners (planJob: the class bit, and the V-bit when there is V-carving) off the main thread, so a big drawing never freezes the page while it is checked.
import { planJob } from '../../shared/cam.js';

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    self.postMessage({ id, ok: true, plan: planJob(args) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
