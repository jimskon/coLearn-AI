// Content-free activity signals for the research timeline. Code blocks call
// signalActivity('run') when a run starts; Local Sandbox edits call
// signalActivity('sandbox'). The run page (useRunActivitySync) forwards them
// to the server with throttling. With no run page listening, nothing happens.
export function signalActivity(kind) {
  try {
    window.dispatchEvent(new CustomEvent('colearn:activity', { detail: { kind } }));
  } catch {
    // no window (tests) or CustomEvent unsupported: nothing to record
  }
}
