// chrome.* stub for booting content_script.js in JSDOM. runtime.connect returns a
// fake 'jseek' port that answers background ops from `responses` (defaults make
// the extension look fully configured so buttons stay enabled).
export function chromeMock(storageData = {}, responses = {}) {
  const answers = {
    STATUS: { backend: 'extension', hasKey: true, hasResume: true },
    CHECK_DUPLICATE: { duplicate: false },
    GET_PDF: null,
    ...responses,
  }
  const sent = []
  return {
    sent,
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: () => {},
      onMessage: { addListener: () => {} },
      connect: () => {
        const listeners = []
        return {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          onDisconnect: { addListener: () => {} },
          postMessage: (msg) => {
            if (!msg.op) return
            sent.push(msg)
            const answer = answers[msg.op]
            setTimeout(() => {
              const reply = answer instanceof Error
                ? { id: msg.id, ok: false, error: answer.message }
                : { id: msg.id, ok: true, result: typeof answer === 'function' ? answer(msg.payload) : answer }
              listeners.forEach(fn => fn(reply))
            }, 0)
          },
        }
      },
    },
    storage: {
      local: {
        get: (_key, cb) => cb(storageData),
        set: () => {},
      },
    },
  }
}
