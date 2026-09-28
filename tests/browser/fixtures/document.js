(() => {
  const api = window.SSDiagram;
  const drawing = api.createDiagramDocument({
    nodes: [
      {
        id: 'gate', name: 'Gateway', subtitle: 'FIX / REST / WebSocket', x: 0, y: 0,
        color: 'var(--fixture-node)', border: 'var(--fixture-node)',
        outPorts: [{ id: 'out', name: 'Out' }],
      },
      { id: 'core', name: 'Matching engine', x: 420, y: 0, inPorts: [{ id: 'in', name: 'In' }] },
    ],
    links: [{ from: { nodeId: 'gate', portId: 'out' }, to: { nodeId: 'core', portId: 'in' }, label: 'SBE' }],
    zones: [{ id: 'colo', name: 'Colocation', x: -60, y: -60, width: 760, height: 200 }],
  });

  window.fixtureHandle = api.renderDocument(document.getElementById('direct'), drawing);
  api.renderAll();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.fixtureReady = true; }));
})();
