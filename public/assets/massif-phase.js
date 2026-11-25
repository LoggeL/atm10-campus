const button = document.getElementById('phaseButton');
const result = document.getElementById('phaseResult');
if (button) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const response = await fetch('/api/projects/erebor/stone/massif/bauphase', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-campus-csrf': '1' },
        body: JSON.stringify({ baseVersion: Number(button.dataset.version), stoneOnly: button.dataset.stone === 'true' }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Bauphase konnte nicht gewechselt werden.');
      button.dataset.stone = String(!data.stoneOnly);
      button.textContent = data.stoneOnly ? 'Zur regulären Baufolge wechseln' : 'Nur Cleanstone bauen';
      if (result) {
        result.textContent = data.stoneOnly
          ? 'Neue Automatikaufträge verwenden nur Stein.'
          : 'Für neue Aufträge gilt wieder die reguläre Baufolge.';
      }
    } catch (error) {
      if (result) result.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
