chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'DOWNLOAD_PDF') return

  const { dataUrl, filename } = message

  chrome.downloads.download({ url: dataUrl, filename: filename ?? 'swe.pdf' }, (downloadId) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message })
    } else {
      sendResponse({ ok: true, downloadId })
    }
  })

  return true
})
