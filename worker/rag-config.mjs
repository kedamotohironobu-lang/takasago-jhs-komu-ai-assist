// STEP5 production RAG constants.
// Central production RAG constants.
// STEP5-6 gate values are provisional and must be recalibrated on real data.

const RAG_CONFIG = Object.freeze({
  schemaVersion: 1,

  chunking: Object.freeze({
    targetChars: 800,
    minChars: 250,
    maxChars: 1200,
    overlapChars: 120,
    maxEvidenceChars: 5500
  }),

  retrieval: Object.freeze({
    vectorTopK: 15,
    ftsTopK: 15,
    fusedTopK: 10,
    rrfK: 60,
    maxEvidenceBlocks: 6,
    defaultEvidenceBlocks: 4,
    maxEvidenceBlocksPerDocument: 2,

    // STEP5-6 provisional evidence gate.
    // Calibrate again after a real-school question set is available.
    gate: Object.freeze({
      hybridMinVectorScore: 0.75,
      hybridMaxVectorRank: 3,
      hybridMaxFtsRank: 3,
      // STEP8-11: Vector/FTSの両方が1位の場合だけ、実校テストで確認した
      // 0.70以上を補助採用する。全体のhybrid閾値0.75は維持する。
      top1HybridMinVectorScore: 0.70,
      // 実校データ校正: 同一資料内で複数チャンクがVector + FTSの両方で
      // 上位一致した場合のみ、0.65以上を補助的に採用する。
      corroboratedHybridMinVectorScore: 0.65,
      corroboratedHybridMaxVectorRank: 3,
      corroboratedHybridMaxFtsRank: 3,
      corroboratedHybridMinChunks: 2,
      vectorOnlyMinScore: 0.82,
      vectorOnlyMinLead: 0.08
    })
  }),

  embedding: Object.freeze({
    status: 'approved-for-project-use',
    provider: 'gemini',
    model: 'gemini-embedding-2',
    dimensions: 384,
    metric: 'cosine',
    documentFormat: 'title: {title} | text: {content}',
    queryFormat: 'task: question answering | query: {content}'
  }),

  capacity: Object.freeze({
    vectorizeFreeStoredDimensions: 5_000_000,
    vectorizeTargetActiveChunks: 10_000,
    vectorizeWarningRatio: 0.60,
    vectorizeCautionRatio: 0.80,
    vectorizeCriticalRatio: 0.90,
    d1DatabaseLimitBytes: 500 * 1024 * 1024,
    d1WarningBytes: 300 * 1024 * 1024,
    d1CautionBytes: 400 * 1024 * 1024
  }),

  retention: Object.freeze({
    syncJobDays: 90,
    auditLogDays: 400
  })
});

function vectorDimensionsForChunks(chunkCount) {
  const count = Math.max(0, Number(chunkCount) || 0);
  return count * RAG_CONFIG.embedding.dimensions;
}

function maxChunksWithinStoredDimensionLimit(limit = RAG_CONFIG.capacity.vectorizeFreeStoredDimensions) {
  return Math.floor(limit / RAG_CONFIG.embedding.dimensions);
}

function vectorCapacityStatus(activeChunks) {
  const used = vectorDimensionsForChunks(activeChunks);
  const limit = RAG_CONFIG.capacity.vectorizeFreeStoredDimensions;
  const ratio = limit ? used / limit : 1;

  let level = 'normal';
  if (ratio >= RAG_CONFIG.capacity.vectorizeCriticalRatio) level = 'critical';
  else if (ratio >= RAG_CONFIG.capacity.vectorizeCautionRatio) level = 'caution';
  else if (ratio >= RAG_CONFIG.capacity.vectorizeWarningRatio) level = 'warning';

  return {
    activeChunks: Math.max(0, Number(activeChunks) || 0),
    dimensions: RAG_CONFIG.embedding.dimensions,
    usedDimensions: used,
    limitDimensions: limit,
    ratio,
    level
  };
}

export {
  RAG_CONFIG,
  vectorDimensionsForChunks,
  maxChunksWithinStoredDimensionLimit,
  vectorCapacityStatus
};
