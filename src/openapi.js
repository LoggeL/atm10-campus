// Hand-written OpenAPI description for agents. Keep in sync with server.js routes.
export function openapi(baseUrl) {
  const json = schema => ({ content: { 'application/json': { schema } } });
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Bauplan-ID = Dateiname ohne .nbt, z. B. 01_Technikhof_P01' };
  const ok = { 200: { description: 'OK' } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'ATM10 Campus API', version: '1',
      description: [
        'Baupläne (Create/Vanilla-Structure-NBT) mit Versionen, Live-Bestand aus der ATM10-Welt und Konfliktanalyse.',
        'Auth: `Authorization: Bearer atc_…` (Token unter /app → Agent-Zugang). Lese-Tokens dürfen nur GET.',
        'Workflow für Agents: 1) GET /api/status lesen, 2) Bauplan herunterladen, 3) mit `baseVersion` hochladen. Antwort 409 = jemand anderes war schneller → neu laden, zusammenführen, erneut hochladen.',
        'Koordinaten sind Weltkoordinaten; `origin` ist die Ecke mit den kleinsten x/y/z des Bauplans. `minecraft:air` im NBT = abreißen, `minecraft:structure_void` = Bestand nicht anfassen.',
      ].join('\n\n'),
    },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths: {
      '/api/me': { get: { summary: 'Wer bin ich (User, Token-Scope)', responses: ok } },
      '/api/status': { get: { summary: 'Gesamtstatus: Live-Snapshot, Edition, Fortschritt und Konflikte je Bauplan, Überlappungen', responses: ok } },
      '/api/blueprints': {
        get: { summary: 'Alle aktuellen Baupläne', parameters: [{ name: 'archived', in: 'query', schema: { type: 'string', enum: ['1'] } }], responses: ok },
        post: {
          summary: 'Bauplan anlegen oder neue Version (JSON mit Base64-NBT)',
          requestBody: json({ type: 'object', required: ['fileName', 'nbtBase64'], properties: {
            fileName: { type: 'string', example: '40_Neues_Gebaeude.nbt' }, nbtBase64: { type: 'string' },
            origin: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3, description: 'Pflicht bei neuem Bauplan' },
            name: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, note: { type: 'string', description: 'Änderungsnotiz' },
            baseVersion: { type: 'integer', description: 'Version, auf der die Änderung basiert (Optimistic Locking)' } } }),
          responses: { 200: { description: 'Gespeichert (unchanged=true wenn identisch)' }, 409: { description: 'Bearbeitungskonflikt' }, 422: { description: 'NBT ungültig' } },
        },
      },
      '/api/blueprints.zip': { get: { summary: 'Alle aktuellen NBTs + manifest.json als ZIP', responses: ok } },
      '/api/blueprints/{id}': {
        get: { summary: 'Bauplan mit Versionen und Analyse gegen Live', parameters: [id], responses: ok },
        patch: { summary: 'Metadaten ändern; mit origin entsteht eine neue Version', parameters: [id],
          requestBody: json({ type: 'object', properties: { name: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, origin: { type: 'array', items: { type: 'integer' } }, baseVersion: { type: 'integer' }, note: { type: 'string' } } }), responses: ok },
        delete: { summary: 'Bauplan archivieren (Versionen bleiben erhalten)', parameters: [id], responses: ok },
      },
      '/api/blueprints/{id}/nbt': {
        put: { summary: 'Neue Version als rohe NBT-Datei hochladen', parameters: [id,
          { name: 'baseVersion', in: 'query', schema: { type: 'integer' } }, { name: 'origin', in: 'query', schema: { type: 'string', example: '24,63,14' } },
          { name: 'note', in: 'query', schema: { type: 'string' } }, { name: 'fileName', in: 'query', schema: { type: 'string' } }, { name: 'name', in: 'query', schema: { type: 'string' } }],
        requestBody: { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        responses: { 200: { description: 'Gespeichert' }, 409: { description: 'Bearbeitungskonflikt' } } },
      },
      '/api/blueprints/{id}/download': { get: { summary: 'NBT herunterladen', parameters: [id, { name: 'version', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/blueprints/{id}/versions/{version}/analysis': { get: { summary: 'Detailanalyse mit Beispielkoordinaten', parameters: [id, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'snapshot', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/blueprints/{id}/revert': { post: { summary: 'Alte Version als neue Version wiederherstellen', parameters: [id], requestBody: json({ type: 'object', required: ['version'], properties: { version: { type: 'integer' } } }), responses: ok } },
      '/api/snapshots': {
        get: { summary: 'Snapshots der Welt (Live und Baselines)', responses: ok },
        post: { summary: 'Snapshot jetzt erzeugen (Schreib-Token)', requestBody: json({ type: 'object', properties: { source: { type: 'string', default: 'live' }, label: { type: 'string' }, force: { type: 'boolean' } } }), responses: ok },
      },
      '/api/snapshots/{id}/context.json': { get: { summary: 'Metadaten des Bestands (Palette, Format)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok } },
      '/api/snapshots/{id}/surfaces.bin.gz': { get: { summary: 'Sichtbare Bestandsflächen, uint16 LE: x,y,z,palette,faceMask', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: ok } },
      '/api/activity': { get: { summary: 'Änderungsprotokoll', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: ok } },
    },
  };
}
