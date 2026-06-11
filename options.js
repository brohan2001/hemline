const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'linkedin', 'github', 'skills']

chrome.storage.local.get('profile', ({ profile }) => {
  FIELDS.forEach(f => { document.getElementById(f).value = profile?.[f] ?? '' })
})

document.getElementById('save').addEventListener('click', () => {
  const entries = FIELDS
    .map(f => [f, document.getElementById(f).value.trim()])
    .filter(([, v]) => v)
  chrome.storage.local.set({ profile: Object.fromEntries(entries) }, () => {
    document.getElementById('status').textContent = 'Saved ✓'
    setTimeout(() => { document.getElementById('status').textContent = '' }, 2000)
  })
})
