// Hand-written OpenAPI description for agents. Keep in sync with server.js routes.
export function openapi(baseUrl) {
  const json = schema => ({ content: { 'application/json': { schema } } });
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Bauplan-ID = Dateiname ohne .nbt, z. B. 01_Technikhof_P01' };
  const cannonName = { name: 'name', in: 'path', required: true, schema: { type: 'string' } };
  const ok = { 200: { description: 'OK' } };
  return {
    openapi: '3.1.0',
    info: {
      title: 'ATM10 Campus API', version: '1',
      description: [
        'Baupläne (Create/Vanilla-Structure-NBT) mit Versionen, Live-Bestand aus der ATM10-Welt und Konfliktanalyse.',
        'Auth: `Authorization: Bearer atc_…` (Token unter /app → Agent-Zugang). Lese-Tokens dürfen nur GET. Station-Tokens (für CC-Computer an den Schematicannons) dürfen lesen und ME-Bestand/Kanonen-Status melden.',
        'Workflow für Agents: 1) GET /api/status lesen, 2) Bauplan ansehen (GET …/layers als Text, …/blocks als JSON, /api/world/blocks für den echten Bestand), 3) Änderungen als Operationen an POST …/edits schicken – erst mit dryRun:true prüfen, dann mit baseVersion speichern. Alternativ ganze NBT mit baseVersion hochladen. Antwort 409 = jemand anderes war schneller → neu laden, zusammenführen, erneut senden.',
        'Koordinaten sind Weltkoordinaten; `origin` ist die Ecke mit den kleinsten x/y/z des Bauplans. `minecraft:air` im NBT = abreißen, `minecraft:structure_void` = Bestand nicht anfassen.',
      ].join('\n\n'),
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        EditOp: {
          type: 'object', required: ['op'],
          description: [
            'set {pos, block, properties?} · setMany {blocks:[{pos, block, properties?}]}',
            'fill {from, to, block, properties?, mode: all|hollow|outline|keep|replace, match? (Glob, z. B. "minecraft:*_planks")}',
            'replace {match, block, from?, to?, keepProperties?} · clear {from, to} → Luft = abreißen · void {from, to} → Bestand nicht anfassen',
            'copy {from, to, dest, includeVoid?}. Blöcke als "namespace:name", properties z. B. {"facing":"north"}.',
          ].join('\n'),
          properties: {
            op: { type: 'string', enum: ['set', 'setMany', 'fill', 'replace', 'clear', 'void', 'copy'] },
            pos: { type: 'array', items: { type: 'integer' } }, from: { type: 'array', items: { type: 'integer' } }, to: { type: 'array', items: { type: 'integer' } }, dest: { type: 'array', items: { type: 'integer' } },
            block: { type: 'string', example: 'minecraft:stone_bricks' }, properties: { type: 'object', additionalProperties: { type: 'string' } },
            mode: { type: 'string' }, match: { type: 'string' }, keepProperties: { type: 'boolean' }, includeVoid: { type: 'boolean' },
            blocks: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      '/api/me': { get: { summary: 'Wer bin ich (User, Token-Scope)', responses: ok } },
      '/api/status': { get: { summary: 'Gesamtstatus: Live-Snapshot, Edition, Fortschritt und Konflikte je Bauplan, Überlappungen', responses: ok } },
      '/api/events': { get: { summary: 'Authentifizierter SSE-Statuskanal', description: 'sync bei jeder Verbindung: vollständigen aktuellen Stand per REST laden. change: topics (blueprints, snapshots, cannons, stock, activity), optional cannons mit betroffenen Stationsnamen; ohne Namen alle Kanonen aktualisieren. heartbeat alle 15 Sekunden. auth beendet eine abgelaufene oder widerrufene Sitzung. Keine Ereigniswiederholung: Reconnect lädt den aktuellen Stand.', responses: { 200: { description: 'Offener Event-Stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, 401: { description: 'Anmeldung erforderlich' }, 429: { description: 'Zu viele offene Verbindungen' } } } },
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
      '/api/blueprints/{id}/preview.png': { get: { summary: 'Isometrische PNG-Vorschau aus den Blöcken des Bauplans (640 × 400)', parameters: [id, { name: 'version', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Ohne Angabe aktuelle Version; mit Angabe genau diese Revision' }], responses: { 200: { description: 'PNG; private Cache mit ETag', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } }, 304: { description: 'Vorschau unverändert' }, 503: { description: 'Vorschau konnte gerade nicht erzeugt werden' } } } },
      '/api/blueprints/{id}/download': { get: { summary: 'NBT herunterladen', parameters: [id, { name: 'version', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/blueprints/{id}/versions/{version}/analysis': { get: { summary: 'Detailanalyse mit Beispielkoordinaten', parameters: [id, { name: 'version', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'snapshot', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/blueprints/{id}/revert': { post: { summary: 'Alte Version als neue Version wiederherstellen', parameters: [id], requestBody: json({ type: 'object', required: ['version'], properties: { version: { type: 'integer' } } }), responses: ok } },
      '/api/blueprints/{id}/edits': {
        post: {
          summary: 'Bauplan blockgenau ändern (Operationen statt NBT-Upload). dryRun=true zeigt nur die Vorschau mit Analyse.',
          parameters: [id],
          requestBody: json({ type: 'object', required: ['edits'], properties: {
            edits: { type: 'array', items: { $ref: '#/components/schemas/EditOp' }, description: 'Werden der Reihe nach angewendet, max. 10.000 Operationen / 4 Mio. Zellen' },
            coords: { type: 'string', enum: ['local', 'world'], default: 'local', description: 'local = relativ zur Bauplan-Ecke (0,0,0), world = Weltkoordinaten' },
            grow: { type: 'boolean', description: 'Bauplan automatisch vergrößern, wenn Zellen außerhalb liegen (origin verschiebt sich ggf.)' },
            baseVersion: { type: 'integer', description: 'Pflicht ohne dryRun. Bei Abweichung 409.' },
            dryRun: { type: 'boolean' }, note: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' } } }),
          responses: { 200: { description: 'changes, warnings (z. B. unbekannte Blocknamen), origin, size, analysis gegen Live; ohne dryRun zusätzlich version' }, 400: { description: 'Ungültige Operation (Meldung nennt den Index)' }, 409: { description: 'Bearbeitungskonflikt (currentVersion im Body)' } },
        },
      },
      '/api/blueprints/new': {
        post: {
          summary: 'Neuen Bauplan aus Operationen anlegen',
          requestBody: json({ type: 'object', required: ['fileName', 'origin', 'size', 'edits'], properties: {
            fileName: { type: 'string', example: '40_Pavillon.nbt' }, origin: { type: 'array', items: { type: 'integer' } }, size: { type: 'array', items: { type: 'integer' } },
            edits: { type: 'array', items: { $ref: '#/components/schemas/EditOp' } }, coords: { type: 'string', enum: ['local', 'world'] }, grow: { type: 'boolean' },
            dryRun: { type: 'boolean' }, name: { type: 'string' }, category: { type: 'string' }, description: { type: 'string' }, note: { type: 'string' } } }),
          responses: { 200: { description: 'Wie /edits' }, 409: { description: 'Bauplan existiert schon' } },
        },
      },
      '/api/blueprints/{id}/blocks': { get: { summary: 'Alle Zellen als JSON: palette + blocks [x,y,z,paletteIndex,hasNbt?]. Nicht gelistete Zellen = structure_void (nicht anfassen).', parameters: [id,
        { name: 'version', in: 'query', schema: { type: 'integer' } }, { name: 'coords', in: 'query', schema: { type: 'string', enum: ['local', 'world'] } }], responses: ok } },
      '/api/blueprints/{id}/layers': { get: { summary: 'Bauplan als ASCII-Schichten (eine Y-Ebene pro Block, Legende) – gut lesbar für LLMs', parameters: [id,
        { name: 'y', in: 'query', schema: { type: 'string' }, description: 'Y oder Bereich "a..b"' }, { name: 'coords', in: 'query', schema: { type: 'string', enum: ['world', 'local'], default: 'world' } }, { name: 'version', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: { description: 'text/plain' } } } },
      '/api/world/blocks': { get: { summary: 'Echte Welt (Snapshot) in einem Quader: JSON oder ASCII-Schichten, inkl. Block-Entities. Max. 2 Mio. Zellen.', parameters: [
        { name: 'from', in: 'query', required: true, schema: { type: 'string' }, example: '100,64,-40' }, { name: 'to', in: 'query', required: true, schema: { type: 'string' }, example: '120,70,-20' },
        { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'layers'] } }, { name: 'snapshot', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/blueprints/{id}/materials': { get: { summary: 'Materialliste: was fehlt noch (als Items, mit Stacks/Shulker), was ist gebaut, was fällt beim Abriss an', parameters: [id, { name: 'snapshot', in: 'query', schema: { type: 'integer' }, description: 'Standard: aktueller Live-Snapshot' }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'text', 'csv', 'html'] } },
        { name: 'all', in: 'query', schema: { type: 'boolean' }, description: 'auch komplett gebaute Items listen' }, { name: 'version', in: 'query', schema: { type: 'integer' } }], responses: ok } },
      '/api/materials': { get: { summary: 'Materialliste über mehrere Baupläne (items[].by = fehlende Anzahl je Bauplan)', parameters: [{ name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Kommagetrennte Bauplan-IDs; ohne = alle' }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'snapshot', in: 'query', schema: { type: 'integer' }, description: 'Standard: aktueller Live-Snapshot' }, { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'text', 'csv', 'html'] } }, { name: 'all', in: 'query', schema: { type: 'boolean' } }], responses: ok } },
      '/api/blueprints/{id}/remaining.nbt': { get: { summary: 'Rest-NBT: nur Zellen, die noch nicht stimmen. Gleiche Größe und origin wie der volle Bauplan, Rest bleibt unangetastet. Statistik im Header X-Campus-Remaining.', parameters: [id, { name: 'snapshot', in: 'query', schema: { type: 'integer' }, description: 'Standard: aktueller Live-Snapshot' }, { name: 'clear', in: 'query', schema: { type: 'boolean', default: false }, description: 'Luft-Zellen (Abriss) mitnehmen – nur für Vanilla-Strukturblöcke; die Schematicannon räumt in „Replace Solid with Empty“ sonst auch alle nicht enthaltenen Zellen' }, { name: 'skipBlocked', in: 'query', schema: { type: 'boolean', default: true }, description: 'Zellen mit Maschine/Block-Entity im Weg auslassen' }, { name: 'skipChanged', in: 'query', schema: { type: 'boolean', default: false }, description: 'Seit Planung geänderte Zellen auslassen' }], responses: ok } },
      '/api/remaining.zip': { get: { summary: 'Rest-NBTs mehrerer Baupläne als ZIP mit manifest.json (fertige Baupläne fehlen im ZIP)', parameters: [{ name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Kommagetrennte Bauplan-IDs; ohne = alle' }, { name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'snapshot', in: 'query', schema: { type: 'integer' }, description: 'Standard: aktueller Live-Snapshot' }, { name: 'clear', in: 'query', schema: { type: 'boolean', default: false }, description: 'Luft-Zellen (Abriss) mitnehmen – nur für Vanilla-Strukturblöcke; die Schematicannon räumt in „Replace Solid with Empty“ sonst auch alle nicht enthaltenen Zellen' }, { name: 'skipBlocked', in: 'query', schema: { type: 'boolean', default: true }, description: 'Zellen mit Maschine/Block-Entity im Weg auslassen' }, { name: 'skipChanged', in: 'query', schema: { type: 'boolean', default: false }, description: 'Seit Planung geänderte Zellen auslassen' }], responses: ok } },
      '/api/cannons': { get: { summary: 'Schematicannons am ME-System: Auftrag, Fortschritt, Optionen, Computerstatus und range (3D-Entfernung, Limit, geprüfte Bauplanversion, passende gebundene Kanonen mit Verfügbarkeit)', responses: ok } },
      '/api/cannons/{name}': {
        get: { summary: 'Eine Kanone mit blueprintChoices: nur freie, erreichbare aktuelle Baupläne mit baubarem Rest, Fortschritt und Weltabgleich-Zeitstempel', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, description: 'Name der Kanone (wie am CC-Computer eingerichtet)' }], responses: ok },
        put: { summary: 'Bauplan zuweisen und/oder Optionen ändern (Schreib-Token). Neuer Bauplan oder neue Version = neuer Auftrag: der Computer gibt Reste zurück und zählt neu.', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, description: 'Name der Kanone (wie am CC-Computer eingerichtet)' }],
          requestBody: json({ type: 'object', properties: { selection: { type: 'object', description: 'Web-Auswahl erneut auf Baubarkeit prüfen; version muss auch im Hauptobjekt stehen.', required: ['assignment','version'], properties: { assignment: {type:'integer'}, version: {type:'integer'} } }, blueprint: { type: ['string', 'null'] }, version: { type: ['integer', 'null'], description: 'Standard: aktuelle Version' },
            options: { type: 'object', properties: { paused: { type: 'boolean' }, bufferStacks: { type: 'integer', minimum: 1, maximum: 16 }, gunpowder: { type: 'integer', minimum: 0, maximum: 64 }, autoCraft: { type: 'boolean' }, craftBatch: { type: 'integer', minimum: 1, maximum: 4096 }, returnLeftovers: { type: 'boolean' }, skipBlocked: { type: 'boolean' } } },
            schematic: { type: 'object', description: 'Direkte Übergabe an Create 1.21.1-6.0.10 über die bestätigte Blockbindung und signierte Host-Brücke. Ziel ist der Bauplan-Ursprung; nur Oberwelt und Originalausrichtung.', properties: {
              enabled: { type: 'boolean', default: false },
              autoUpdate: { type: 'boolean', default: true }, replaceMode: { type: 'integer', enum: [0, 1, 2], default: 2 }, skipMissing: { type: 'boolean', default: false }, protectBlockEntities: { type: 'boolean', default: true }
            } } } }), responses: ok },
        delete: { summary: 'Kanone entfernen (Schreib-Token)', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, description: 'Name der Kanone (wie am CC-Computer eingerichtet)' }], responses: ok },
      },
      '/api/cannons/{name}/transfer': { post: { parameters: [cannonName], summary: 'Auftrag auf eine freie gebundene Kanone in Reichweite verschieben (Browser-Admin). Beide Kanonen müssen live STOPPED, zurückgesetzt und ohne fliegende Blöcke sein. Ziel muss online sein. Bauplanversion, Ziel und Einstellungen bleiben erhalten; der Bau wird nicht gestartet.', requestBody: json({ type: 'object', required: ['target', 'sourceAssignment', 'targetAssignment', 'baseVersion'], properties: { target: { type: 'string' }, sourceAssignment: { type: 'integer' }, targetAssignment: { type: 'integer' }, baseVersion: { type: 'integer' } } }), responses: ok } },
      '/api/cannons/{name}/plan': { get: { summary: 'Für den CC-Computer (Station-Token): was in die Kiste soll, unterste Schicht zuerst (items[].minY), plus Optionen und Auftragsnummer. Unbekannte Namen werden angelegt.', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, description: 'Name der Kanone (wie am CC-Computer eingerichtet)' }], responses: ok } },
      '/api/cannons/{name}/status': { post: { summary: 'Status des CC-Computers melden (Station-Token): state, computerId, chestSide, chest, delivered, shortages[]', parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' }, description: 'Name der Kanone (wie am CC-Computer eingerichtet)' }], requestBody: json({ type: 'object' }), responses: ok } },
      '/api/cannons/{name}/discover': { post: { parameters: [cannonName], summary: 'Kanonenposition über Computer-ID und angeschlossene Kiste automatisch erkennen und live prüfen (Browser-Admin). Startet keinen Bau.', requestBody: json({ type: 'object' }), responses: ok } },
      '/api/cannons/{name}/schematic/prepare': { post: { parameters: [cannonName], summary: 'Neuen festen Rest-Plan aus dem aktuellen Live-Snapshot vormerken (Browser-Admin). Die Brücke setzt ihn nur bei vollständig gestoppter Kanone ein.', requestBody: json({ type: 'object' }), responses: ok } },
      '/api/cannons/{name}/start': { post: { parameters: [cannonName], summary: 'Vorbereitete Kanone starten oder denselben pausierten Bau fortsetzen (Browser-Admin)', description: 'Prüft gebundene Position, Auftrag, Version, Reichweite, automatisch vorbereitetes Schematic, Dateihash, Ziel und Optionen live. Bewahrt Inventar und Baufortschritt. Abweichende oder unbekannte Zustände werden abgelehnt. Kein automatischer Reset.', requestBody: json({ type: 'object', required: ['assignment','version'], properties: { assignment: { type: 'integer', minimum: 1 }, version: { type: 'integer', minimum: 1 } } }), responses: { ...ok, 403: { description: 'Browser-Admin erforderlich' }, 409: { description: 'Auftrag geändert oder native Startprüfung abgelehnt' } } } },
      '/api/me/stock': {
        get: { summary: 'Zuletzt gemeldeter ME-Bestand (?items=1 mit Liste {item: [Menge, craftbar]})', parameters: [{ name: 'items', in: 'query', schema: { type: 'boolean' } }], responses: ok },
        post: { summary: 'ME-Bestand melden (Station-Token). items: [{name, count, craftable}] oder {name: count}', requestBody: json({ type: 'object', required: ['items'], properties: { source: { type: 'string' }, items: {} } }), responses: ok },
      },
      '/api/me/wanted': { get: { summary: 'Item-IDs, die der Campus noch braucht (plus Schießpulver) – nur diese meldet der Computer', responses: ok } },
      '/cc/install.lua': { get: { summary: 'Installer für den CC-Computer: wget run <url>/cc/install.lua (ohne Login, enthält keine Geheimnisse)', security: [], responses: ok } },
      '/api/viewer/scene': { get: { summary: 'Szene für den 3D-Viewer: Baupläne mit Status, Block-Stile, Orte', parameters: [{ name: 'snapshot', in: 'query', schema: { type: 'string' } }], responses: ok } },
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
