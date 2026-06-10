function dataURItoBlob(dataURI) {
  const byteString = atob(dataURI.split(',')[1])
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new Blob([ab], { type: mimeString })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'DOWNLOAD_PDF') return

  const { dataUrl, filename } = message

  // Firefox MV3 denies downloads of raw data: URIs, so we bridge through a
  // local blob: URL. Chrome MV3 service workers lack URL.createObjectURL but
  // accept data: URIs directly, so fall back there.
  let url = dataUrl
  let blobUrl = null
  if (typeof URL.createObjectURL === 'function') {
    blobUrl = URL.createObjectURL(dataURItoBlob(dataUrl))
    url = blobUrl
  }

  chrome.downloads.download({ url, filename: filename ?? 'swe.pdf' }, (downloadId) => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message })
    } else {
      sendResponse({ ok: true, downloadId })
    }
  })

  return true
})
