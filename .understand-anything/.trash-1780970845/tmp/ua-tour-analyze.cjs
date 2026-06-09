#!/usr/bin/env node
const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

try {
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  // Build node lookup
  const nodeById = {};
  for (const n of nodes) nodeById[n.id] = n;

  // A. Fan-in
  const fanIn = {};
  for (const n of nodes) fanIn[n.id] = 0;
  for (const e of edges) {
    if (fanIn[e.target] !== undefined) fanIn[e.target]++;
  }
  const fanInRanking = Object.entries(fanIn)
    .map(([id, fanInCount]) => ({ id, fanIn: fanInCount, name: nodeById[id]?.name || id }))
    .filter(x => x.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  // B. Fan-out
  const fanOut = {};
  for (const n of nodes) fanOut[n.id] = 0;
  for (const e of edges) {
    if (fanOut[e.source] !== undefined) fanOut[e.source]++;
  }
  const fanOutRanking = Object.entries(fanOut)
    .map(([id, fanOutCount]) => ({ id, fanOut: fanOutCount, name: nodeById[id]?.name || id }))
    .filter(x => x.fanOut > 0)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // C. Entry point candidates
  const ENTRY_NAMES = /^(index|main|app|server|mod|main|manage|wsgi|asgi|run|__main__|Application|Main|Program|config)\.(ts|js|tsx|jsx|rs|go|py|cpp|c|java|swift|kt|php|ru)$/i;
  const candidates = [];
  for (const n of nodes) {
    let score = 0;
    if (n.type === 'file' && ENTRY_NAMES.test(n.name || '')) score += 3;
    if (n.filePath && (n.filePath === n.name || n.filePath.split('/').length <= 2)) score += 1;
    if (fanOut[n.id] > 0 && fanOutRanking.slice(0, Math.ceil(fanOutRanking.length * 0.1)).some(x => x.id === n.id)) score += 1;
    if (fanIn[n.id] === 0) score += 1;
    if (n.type === 'document' && n.filePath === 'README.md') score += 5;
    if (n.type === 'document' && n.filePath && !n.filePath.includes('/') && n.filePath.endsWith('.md')) score += 2;
    if (score > 0) candidates.push({ id: n.id, score, name: n.name, summary: n.summary, type: n.type });
  }
  candidates.sort((a, b) => b.score - a.score);
  const entryPointCandidates = candidates.slice(0, 5);

  // D. BFS from top code entry point
  const topCodeEntry = entryPointCandidates.find(c => c.type !== 'document' && c.type !== 'config') || entryPointCandidates.find(c => c.type === 'file');
  const startNode = topCodeEntry ? topCodeEntry.id : null;
  const bfsTraversal = { startNode, order: [], depthMap: {}, byDepth: {} };
  if (startNode) {
    const visited = new Set();
    const queue = [{ id: startNode, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      bfsTraversal.order.push(id);
      bfsTraversal.depthMap[id] = depth;
      if (!bfsTraversal.byDepth[depth]) bfsTraversal.byDepth[depth] = [];
      bfsTraversal.byDepth[depth].push(id);
      for (const e of edges) {
        if ((e.type === 'imports' || e.type === 'calls') && e.source === id && !visited.has(e.target)) {
          queue.push({ id: e.target, depth: depth + 1 });
        }
      }
    }
  }

  // E. Non-code file inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    if (n.type === 'document') nonCodeFiles.documentation.push({ id: n.id, name: n.name, summary: n.summary });
    else if (['service', 'pipeline', 'resource'].includes(n.type)) nonCodeFiles.infrastructure.push({ id: n.id, name: n.name, summary: n.summary, type: n.type });
    else if (['table', 'schema', 'endpoint'].includes(n.type)) nonCodeFiles.data.push({ id: n.id, name: n.name, summary: n.summary, type: n.type });
    else if (n.type === 'config') nonCodeFiles.config.push({ id: n.id, name: n.name, summary: n.summary });
  }

  // F. Tightly coupled clusters
  const mutualPairs = new Map();
  for (const e of edges) {
    if (e.type !== 'imports' && e.type !== 'calls') continue;
    const key = [e.source, e.target].sort().join('|');
    if (!mutualPairs.has(key)) {
      mutualPairs.set(key, { a: e.source, b: e.target, count: 0 });
    }
    const entry = mutualPairs.get(key);
    if (entry.a === e.source && entry.b === e.target) entry.count++;
  }
  const bidirectional = [...mutualPairs.values()].filter(p => p.count >= 2);
  const clusterMap = new Map();
  for (const p of bidirectional) {
    const key = p.a;
    if (!clusterMap.has(key)) clusterMap.set(key, new Set([p.a, p.b]));
  }
  // Expand
  for (const [k, members] of clusterMap) {
    for (const e of edges) {
      if ((e.type === 'imports' || e.type === 'calls') && members.has(e.source) && !members.has(e.target)) {
        let connections = 0;
        for (const m of members) {
          if (edges.some(x => x.source === m && x.target === e.target)) connections++;
        }
        if (connections >= 2) members.add(e.target);
      }
    }
  }
  const clusters = [...clusterMap.values()]
    .map(set => ({ nodes: [...set], edgeCount: [...set].length * 2 }))
    .filter(c => c.nodes.length >= 2 && c.nodes.length <= 5)
    .slice(0, 10);

  // G. Layers
  const layersOut = { count: layers.length, list: layers };

  // H. Node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary };
  }

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal,
    nonCodeFiles,
    clusters,
    layers: layersOut,
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
