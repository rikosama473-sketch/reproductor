const RIGHTS_BASES = new Set(["owned", "creative-commons", "permission"]);
const MAX_TRACKS = 5000;

export function normalizeMultiLabelName(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim();
}

export function validateMultiLabelDocument(document) {
  const errors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return ["El documento debe ser un objeto JSON."];
  }
  if (document.schemaVersion !== 1) errors.push("schemaVersion debe ser 1.");
  if (typeof document.datasetName !== "string" || !document.datasetName.trim()) {
    errors.push("datasetName es obligatorio.");
  }
  if (!["validation", "test"].includes(document.split)) {
    errors.push("split debe ser validation o test; reserva test para la evaluación final.");
  }
  if (!document.model || typeof document.model !== "object" ||
      typeof document.model.id !== "string" || !document.model.id.trim() ||
      typeof document.model.revision !== "string" || !document.model.revision.trim()) {
    errors.push("model.id y model.revision son obligatorios para identificar el modelo evaluado.");
  }

  if (!Array.isArray(document.labels) || document.labels.length === 0) {
    errors.push("labels debe contener las etiquetas de salida del modelo.");
    return errors;
  }
  const labels = document.labels.map(normalizeMultiLabelName);
  const labelSet = new Set(labels);
  if (labels.some((label, index) => !label || label !== document.labels[index])) {
    errors.push("Cada etiqueta debe ser texto no vacío, recortado y normalizado a Unicode NFC.");
  }
  if (labelSet.size !== labels.length) errors.push("labels contiene etiquetas duplicadas.");

  if (!Array.isArray(document.tracks) || document.tracks.length === 0) {
    errors.push("tracks debe contener al menos una pista.");
    return errors;
  }
  if (document.tracks.length > MAX_TRACKS) {
    errors.push("El máximo es " + MAX_TRACKS + " pistas por ejecución.");
  }

  const ids = new Set();
  for (const [index, track] of document.tracks.entries()) {
    const prefix = "tracks[" + index + "]";
    if (!track || typeof track !== "object" || Array.isArray(track)) {
      errors.push(prefix + " debe ser un objeto.");
      continue;
    }

    const id = typeof track.id === "string" ? track.id.trim() : "";
    if (!id) errors.push(prefix + ".id es obligatorio.");
    else if (ids.has(id)) errors.push("ID de pista duplicado: " + id + ".");
    else ids.add(id);

    if (typeof track.artistKey !== "string" || !track.artistKey.trim()) {
      errors.push(prefix + ".artistKey seudónimo es obligatorio para controlar fugas entre artistas.");
    }

    if (!Array.isArray(track.expectedLabels) || track.expectedLabels.length === 0) {
      errors.push(prefix + ".expectedLabels debe contener al menos una etiqueta revisada por una persona.");
    } else {
      const expected = track.expectedLabels.map(normalizeMultiLabelName);
      if (expected.some(label => !label || !labelSet.has(label))) {
        errors.push(prefix + ".expectedLabels contiene etiquetas vacías o ausentes en labels.");
      }
      if (new Set(expected).size !== expected.length) {
        errors.push(prefix + ".expectedLabels contiene etiquetas duplicadas.");
      }
    }

    const rights = track.rights;
    if (!rights || typeof rights !== "object" || Array.isArray(rights) ||
        !RIGHTS_BASES.has(rights.basis)) {
      errors.push(prefix + ".rights.basis debe ser owned, creative-commons o permission.");
    } else {
      if (typeof rights.reference !== "string" || !rights.reference.trim()) {
        errors.push(prefix + ".rights.reference debe describir la procedencia o autorización.");
      }
      if (rights.basis === "creative-commons" &&
          (typeof rights.license !== "string" || !rights.license.trim())) {
        errors.push(prefix + ".rights.license es obligatorio para Creative Commons.");
      }
    }

    const scores = track.scores;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
      errors.push(prefix + ".scores debe ser un objeto con un puntaje por etiqueta.");
      continue;
    }
    for (const label of labels) {
      const score = scores[label];
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        errors.push(prefix + ".scores[" + JSON.stringify(label) + "] debe ser un valor numérico entre 0 y 1.");
      }
    }
    for (const key of Object.keys(scores)) {
      if (!labelSet.has(key)) errors.push(prefix + ".scores contiene una etiqueta desconocida: " + key + ".");
    }
  }
  return errors;
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function calculateAveragePrecision(tracks, label, support) {
  if (!support) return null;
  const ranked = tracks.map((track, index) => ({
    score: track.scores[label],
    positive: track.expectedLabels.includes(label),
    index
  })).sort((left, right) => right.score - left.score || left.index - right.index);

  let truePositive = 0;
  let falsePositive = 0;
  let averagePrecision = 0;
  let index = 0;
  while (index < ranked.length) {
    const score = ranked[index].score;
    let groupSize = 0;
    let groupPositive = 0;
    while (index < ranked.length && ranked[index].score === score) {
      groupSize++;
      if (ranked[index].positive) groupPositive++;
      index++;
    }
    truePositive += groupPositive;
    falsePositive += groupSize - groupPositive;
    if (groupPositive > 0) {
      const precisionAtGroup = truePositive / (truePositive + falsePositive);
      averagePrecision += (groupPositive / support) * precisionAtGroup;
    }
  }
  return averagePrecision;
}

function validateEvaluationInputs(tracks, labels, thresholds, topKValues) {
  if (!Array.isArray(labels) || labels.length === 0 ||
      labels.some(label => !normalizeMultiLabelName(label)) ||
      new Set(labels).size !== labels.length) {
    throw new TypeError("labels debe ser una lista no vacía de nombres únicos.");
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new TypeError("tracks debe contener al menos una pista.");
  }
  if (!Array.isArray(thresholds) || thresholds.length === 0 ||
      thresholds.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      new Set(thresholds).size !== thresholds.length) {
    throw new TypeError("thresholds debe contener valores únicos entre 0 y 1.");
  }
  if (!Array.isArray(topKValues) || topKValues.length === 0 ||
      topKValues.some(value => !Number.isInteger(value) || value < 1) ||
      new Set(topKValues).size !== topKValues.length) {
    throw new TypeError("topKValues debe contener enteros positivos y únicos.");
  }
  const errors = validateMultiLabelDocument({
    schemaVersion: 1,
    datasetName: "evaluation",
    split: "test",
    model: { id: "evaluation", revision: "evaluation" },
    labels,
    tracks
  });
  if (errors.length) throw new TypeError("Datos multi-etiqueta inválidos:\n- " + errors.join("\n- "));
}

export function calculateMultiLabelMetrics(
  tracks,
  labels,
  thresholds = [0.25, 0.5],
  topKValues = [3, 5]
) {
  validateEvaluationInputs(tracks, labels, thresholds, topKValues);
  const supportByLabel = Object.fromEntries(labels.map(label => [
    label,
    tracks.reduce((count, track) => count + (track.expectedLabels.includes(label) ? 1 : 0), 0)
  ]));
  const averagePrecisionByLabel = Object.fromEntries(labels.map(label => [
    label,
    calculateAveragePrecision(tracks, label, supportByLabel[label])
  ]));
  const supportedAP = Object.values(averagePrecisionByLabel).filter(Number.isFinite);
  const macroAveragePrecision = supportedAP.length
    ? supportedAP.reduce((sum, value) => sum + value, 0) / supportedAP.length
    : null;

  const thresholdMetrics = thresholds.map(threshold => {
    const perLabel = {};
    let microTruePositive = 0;
    let microFalsePositive = 0;
    let microFalseNegative = 0;
    const supportedPrecision = [];
    const supportedRecall = [];
    const supportedF1 = [];

    for (const label of labels) {
      let truePositive = 0;
      let falsePositive = 0;
      let falseNegative = 0;
      let predicted = 0;
      for (const track of tracks) {
        const expected = track.expectedLabels.includes(label);
        const actual = track.scores[label] >= threshold;
        if (actual) predicted++;
        if (expected && actual) truePositive++;
        else if (!expected && actual) falsePositive++;
        else if (expected && !actual) falseNegative++;
      }
      const support = supportByLabel[label];
      const precision = safeRatio(truePositive, truePositive + falsePositive);
      const recall = safeRatio(truePositive, support);
      const f1 = safeRatio(2 * precision * recall, precision + recall);
      perLabel[label] = {
        support,
        predicted,
        truePositive,
        falsePositive,
        falseNegative,
        precision,
        recall,
        f1,
        averagePrecision: averagePrecisionByLabel[label]
      };
      microTruePositive += truePositive;
      microFalsePositive += falsePositive;
      microFalseNegative += falseNegative;
      if (support > 0) {
        supportedPrecision.push(precision);
        supportedRecall.push(recall);
        supportedF1.push(f1);
      }
    }

    const microPrecision = safeRatio(microTruePositive, microTruePositive + microFalsePositive);
    const microRecall = safeRatio(microTruePositive, microTruePositive + microFalseNegative);
    const microF1 = safeRatio(
      2 * microPrecision * microRecall,
      microPrecision + microRecall
    );
    const mean = values => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

    return {
      threshold,
      micro: {
        truePositive: microTruePositive,
        falsePositive: microFalsePositive,
        falseNegative: microFalseNegative,
        precision: microPrecision,
        recall: microRecall,
        f1: microF1
      },
      macro: {
        precision: mean(supportedPrecision),
        recall: mean(supportedRecall),
        f1: mean(supportedF1)
      },
      classesWithoutSupport: labels.filter(label => supportByLabel[label] === 0),
      perLabel
    };
  });

  const totalPositiveLabels = Object.values(supportByLabel).reduce((sum, count) => sum + count, 0);
  const topK = topKValues.map(requestedK => {
    const k = Math.min(requestedK, labels.length);
    let hits = 0;
    let predictionCount = 0;
    for (const track of tracks) {
      const ranked = labels.map(label => ({ label, score: track.scores[label] }))
        .sort((left, right) => right.score - left.score ||
          (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
      const expected = new Set(track.expectedLabels);
      const selected = ranked.slice(0, k);
      predictionCount += selected.length;
      hits += selected.filter(item => expected.has(item.label)).length;
    }
    return {
      k,
      hits,
      predictions: predictionCount,
      precision: safeRatio(hits, predictionCount),
      recall: safeRatio(hits, totalPositiveLabels)
    };
  });

  return {
    sampleCount: tracks.length,
    labelCount: labels.length,
    positiveLabelCount: totalPositiveLabels,
    meanLabelsPerTrack: totalPositiveLabels / tracks.length,
    classesWithSupport: labels.filter(label => supportByLabel[label] > 0).length,
    classesWithoutSupport: labels.filter(label => supportByLabel[label] === 0),
    macroAveragePrecision,
    averagePrecisionByLabel,
    thresholdMetrics,
    topK
  };
}
